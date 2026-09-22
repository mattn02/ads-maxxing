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
import { validateCreative } from "./creative/fit";
import { adoptBrandContext } from "./research/brand-context";
import { userResearchIntent } from "./research/intent";
import { canonicalUrl, pageHint, storeHost } from "./research/extract";
import { groundBrief } from "./research/grounding";
import type { ResearchAsset } from "./research/contracts";
import { planExecution, validatePlan, matchesStage } from "./creative/reuse";
import { readVisual, readAsset, pinSourceAsset } from "./storage";

export type WorkflowDependencies = { loadBrandResearch?: (storeUrl: string) => Promise<Research | null>; research: typeof research; createAd: typeof createAd; reviewAd: typeof reviewAd; save: typeof saveSession; readVisual: typeof readVisual; readAsset?: typeof readAsset; pinSourceAsset?: typeof pinSourceAsset };
const defaults: WorkflowDependencies = { loadBrandResearch, research, createAd, reviewAd, save: saveSession, readVisual, readAsset, pinSourceAsset };

/** Workflow rules live here, independently of the LLM, HTTP routes and UI. */
export class Workflow {
  constructor(public session: Session, private deps: WorkflowDependencies = defaults) {}

  private userInput?: { text: string; id?: string };
  setUserInput(text: string, id?: string) { this.userInput = { text, id }; }

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
  async research(input: ResearchInput) {
    const parsed = researchInputSchema.parse(input);
    const savedBrand = !this.session.research ? await this.deps.loadBrandResearch?.(parsed.url) : null;
    const previous = this.session.research || (savedBrand ? adoptBrandContext(savedBrand) : undefined);
    const intent = this.userInput ? userResearchIntent(this.userInput.text, this.userInput.id, previous) : userResearchIntent([parsed.url, parsed.productUrl, parsed.campaignUrl].filter(Boolean).join(" "));
    const home = previous?.brandKit?.canonicalStoreUrl;
    if (this.userInput) {
      if (!intent.urls.length && !intent.direction) throw new WorkflowError("Choose a direction explicitly or supply a research URL in your current message.");
      const permitted = new Set(intent.urls.map(canonicalUrl));
      if (home) permitted.add(canonicalUrl(home));
      for (const url of [parsed.url, parsed.productUrl, parsed.campaignUrl].filter((url): url is string => !!url)) {
        if (!permitted.has(canonicalUrl(url))) throw new WorkflowError("Research URLs must come from your current message or saved direction choice.");
      }
      if ((parsed.direction || parsed.choiceId) && !intent.direction) throw new WorkflowError("Choose a direction explicitly before campaign research.");
    }
    const direction = intent.direction;
    if (previous?.brandKit && storeHost(parsed.url) !== storeHost(previous.brandKit.canonicalStoreUrl)) throw new WorkflowError("Start a new campaign to research another store.");
    if (!direction && [parsed.url, parsed.productUrl, parsed.campaignUrl].some(url => url && ["product", "collection"].includes(pageHint(url)))) throw new WorkflowError("Confirm which product or collection you want researched.");
    this.session.researchState = { stage: direction ? "campaign_researching" : "brand_researching", ...(direction ? { direction } : {}) };
    return this.run("research", async () => {
      delete this.session.brief; // Every research edit requires a fresh brief approval.
      const result = await this.deps.research(parsed, { previous, direction, checkpoint: async partial => {
        this.session.research = partial;
        this.session.researchState = { stage: partial.campaign?.status || "awaiting_direction", ...(partial.campaign?.direction ? { direction: partial.campaign.direction } : {}) };
        await this.deps.save(this.session);
      } });
      this.session.research = result;
      this.session.researchState = { stage: result.campaign?.status || "awaiting_direction", ...(result.campaign?.direction ? { direction: result.campaign.direction } : {}) };
      delete this.session.brief;
      return result;
    });
  }
  async selectProduct(productId: string) {
    const research = this.session.research;
    if (!research?.campaign?.direction || !research.products?.some(product => product.id === productId)) throw new WorkflowError("Choose a product from the current campaign research.");
    const next = structuredClone(research); next.id = randomUUID(); next.revision = (next.revision || 0) + 1;
    next.campaign!.selectedProductId = productId; next.campaign!.status = "ready_for_brief";
    this.session.research = next; this.session.researchState = { stage: "ready_for_brief", direction: next.campaign!.direction! };
    delete this.session.brief;
    await this.event("select_product", "completed", productId);
    return next;
  }
  async correctAsset(assetId: string, role: ResearchAsset["role"], productId?: string) {
    const current = this.session.research;
    const asset = current?.assets?.find(asset => asset.id === assetId);
    const product = current?.products?.find(product => product.id === productId);
    if (!current || !asset || (productId && !product)) throw new WorkflowError("Select an existing asset and product.");
    if (["product_photo", "product_lifestyle"].includes(role) && !product) throw new WorkflowError("Assign this photo to a researched product.");
    const next = structuredClone(current); next.id = randomUUID(); next.revision = (next.revision || 0) + 1;
    const corrected = next.assets!.find(item => item.id === assetId)!;
    corrected.role = role; corrected.classification = ["product_photo", "product_lifestyle", "logo"].includes(role) ? "user_confirmed" : "excluded";
    corrected.productIds = product ? [product.id] : []; corrected.variantIds = [];
    corrected.eligibleAsProductReference = !!product && ["product_photo", "product_lifestyle"].includes(role);
    corrected.evidence = { ...corrected.evidence, origin: "user_supplied", method: "user", quote: `Owner classified this image as ${role}${product ? ` for ${product.title}` : ""}.` };
    for (const item of next.products || []) item.assetIds = [...item.assetIds.filter(id => id !== assetId), ...(item.id === productId && corrected.eligibleAsProductReference ? [assetId] : [])];
    if (next.brandKit) next.brandKit.logoAssetIds = [...next.brandKit.logoAssetIds.filter(id => id !== assetId), ...(role === "logo" ? [assetId] : [])];
    this.session.research = next;
    delete this.session.brief;
    await this.event("correct_asset", "completed", assetId); return next;
  }
  async confirmOffer(offerId: string, productId: string) {
    const current = this.session.research;
    const offer = current?.offers?.find(item => item.id === offerId);
    if (!current || !offer || !current.products?.some(product => product.id === productId)) throw new WorkflowError("Select an existing offer and product.");
    if (Date.now() - Date.parse(offer.checkedAt) > 86400000 || (offer.endsAt && Date.parse(offer.endsAt) <= Date.now())) throw new WorkflowError("This offer is stale or expired. Research its source again before confirming eligibility.");
    const next = structuredClone(current); next.id = randomUUID(); next.revision = (next.revision || 0) + 1;
    const confirmed = next.offers!.find(item => item.id === offerId)!;
    confirmed.eligibility = "eligible"; confirmed.productIds = [...new Set([...confirmed.productIds, productId])];
    confirmed.confirmedAt = new Date().toISOString(); confirmed.confirmationOrigin = "user_supplied";
    this.session.research = next; delete this.session.brief;
    await this.event("confirm_offer", "completed", offerId); return next;
  }
  async correctBrand(field: "voice" | "audience" | "valueProposition", value: string) {
    if (!this.session.research?.brandKit) throw new WorkflowError("Research the brand first.");
    const next = structuredClone(this.session.research); next.id = randomUUID(); next.revision = (next.revision || 0) + 1;
    next.brandKit!.overrides[field] = value.slice(0, 2000); next.brandKit!.revision++;
    if (field === "voice" || field === "audience") next[field] = value.slice(0, 2000);
    this.session.research = next; delete this.session.brief;
    await this.event("correct_brand", "completed", field); return next;
  }
  async proposeBrief(input: BriefInput) {
    const data = briefSchema.parse(input);
    const research = this.session.research;
    if (!research) throw new WorkflowError("Research a store before drafting an ad.");
    if (this.session.researchState?.stage === "awaiting_direction") throw new WorkflowError("Choose a direction before preparing a brief.", 409);
    groundBrief(data, research);
    if (data.parentVariantId && !this.session.variants.some(variant => variant.id === data.parentVariantId)) throw new WorkflowError("Parent variant not found.");
    const next: Brief = { ...data, design: data.design ?? structuredClone(DEFAULT_DESIGN), tokens: resolveBrandTokens(research), id: randomUUID(), researchId: research.id };
    await validateCreative(next, research);
    const parent = this.session.variants.find(variant => variant.id === next.parentVariantId);
    // A revision of the same saved research/photo retains the approved immutable source.
    next.sourceAssetId = parent?.sourceAssetId && parent.brief.researchId === next.researchId && parent.referenceImage === next.referenceImage
      ? parent.sourceAssetId : await (this.deps.pinSourceAsset ?? pinSourceAsset)({ sourceUrl: next.referenceImage, researchId: research.id });
    const logoCandidateId = data.logoAssetId === null ? null : data.logoAssetId ?? research.brandKit?.selectedLogoAssetId;
    const logo = research.assets?.find(asset => asset.id === logoCandidateId && asset.role === "logo");
    if (logo) next.logoSourceAssetId = await (this.deps.pinSourceAsset ?? pinSourceAsset)({ sourceUrl: logo.originalUrl, researchId: research.id, kind: "logo" });
    next.executionPlan = planExecution(next, parent);
    this.session.brief = next;
    await this.event("brief", "completed", "Waiting for human approval of this revision and photo.");
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
    validatePlan(brief);
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
    validatePlan(brief);
    const parent = this.session.variants.find(variant => variant.id === brief.parentVariantId);
    const saved: Partial<Record<Stage, NonNullable<typeof brief.backgroundCheckpoint>["asset"]>> = {};
    for (const stage of ["background", "scene"] as const) {
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
          const now = new Date().toISOString();
          brief.generationAttemptedAt ??= now;
          brief[`${stage}Checkpoint`] = { state: "attempted", attemptedAt: now };
          await this.deps.save(this.session); // Database guards the per-stage transition before paid dispatch.
        },
        providerResult: async (stage, provider) => {
          brief[`${stage}Checkpoint`] = { ...brief[`${stage}Checkpoint`], state: "output_pending_storage", provider };
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
    delete variant.review;
    await this.deps.save(this.session); // Re-review immediately revokes finished-ad approval.
    try {
      await this.run("review", async () => {
        const result = await this.deps.reviewAd(variant);
        variant.review = result;
        variant.status = result.verdict === "pass" ? "reviewed" : result.verdict;
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
  async approveVariant(id: string) {
    const variant = this.session.variants.find(item => item.id === id);
    if (!variant) throw new WorkflowError("Variant not found.", 404);
    if (variant.status !== "reviewed" && variant.status !== "approved") throw new WorkflowError("Resolve the review findings before approving this ad.", 409);
    variant.status = "approved";
    await this.event("approve_ad", "completed", id);
    return variant;
  }
}
