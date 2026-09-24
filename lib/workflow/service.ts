import { observed } from "./diagnostics";
import { acceptanceIssue, requiresReviewOverride } from "./review-acceptance";
import { randomUUID } from "node:crypto";
import { briefSchema, researchInputSchema, type BriefInput, type ResearchInput } from "./schema";
import type { Brief, Research, Session, Variant } from "./session-types";
import { loadBrandResearch, saveSession } from "./sessions";
import { safeError, WorkflowError } from "./validation";
import { research } from "./agents/researcher";
import { createAd } from "./agents/artist";
import { reviewAd } from "./agents/reviewer";
import { DEFAULT_DESIGN, type Stage } from "./creative/schema";
import { resolveBrandTokens } from "./creative/tokens";
import { eligibleOffersForProduct, validateCreative } from "./creative/fit";
import { adoptBrandContext } from "./research/brand-context";
import { userResearchIntent } from "./research/intent";
import { canonicalUrl, pageHint, productIdentityUrl, storeHost } from "./research/extract";
import { groundBrief } from "./research/grounding";
import type { Direction, ResearchAsset, ResearchState } from "./research/contracts";
import { generationSourceSchema, type GenerationSource } from "./generation-contracts";
import { draftCampaignBrief, draftRefinement } from "./campaign-brief";
import { campaignNextAction } from "./next-action";
import { createCampaignScope, memberReferenceReadiness, scopeForCampaign, type CampaignMember } from "./research/scope";
import { compactShopifySource } from "./research/shopify-fetch";
import { planExecution, retryExecution, validatePlan, matchesStage } from "./creative/reuse";
import { readVisual, readAsset, pinSourceAsset } from "./storage";

export type WorkflowDependencies = { now?: () => number; draftCampaignBrief?: typeof draftCampaignBrief; draftRefinement?: typeof draftRefinement; loadBrandResearch?: (storeUrl: string) => Promise<Research | null>; research: typeof research; createAd: typeof createAd; reviewAd: typeof reviewAd; save: typeof saveSession; readVisual: typeof readVisual; readAsset?: typeof readAsset; pinSourceAsset?: typeof pinSourceAsset };
const defaults: WorkflowDependencies = { loadBrandResearch, research, createAd, reviewAd, save: saveSession, readVisual, readAsset, pinSourceAsset };
class ContinueInFreshRequest extends WorkflowError {}

/** Workflow rules live here, independently of the LLM, HTTP routes and UI. */
export class Workflow {
  private readonly requestDeadline: number;
  constructor(public session: Session, private deps: WorkflowDependencies = defaults) {
    this.requestDeadline = (deps.now ?? Date.now)() + 300_000;
  }

  private userInput?: { text: string; id?: string };
  setUserInput(text: string, id?: string) { this.userInput = { text, id }; }

  private assertResearchEditable() {
    const brief = this.session.brief;
    if (brief && !this.session.variants.some(item => item.brief.id === brief.id) && brief.sceneCheckpoint?.state === "attempted" && !brief.sceneCheckpoint.provider) {
      throw new WorkflowError("Resolve the unfinished image attempt before changing this campaign. Use its explicit retry control and acknowledge any possible duplicate charge.", 409);
    }
  }

  private setResearchState(state: ResearchState) {
    this.session.researchState = { ...state, ...(this.session.researchState?.generationIntent ? { generationIntent: this.session.researchState.generationIntent } : {}) };
  }
  private updatedResearch(next: Research) {
    const intent = this.session.researchState?.generationIntent;
    if (intent && !this.session.variants.some(item => item.id === intent.briefId)) {
      intent.researchId = next.id; delete intent.briefId; delete intent.pausedReason; delete intent.error;
    }
  }

  async generateCampaign(requestId: string, input: GenerationSource) {
    const source = generationSourceSchema.parse(input);
    const current = this.session.researchState?.generationIntent;
    if (current?.requestId === requestId) {
      if (JSON.stringify(current.source) !== JSON.stringify(source)) throw new WorkflowError("This request belongs to another campaign direction.", 409);
      return this.session; // Duplicate dispatch never repeats research, planning or paid work.
    }
    this.assertResearchEditable();
    if (!this.session.research?.brandKit) throw new WorkflowError("Finish brand setup before generating.", 409);
    if ("choiceId" in source && !this.session.research.suggestions?.some(item => item.id === source.choiceId)) throw new WorkflowError("Choose a current campaign suggestion.", 409);
    this.setResearchState({ stage: this.session.researchState?.stage || "awaiting_direction", direction: this.session.researchState?.direction });
    this.session.researchState!.generationIntent = { requestId, source, authorizedAt: new Date().toISOString(), setupPending: true };
    await this.deps.save(this.session); // Persist the actual Generate action before any work.
    return this.continueCampaign(requestId);
  }

  async continueCampaign(requestId: string) {
    const intent = this.session.researchState?.generationIntent;
    if (!intent || intent.requestId !== requestId) throw new WorkflowError("This campaign request changed. Reload before continuing.", 409);
    const next = campaignNextAction(this.session);
    if (next?.kind === "complete") return this.session;
    if (next?.briefId && next.kind === "retry") throw new WorkflowError(next.message || "Start an explicit new image attempt.", 409);
    if (intent.setupPending && intent.researchId) return this.session;
    delete intent.pausedReason; delete intent.error;
    try {
      if (!intent.researchId) {
        const saved = this.session.research!;
        const choiceId = "choiceId" in intent.source ? intent.source.choiceId : undefined;
        const choice = choiceId ? saved.suggestions?.find(item => item.id === choiceId) : undefined;
        if ("choiceId" in intent.source && !choice) throw new WorkflowError("The campaign suggestion changed. Choose a new direction.", 409);
        const text = choice?.label ?? ("direction" in intent.source ? intent.source.direction : "");
        const supplied = userResearchIntent(text).urls;
        const direction: Direction = { text, origin: choice ? "choice" : "user_message", ...(choice ? { choiceId: choice.id, url: choice.url } : supplied[0] ? { url: supplied[0] } : {}) };
        const result = await this.research({ url: saved.brandKit!.canonicalStoreUrl, campaignUrl: choice?.url ?? supplied[0] ?? null, productUrl: null }, direction);
        intent.researchId = result.id;
        if (result.campaign) {
          const members = scopeForCampaign(result.campaign, result.products || []).members;
          const selected = result.campaign.selectedProductId
            ? members.filter(member => member.productId === result.campaign!.selectedProductId)
            : [];
          const ready = selected.find(member => memberReferenceReadiness(member, result.products || [], result.assets || []).status === "ready");
          if (ready) await this.selectCampaignMember(ready.productId, ready.variantId);
          else {
            intent.pausedReason = "needs_input";
            intent.error = selected.length
              ? "The selected product does not have a verified reference yet. Choose a product with a suitable photo."
              : "Choose a product from the researched collection to continue.";
          }
        }
        await this.deps.save(this.session);
        return this.session; // A fresh request gives planning/generation its full budget.
      }
      if (this.session.research?.id !== intent.researchId) throw new WorkflowError("Campaign research changed. Choose Generate again to use the updated research.", 409);
      if (!intent.briefId) {
        const research = this.session.research!;
        const sources = research.sources.map(compactShopifySource);
        if (JSON.stringify(sources) !== JSON.stringify(research.sources)) {
          this.session.research = { ...structuredClone(research), id: randomUUID(), revision: (research.revision || 0) + 1, sources };
          intent.researchId = this.session.research.id;
          await this.event("compact_research", "completed", "Saved product facts without storefront HTML. Earlier research remains unchanged.");
        }
        if (this.session.researchState!.stage !== "ready_for_brief") { intent.pausedReason = "needs_input"; intent.error = "Choose a product and a verified photo to continue."; await this.deps.save(this.session); return this.session; }
        if (intent.setup?.saleId && !eligibleOffersForProduct(this.session.research!, this.session.research!.campaign!.selectedProductId!).some(item => item.offer.id === intent.setup!.saleId)) {
          intent.setupPending = true;
          intent.pausedReason = "needs_input";
          intent.error = "The selected offer is no longer current for this product. Recheck it or continue without an offer.";
          await this.deps.save(this.session);
          return this.session;
        }
        const parentId = intent.refinement?.variantId ?? intent.offerChange?.variantId;
        const parent = parentId ? this.session.variants.find(item => item.id === parentId) : undefined;
        if (parentId && !parent) throw new WorkflowError("The original ad for this revision was not found.", 409);
        const input = intent.offerChange && parent
          ? { ...parent.brief, saleId: intent.offerChange.saleId, variation: "auto" as const, feedback: intent.offerChange.saleId ? "Use the selected offer." : "Remove the offer.", parentVariantId: parent.id }
          : parent ? await (this.deps.draftRefinement ?? draftRefinement)(parent, intent.refinement!.feedback)
          : await (this.deps.draftCampaignBrief ?? draftCampaignBrief)(this.session.research!, this.session.preferences, intent.setup);
        const brief = await this.proposeBrief(input, "campaign_generate");
        intent.briefId = brief.id;
        await this.deps.save(this.session);
        return this.session;
      }
      const completed = this.session.variants.find(item => item.id === intent.briefId);
      if (completed) { if (completed.status === "pending_review") await this.review(completed.id); return this.session; }
      if (this.session.brief?.id !== intent.briefId || this.session.brief.approvalOrigin !== "campaign_generate") throw new WorkflowError("The brief changed outside this generation request. Choose Generate again.", 409);
      if (!this.session.brief.approvedAt) await this.approveBrief(intent.briefId);
      await this.generate(intent.briefId);
    } catch (error) {
      if (!(error instanceof ContinueInFreshRequest)) {
        intent.pausedReason = error instanceof WorkflowError && error.status === 409 && !this.session.brief?.generationAttemptedAt ? "needs_input" : "failure";
        intent.error = safeError(error);
      }
      await this.deps.save(this.session);
    }
    return this.session;
  }

  async retryCreative(requestId: string, previousRequestId: string, briefId: string, acknowledgePossibleDuplicate = false) {
    const current = this.session.researchState?.generationIntent;
    if (current?.requestId === requestId && current.previousRequestId === previousRequestId) return this.session;
    if (!current || current.requestId !== previousRequestId || current.briefId !== briefId || this.session.brief?.id !== briefId) throw new WorkflowError("This saved attempt changed. Reload before retrying.", 409);
    const next = campaignNextAction(this.session);
    if (next?.kind !== "retry" || next.briefId !== briefId) throw new WorkflowError("This creative can continue from saved work; no new image attempt is needed.", 409);
    if (next.duplicateRisk && !acknowledgePossibleDuplicate) throw new WorkflowError("The previous request may have completed. Acknowledge the possible duplicate charge before starting another attempt.", 409);
    const previous = this.session.brief;
    const intent = { requestId, previousRequestId, source: current.source, researchId: current.researchId, authorizedAt: new Date().toISOString() };
    this.session.researchState!.generationIntent = intent;
    const brief = await this.proposeBrief(previous, "campaign_generate", previous);
    this.session.researchState!.generationIntent.briefId = brief.id;
    await this.deps.save(this.session);
    return this.session;
  }

  async setCampaignScope(members: CampaignMember[]) {
    this.assertResearchEditable();
    const current = this.session.research;
    if (!current?.campaign?.direction || !members.length) throw new WorkflowError("Include at least one observed product in the campaign.", 409);
    const next = structuredClone(current); next.id = randomUUID(); next.revision = (next.revision || 0) + 1;
    next.campaign!.scope = createCampaignScope(next.products || [], members, current.campaign.scope?.coverage.attemptedUrls, current.campaign.scope?.coverage.failedUrls);
    if (current.campaign.scope) next.campaign!.scope.coverage.foundProductIds = [...new Set([...current.campaign.scope.coverage.foundProductIds, ...members.map(member => member.productId)])];
    next.campaign!.productIds = [...new Set(members.map(item => item.productId))];
    const ready = members.find(member => memberReferenceReadiness(member, next.products || [], next.assets || []).status === "ready");
    next.campaign!.selectedProductId = ready?.productId ?? null; next.campaign!.selectedVariantId = ready?.variantId ?? null;
    next.campaign!.status = ready ? "ready_for_brief" : "needs_selection";
    this.session.research = next; this.setResearchState({ stage: next.campaign!.status, direction: next.campaign!.direction! }); this.updatedResearch(next); delete this.session.brief;
    await this.event("campaign_scope", "completed", `${members.length} campaign members included.`);
    return next;
  }

  async selectCampaignMember(productId: string, variantId: string | null = null) {
    this.assertResearchEditable();
    const current = this.session.research;
    if (!current?.campaign) throw new WorkflowError("Research this campaign first.", 409);
    const members = scopeForCampaign(current.campaign, current.products || []).members;
    if (!members.some(member => member.productId === productId && member.variantId === variantId)) throw new WorkflowError("Include this exact product or variant in the campaign first.", 409);
    const next = structuredClone(current); next.id = randomUUID(); next.revision = (next.revision || 0) + 1;
    next.campaign!.selectedProductId = productId; next.campaign!.selectedVariantId = variantId;
    next.campaign!.status = memberReferenceReadiness({ productId, variantId }, next.products || [], next.assets || []).status === "ready" ? "ready_for_brief" : "needs_selection";
    this.session.research = next; this.setResearchState({ stage: next.campaign!.status, direction: next.campaign!.direction! }); this.updatedResearch(next); delete this.session.brief;
    await this.event("select_member", "completed", productId);
    return next;
  }

  async prepareChatRevision(input: BriefInput, targetVariantId: string) {
    const target = this.session.variants.find(item => item.id === targetVariantId);
    if (!target) throw new WorkflowError("The ad being discussed was not found.", 404);
    if (input.productId !== target.brief.productId || (input.variantId ?? null) !== (target.brief.variantId ?? null) || input.parentVariantId !== targetVariantId) throw new WorkflowError("This revision must stay attached to the selected ad and product.", 409);
    const active = campaignNextAction(this.session);
    if (active && active.kind !== "complete" && !this.session.researchState?.generationIntent?.setupPending) throw new WorkflowError("Finish the current creative before preparing another revision.", 409);
    await this.selectCampaignMember(target.brief.productId!, target.brief.variantId ?? null);
    delete this.session.researchState?.generationIntent;
    return this.proposeBrief(input);
  }

  async generateCampaignMember(requestId: string, productId: string, variantId: string | null = null) {
    if (this.session.researchState?.generationIntent?.requestId === requestId) return this.session;
    await this.selectCampaignMember(productId, variantId);
    const research = this.session.research!;
    this.session.researchState!.generationIntent = { requestId, source: { direction: research.campaign!.direction!.text }, researchId: research.id, authorizedAt: new Date().toISOString(), setupPending: true };
    await this.deps.save(this.session);
    return this.session;
  }

  private researchWithOfferChoice(research: Research, productId: string, saleId: string | null, confirmOffer = false): Research {
    if (!saleId) return research;
    const offer = research.offers?.find(item => item.id === saleId);
    const sale = research.sales.find(item => item.id === saleId);
    if (!offer || !sale || sale.quote !== offer.quote || canonicalUrl(sale.sourceUrl) !== canonicalUrl(offer.sourceUrl)) throw new WorkflowError("This offer no longer matches its saved source. Choose a current offer or no offer.", 409);
    const now = Date.now(), checked = Date.parse(offer.checkedAt), ends = offer.endsAt ? Date.parse(offer.endsAt) : null;
    if (!Number.isFinite(checked) || checked > now + 300_000 || now - checked > 86_400_000 || ends !== null && (!Number.isFinite(ends) || ends <= now)) throw new WorkflowError("This offer is stale or expired. Research it again or choose no offer.", 409);
    const next = structuredClone(research);
    if (confirmOffer) {
      const selected = next.offers!.find(item => item.id === saleId)!;
      selected.eligibility = "eligible";
      selected.productIds = [...new Set([...selected.productIds, productId])];
      selected.confirmedAt = new Date().toISOString(); selected.confirmationOrigin = "user_supplied";
      next.id = randomUUID(); next.revision = (next.revision || 0) + 1;
    }
    if (!eligibleOffersForProduct(next, productId).some(item => item.offer.id === saleId)) throw new WorkflowError("Confirm this offer for the product, or choose no offer.", 409);
    return next;
  }

  async confirmCampaignSetup(requestId: string, productId: string, variantId: string | null, referenceAssetId: string, saleId: string | null, confirmOffer = false) {
    const intent = this.session.researchState?.generationIntent;
    if (!intent || intent.requestId !== requestId) throw new WorkflowError("This campaign request changed. Reload before continuing.", 409);
    if (!intent.setupPending) {
      const selected = this.session.research?.campaign;
      if (intent.setup?.referenceAssetId === referenceAssetId && intent.setup.saleId === saleId && selected?.selectedProductId === productId && (selected.selectedVariantId ?? null) === variantId) return this.session;
      throw new WorkflowError("This setup was already confirmed with different choices.", 409);
    }
    this.assertResearchEditable();
    const current = this.session.research;
    if (!current || !intent.researchId || current.id !== intent.researchId || !current.campaign) throw new WorkflowError("Finish campaign research before confirming its setup.", 409);
    const members = scopeForCampaign(current.campaign, current.products || []).members;
    if (!members.some(member => member.productId === productId && member.variantId === variantId)) throw new WorkflowError("Include this product or variant in the campaign first.", 409);
    const ready = memberReferenceReadiness({ productId, variantId }, current.products || [], current.assets || []);
    if (!ready.referenceAssetIds.includes(referenceAssetId)) throw new WorkflowError("Choose a verified photo for this exact product or variant.", 409);
    const directionUrl = current.campaign.direction?.url;
    const requestedVariant = directionUrl && productIdentityUrl(directionUrl) === productIdentityUrl(current.products!.find(item => item.id === productId)!.canonicalUrl) ? new URL(directionUrl).searchParams.get("variant") : null;
    if (requestedVariant && current.products?.find(item => item.id === productId)?.variants.find(item => item.storeId === requestedVariant)?.id !== variantId) throw new WorkflowError("The supplied URL selects a specific variant. Choose its verified photo.", 409);
    const next = this.researchWithOfferChoice(current, productId, saleId, confirmOffer);
    this.session.research = next === current ? { ...structuredClone(current), id: randomUUID(), revision: (current.revision || 0) + 1 } : next;
    const campaign = this.session.research!.campaign!;
    campaign.selectedProductId = productId; campaign.selectedVariantId = variantId; campaign.status = "ready_for_brief";
    this.session.researchState!.stage = "ready_for_brief";
    intent.researchId = this.session.research!.id;
    intent.setup = { referenceAssetId, saleId }; intent.setupPending = false;
    delete intent.pausedReason; delete intent.error;
    delete this.session.brief;
    await this.event("confirm_campaign_setup", "completed", productId);
    return this.session;
  }

  async refineAd(requestId: string, variantId: string, feedback: string) {
    if (!feedback.trim() || feedback.length > 2000) throw new WorkflowError("Describe the change you want in 2,000 characters or fewer.");
    const current = this.session.researchState?.generationIntent;
    if (current?.requestId === requestId) {
      if (current.refinement?.variantId !== variantId || current.refinement.feedback !== feedback.trim()) throw new WorkflowError("This request belongs to another revision.", 409);
      return this.session;
    }
    const parent = this.session.variants.find(item => item.id === variantId);
    if (!parent) throw new WorkflowError("Ad not found.", 404);
    const research = this.session.research;
    if (!research?.campaign || !parent.brief.productId) throw new WorkflowError("Research this product before refining its ad.", 409);
    const member = { productId: parent.brief.productId, variantId: parent.brief.variantId ?? null };
    if (!scopeForCampaign(research.campaign, research.products || []).members.some(item => item.productId === member.productId && item.variantId === member.variantId)) throw new WorkflowError("This ad's product is no longer included. Include it in the campaign before refining.", 409);
    // Target the original ad while preserving today's campaign membership and research.
    await this.selectCampaignMember(member.productId, member.variantId);
    this.session.researchState!.generationIntent = { requestId, source: { direction: this.session.research!.campaign?.direction?.text || parent.brief.direction }, authorizedAt: new Date().toISOString(), researchId: this.session.research!.id, refinement: { variantId, feedback: feedback.trim() } };
    delete this.session.brief;
    await this.deps.save(this.session);
    return this.continueCampaign(requestId);
  }

  async regenerateAd(requestId: string, variantId: string) {
    const current = this.session.researchState?.generationIntent;
    if (current?.requestId === requestId) return this.session;
    const parent = this.session.variants.find(item => item.id === variantId);
    if (!parent) throw new WorkflowError("Ad not found.", 404);
    const research = this.session.research;
    if (!research?.campaign || !parent.brief.productId) throw new WorkflowError("Research this product before regenerating its ad.", 409);
    const member = { productId: parent.brief.productId, variantId: parent.brief.variantId ?? null };
    if (!scopeForCampaign(research.campaign, research.products || []).members.some(item => item.productId === member.productId && item.variantId === member.variantId)) throw new WorkflowError("This ad's product is no longer included. Include it in the campaign before regenerating.", 409);
    await this.selectCampaignMember(member.productId, member.variantId);
    const source = { direction: this.session.research!.campaign?.direction?.text || parent.brief.direction } as const;
    this.session.researchState!.generationIntent = { requestId, source, researchId: this.session.research!.id, authorizedAt: new Date().toISOString() };
    const brief = await this.proposeBrief({ ...parent.brief, variation: "scene", feedback: "Create a fresh visual variation.", parentVariantId: parent.id }, "campaign_generate");
    this.session.researchState!.generationIntent.briefId = brief.id;
    await this.deps.save(this.session);
    return this.session;
  }

  async changeAdOffer(requestId: string, variantId: string, saleId: string | null, confirmOffer = false) {
    const currentIntent = this.session.researchState?.generationIntent;
    if (currentIntent?.requestId === requestId) {
      if (currentIntent.offerChange?.saleId === saleId && currentIntent.offerChange.variantId === variantId) return this.session;
      throw new WorkflowError("This request belongs to another offer change.", 409);
    }
    const parent = this.session.variants.find(item => item.id === variantId);
    if (!parent) throw new WorkflowError("Ad not found.", 404);
    const research = this.session.research;
    if (!research?.campaign || !parent.brief.productId) throw new WorkflowError("Research this product before changing its offer.", 409);
    const member = { productId: parent.brief.productId, variantId: parent.brief.variantId ?? null };
    if (!scopeForCampaign(research.campaign, research.products || []).members.some(item => item.productId === member.productId && item.variantId === member.variantId)) throw new WorkflowError("This ad's product is no longer included. Include it in the campaign first.", 409);
    const nextOfferResearch = this.researchWithOfferChoice(research, member.productId, saleId, confirmOffer);
    await this.selectCampaignMember(member.productId, member.variantId);
    if (nextOfferResearch !== research) {
      const next = structuredClone(this.session.research!);
      next.offers = nextOfferResearch.offers;
      next.id = randomUUID(); next.revision = (next.revision || 0) + 1;
      this.session.research = next;
      this.updatedResearch(next);
    }
    const source = { direction: this.session.research!.campaign?.direction?.text || parent.brief.direction } as const;
    this.session.researchState!.generationIntent = { requestId, source, researchId: this.session.research!.id, authorizedAt: new Date().toISOString(), offerChange: { variantId, saleId } };
    await this.deps.save(this.session);
    return this.continueCampaign(requestId);
  }

  private async event(action: string, status: "started" | "completed" | "failed", detail?: string) {
    this.session.events.push({ at: new Date().toISOString(), action, status, ...(detail ? { detail } : {}) });
    await this.deps.save(this.session);
  }
  private async run<T>(action: string, work: () => Promise<T>): Promise<T> {
    await this.event(action, "started");
    try {
      const result = await work();
      await this.event(action, "completed");
      return result;
    } catch (error) {
      await this.event(action, "failed", safeError(error));
      throw error;
    }
  }
  async research(input: ResearchInput, authorizedDirection?: Direction) {
    this.assertResearchEditable();
    const parsed = researchInputSchema.parse(input);
    const savedBrand = !this.session.research ? await observed("saved-brand", "Loading saved brand research", async () => this.deps.loadBrandResearch?.(parsed.url), event => this.event(event.action, event.status, event.detail)) : null;
    const previous = this.session.research || (savedBrand ? adoptBrandContext(savedBrand) : undefined);
    const intent = this.userInput ? userResearchIntent(this.userInput.text, this.userInput.id, previous) : userResearchIntent([parsed.url, parsed.productUrl, parsed.campaignUrl].filter(Boolean).join(" "));
    const home = previous?.brandKit?.canonicalStoreUrl;
    if (this.userInput && !authorizedDirection) {
      if (!intent.urls.length && !intent.direction) throw new WorkflowError("Choose a direction explicitly or supply a research URL in your current message.");
      const permitted = new Set(intent.urls.map(canonicalUrl));
      if (home) permitted.add(canonicalUrl(home));
      for (const url of [parsed.url, parsed.productUrl, parsed.campaignUrl].filter((url): url is string => !!url)) {
        if (!permitted.has(canonicalUrl(url))) throw new WorkflowError("Research URLs must come from your current message or saved direction choice.");
      }
      if ((parsed.direction || parsed.choiceId) && !intent.direction) throw new WorkflowError("Choose a direction explicitly before campaign research.");
    }
    const direction = authorizedDirection ?? intent.direction;
    if (this.session.purpose === "campaign" && !direction) throw new WorkflowError("Choose what to promote before researching products.", 409);
    if (previous?.brandKit && storeHost(parsed.url) !== storeHost(previous.brandKit.canonicalStoreUrl)) throw new WorkflowError("Start a new campaign to research another store.");
    if (!direction && [parsed.url, parsed.productUrl, parsed.campaignUrl].some(url => url && ["product", "collection"].includes(pageHint(url)))) throw new WorkflowError("Confirm which product or collection you want researched.");
    this.setResearchState({ stage: direction ? "campaign_researching" : "brand_researching", ...(direction ? { direction } : {}) });
    return this.run("research", async () => {
      delete this.session.brief; // Every research edit requires a fresh brief approval.
      const result = await this.deps.research(parsed, { previous, direction, progress: event => this.event(event.action, event.status, event.detail), checkpoint: async partial => {
        this.session.research = partial;
        this.setResearchState({ stage: partial.campaign?.status || "awaiting_direction", ...(partial.campaign?.direction ? { direction: partial.campaign.direction } : {}) });
        await this.deps.save(this.session);
      } });
      this.session.research = result;
      this.setResearchState({ stage: result.campaign?.status || "awaiting_direction", ...(result.campaign?.direction ? { direction: result.campaign.direction } : {}) });
      delete this.session.brief;
      return result;
    });
  }
  async selectProduct(productId: string) {
    this.assertResearchEditable();
    const research = this.session.research;
    if (research?.campaign?.scope) return this.selectCampaignMember(productId, research.campaign.scope.members.find(member => member.productId === productId)?.variantId ?? null);
    if (!research?.campaign?.direction || !research.products?.some(product => product.id === productId)) throw new WorkflowError("Choose a product from the current campaign research.");
    const next = structuredClone(research); next.id = randomUUID(); next.revision = (next.revision || 0) + 1;
    next.campaign!.selectedProductId = productId; next.campaign!.status = "ready_for_brief";
    this.session.research = next; this.setResearchState({ stage: "ready_for_brief", direction: next.campaign!.direction! });
    this.updatedResearch(next);
    delete this.session.brief;
    await this.event("select_product", "completed", productId);
    return next;
  }
  async correctAsset(assetId: string, role: ResearchAsset["role"], productId?: string) {
    this.assertResearchEditable();
    const current = this.session.research;
    const asset = current?.assets?.find(asset => asset.id === assetId);
    const product = current?.products?.find(product => product.id === productId);
    if (!current || !asset || (productId && !product)) throw new WorkflowError("Select an existing asset and product.");
    if (["product_photo", "product_lifestyle"].includes(role) && !product) throw new WorkflowError("Assign this photo to a researched product.");
    const next = structuredClone(current); next.id = randomUUID(); next.revision = (next.revision || 0) + 1;
    const corrected = next.assets!.find(item => item.id === assetId)!;
    corrected.role = role; corrected.classification = ["product_photo", "product_lifestyle", "logo"].includes(role) ? "user_confirmed" : "excluded";
    corrected.variantIds = product && corrected.productIds.includes(product.id) ? corrected.variantIds.filter(id => product.variants.some(variant => variant.id === id && variant.assetIds.includes(assetId))) : [];
    corrected.productIds = product ? [product.id] : [];
    corrected.eligibleAsProductReference = !!product && ["product_photo", "product_lifestyle"].includes(role);
    corrected.evidence = { ...corrected.evidence, origin: "user_supplied", method: "user", quote: `Owner classified this image as ${role}${product ? ` for ${product.title}` : ""}.` };
    for (const item of next.products || []) item.assetIds = [...item.assetIds.filter(id => id !== assetId), ...(item.id === productId && corrected.eligibleAsProductReference ? [assetId] : [])];
    if (next.brandKit) next.brandKit.logoAssetIds = [...next.brandKit.logoAssetIds.filter(id => id !== assetId), ...(role === "logo" ? [assetId] : [])];
    if (next.campaign) {
      const members = scopeForCampaign(next.campaign, next.products || []).members;
      const target = next.campaign.selectedProductId ? members.find(member => member.productId === next.campaign!.selectedProductId && member.variantId === (next.campaign!.selectedVariantId ?? null)) : members.find(member => memberReferenceReadiness(member, next.products || [], next.assets || []).status === "ready");
      const ready = target && memberReferenceReadiness(target, next.products || [], next.assets || []).status === "ready";
      if (ready) { next.campaign.selectedProductId = target.productId; next.campaign.selectedVariantId = target.variantId; }
      next.campaign.status = ready ? "ready_for_brief" : "needs_selection";
      this.setResearchState({ stage: next.campaign.status, direction: next.campaign.direction ?? undefined });
    }
    this.session.research = next;
    this.updatedResearch(next);
    delete this.session.brief;
    await this.event("correct_asset", "completed", assetId); return next;
  }
  async confirmOffer(offerId: string, productId: string) {
    this.assertResearchEditable();
    const current = this.session.research;
    const offer = current?.offers?.find(item => item.id === offerId);
    if (!current || !offer || !current.products?.some(product => product.id === productId)) throw new WorkflowError("Select an existing offer and product.");
    if (Date.now() - Date.parse(offer.checkedAt) > 86400000 || (offer.endsAt && Date.parse(offer.endsAt) <= Date.now())) throw new WorkflowError("This offer is stale or expired. Research its source again before confirming eligibility.");
    const next = structuredClone(current); next.id = randomUUID(); next.revision = (next.revision || 0) + 1;
    const confirmed = next.offers!.find(item => item.id === offerId)!;
    confirmed.eligibility = "eligible"; confirmed.productIds = [...new Set([...confirmed.productIds, productId])];
    confirmed.confirmedAt = new Date().toISOString(); confirmed.confirmationOrigin = "user_supplied";
    this.session.research = next; this.updatedResearch(next); delete this.session.brief;
    await this.event("confirm_offer", "completed", offerId); return next;
  }
  async correctBrand(field: "voice" | "audience" | "valueProposition", value: string) {
    this.assertResearchEditable();
    if (!this.session.research?.brandKit) throw new WorkflowError("Research the brand first.");
    const next = structuredClone(this.session.research); next.id = randomUUID(); next.revision = (next.revision || 0) + 1;
    next.brandKit!.overrides[field] = value.slice(0, 2000); next.brandKit!.revision++;
    if (field === "voice" || field === "audience") next[field] = value.slice(0, 2000);
    this.session.research = next; this.updatedResearch(next); delete this.session.brief;
    await this.event("correct_brand", "completed", field); return next;
  }
  async proposeBrief(input: BriefInput, approvalOrigin: Brief["approvalOrigin"] = "user_brief", retryFrom?: Brief) {
    if (!retryFrom) this.assertResearchEditable();
    const data = briefSchema.parse(input);
    const research = this.session.research;
    if (!research) throw new WorkflowError("Research a store before drafting an ad.");
    if (this.session.researchState?.stage === "awaiting_direction") throw new WorkflowError("Choose a direction before preparing a brief.", 409);
    groundBrief(data, research);
    if (data.parentVariantId && !this.session.variants.some(variant => variant.id === data.parentVariantId)) throw new WorkflowError("Parent variant not found.");
    const tokens = retryFrom?.tokens ?? resolveBrandTokens(research);
    const next: Brief = { ...data, design: data.design ?? structuredClone(DEFAULT_DESIGN), tokens, id: randomUUID(), researchId: research.id, approvalOrigin, ...(retryFrom ? { retryOfBriefId: retryFrom.id } : {}) };
    await validateCreative(next, research);
    const parent = this.session.variants.find(variant => variant.id === next.parentVariantId);
    // Grounding above proves that the exact original is still valid in today's research.
    next.sourceAssetId = parent?.sourceAssetId && parent.brief.productId === next.productId && parent.brief.referenceAssetId === next.referenceAssetId && (parent.brief.variantId ?? null) === (next.variantId ?? null) && parent.referenceImage === next.referenceImage
      ? parent.sourceAssetId : await (this.deps.pinSourceAsset ?? pinSourceAsset)({ sourceUrl: next.referenceImage, researchId: research.id });
    const logoCandidateId = data.logoAssetId === null ? null : data.logoAssetId ?? research.brandKit?.selectedLogoAssetId;
    const logo = research.assets?.find(asset => asset.id === logoCandidateId && asset.role === "logo" && ["verified_structure", "user_confirmed"].includes(asset.classification));
    if (logo) next.logoSourceAssetId = await (this.deps.pinSourceAsset ?? pinSourceAsset)({ sourceUrl: logo.originalUrl, researchId: research.id, kind: "logo" });
    next.executionPlan = retryFrom ? retryExecution(next, research, retryFrom) : planExecution(next, research, parent);
    this.session.brief = next;
    if (approvalOrigin === "campaign_generate" && this.session.researchState?.generationIntent) this.session.researchState.generationIntent.briefId = next.id;
    await this.event("brief", "completed", approvalOrigin === "campaign_generate" ? "Creative plan saved for your requested generation." : "Waiting for human approval of this revision and photo.");
    return this.session.brief;
  }
  private async requireDesign() {
    const brief = this.session.brief;
    if (brief && (brief.design?.version !== 2 || !brief.tokens || !brief.executionPlan || !brief.sourceAssetId)) {
      await this.proposeBrief({ ...brief, design: brief.design?.version === 2 ? brief.design : structuredClone(DEFAULT_DESIGN) });
      throw new WorkflowError("This legacy brief now has a new design revision. Review and approve its design and copy before generating.", 409);
    }
  }
  async approveBrief(id: string) {
    const brief = this.session.brief;
    if (!brief || brief.id !== id) throw new WorkflowError("The brief changed. Review the current revision first.", 409);
    await this.requireDesign();
    if (brief.generationAttemptedAt) throw new WorkflowError("This revision already attempted generation. Draft and approve a new revision to try again.", 409);
    groundBrief(brief, this.session.research!, false);
    validatePlan(brief, this.session.research!);
    if (!brief.sourceAssetId || !await (this.deps.readAsset ?? readAsset)(brief.sourceAssetId)) throw new WorkflowError("The saved original photo is missing. Restore it before approval.");
    brief.approvedAt = new Date().toISOString();
    await this.event("approve_brief", "completed", id);
    return brief;
  }
  async generate(expectedBriefId?: string) {
    if (expectedBriefId && this.session.brief?.id !== expectedBriefId) throw new WorkflowError("The brief changed. Review the current revision first.", 409);
    // Completed legacy variants remain viewable and idempotent.
    const completed = this.session.variants.find(variant => variant.brief.id === this.session.brief?.id);
    if (completed) return completed;
    await this.requireDesign();
    const { brief, research } = this.session;
    if (!brief?.approvedAt || !research || brief.researchId !== research.id) throw new WorkflowError("Approve the current brief and product photo before generating.", 409);
    groundBrief(brief, research, false);
    await validateCreative(brief, research);
    validatePlan(brief, research);
    let intent = this.session.researchState?.generationIntent;
    if (!intent || intent.briefId !== brief.id) {
      const direction = research.campaign?.direction?.text || brief.direction || "Approved creative brief";
      this.session.researchState ??= { stage: research.campaign?.status || "ready_for_brief", direction: research.campaign?.direction ?? undefined };
      intent = this.session.researchState.generationIntent = {
        requestId: randomUUID(), source: { direction }, researchId: research.id, briefId: brief.id, authorizedAt: new Date().toISOString(),
      };
      await this.deps.save(this.session); // Persist the generation request before paid work.
    }
    const parent = this.session.variants.find(variant => variant.id === brief.parentVariantId);
    const saved: Partial<Record<Stage, NonNullable<typeof brief.sceneCheckpoint>["asset"]>> = {};
    for (const stage of ["scene"] as const) {
      const checkpoint = brief[`${stage}Checkpoint`];
      const plan = brief.executionPlan![stage];
      const asset = checkpoint?.state === "saved" ? checkpoint.asset : plan.action === "reuse" ? parent?.[`${stage}Asset`] : undefined;
      if (asset && (asset.id !== plan.assetId || !matchesStage(asset, plan.fingerprint))) throw new WorkflowError(`Saved ${stage} checkpoint is incompatible. Save a new revision.`);
      if (plan.action === "reuse" && !asset) throw new WorkflowError(`Approved ${stage} reuse is missing. No replacement was generated.`);
      if (asset && !await (this.deps.readAsset ?? readAsset)(asset.id)) throw new WorkflowError(`Saved ${stage} bytes are missing. Restore the asset before proceeding.`);
      if (checkpoint?.state === "attempted" && !checkpoint.provider) throw new WorkflowError(`The ${stage} request was already attempted. Its outcome is unknown; inspect saved events before approving another paid revision.`, 409);
      saved[stage] = asset;
    }
    return this.run("generate", async () => {
      const output = await this.deps.createAd(brief, research, {
        ...saved,
        beforeAttempt: async stage => {
          if (brief[`${stage}Checkpoint`]?.attemptedAt) throw new WorkflowError(`The ${stage} request was already attempted.`, 409);
          // The HTTP handler has five minutes. Leave the full 150-second fal
          // timeout plus two 30-second persistence calls (attempt and result).
          // A saved provider result can resume in a fresh request without paying again.
          if (this.requestDeadline - (this.deps.now ?? Date.now)() < 210_000) {
            throw new ContinueInFreshRequest("The request is nearly out of time. Saved stages are retained; continue in a fresh request. No new image request was made.", 409);
          }
          const now = new Date().toISOString();
          const previousAttempt = brief.generationAttemptedAt;
          const previousCheckpoint = brief[`${stage}Checkpoint`];
          brief.generationAttemptedAt ??= now;
          brief[`${stage}Checkpoint`] = { state: "attempted", attemptedAt: now };
          try { await this.deps.save(this.session); } // Database guards the transition before paid dispatch.
          catch (error) {
            // The provider call is after this awaited save. A failed reservation
            // must not be persisted as a paid attempt by the outer error save.
            if (previousCheckpoint) brief[`${stage}Checkpoint`] = previousCheckpoint; else delete brief[`${stage}Checkpoint`];
            if (previousAttempt) brief.generationAttemptedAt = previousAttempt; else delete brief.generationAttemptedAt;
            throw error;
          }
        },
        providerResult: async (stage, provider) => {
          brief[`${stage}Checkpoint`] = { ...brief[`${stage}Checkpoint`], state: "output_pending_storage", provider };
          await this.deps.save(this.session);
        },
        failed: async (stage, failure) => {
          brief[`${stage}Checkpoint`] = { ...brief[`${stage}Checkpoint`], state: "attempted", failure };
          await this.deps.save(this.session);
        },
        checkpoint: async (stage, asset) => {
          brief[`${stage}Checkpoint`] = { ...brief[`${stage}Checkpoint`], state: "saved", asset: structuredClone(asset) };
          await this.deps.save(this.session);
        },
      });
      const variant: Variant = { ...output, brief: structuredClone(brief), research: structuredClone(research), status: "pending_review" };
      this.session.variants.push(variant);
      await this.deps.save(this.session); // Review failure must never lose the image.
      await this.review(variant.id);
      return variant;
    });
  }
  async review(id: string) {
    const variant = this.session.variants.find(item => item.id === id);
    if (!variant) throw new WorkflowError("Variant not found.", 404);
    variant.status = "pending_review";
    delete variant.acceptance;
    delete variant.review;
    await this.deps.save(this.session); // Re-review immediately revokes finished-ad approval.
    try {
      await this.run("review", async () => {
        const result = await this.deps.reviewAd(variant);
        variant.review = result;
        variant.status = "reviewed";
        delete variant.reviewError;
      });
    } catch (error) {
      variant.status = "review_failed";
      variant.reviewError = safeError(error);
      delete variant.review;
      await this.deps.save(this.session);
    }
    return variant;
  }
  async remember(key: string, value: string) {
    // Preferences steer the next brief. Updating them invalidates pending approval.
    this.session.preferences = { ...this.session.preferences, [key]: value };
    if (this.session.brief && !this.session.variants.some(variant => variant.brief.id === this.session.brief!.id)) delete this.session.brief.approvedAt;
    await this.event("remember", "completed", key);
    return this.session.preferences;
  }
  async approveVariant(id: string, overrideReview = false) {
    const variant = this.session.variants.find(item => item.id === id);
    if (!variant) throw new WorkflowError("Variant not found.", 404);
    if (variant.status === "approved") return variant;
    const issue = acceptanceIssue(variant, overrideReview);
    if (issue) throw new WorkflowError(issue, 409);
    const acceptedAt = new Date().toISOString();
    variant.status = "approved";
    variant.acceptance = { acceptedAt, reviewedAt: variant.review!.createdAt, ...(overrideReview && requiresReviewOverride(variant) ? { reviewOverridden: true } : {}) };
    await this.event("approve_ad", "completed", id);
    return variant;
  }
}
