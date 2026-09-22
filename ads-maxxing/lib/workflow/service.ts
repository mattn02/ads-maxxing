import { randomUUID } from "node:crypto";
import { briefSchema, researchInputSchema, type BriefInput, type ResearchInput } from "./schema";
import type { Session, Variant } from "./session-types";
import { saveSession } from "./sessions";
import { safeError, WorkflowError } from "./validation";
import { research } from "./agents/researcher";
import { createAd } from "./agents/artist";
import { reviewAd } from "./agents/reviewer";
import { DEFAULT_DESIGN } from "./creative/schema";
import { resolveBrandTokens } from "./creative/tokens";
import { validateCreative } from "./creative/fit";
import { compatibleParent, matchesVisual } from "./creative/reuse";
import { readVisual } from "./storage";
import { userResearchIntent } from "./research/intent";
import { canonicalUrl, pageHint, storeHost } from "./research/extract";
import { groundBrief } from "./research/grounding";
import type { ResearchAsset } from "./research/contracts";

export type WorkflowDependencies = { research: typeof research; createAd: typeof createAd; reviewAd: typeof reviewAd; save: typeof saveSession; readVisual: typeof readVisual };
const defaults: WorkflowDependencies = { research, createAd, reviewAd, save: saveSession, readVisual };

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
    const previous = this.session.research;
    const intent = this.userInput ? userResearchIntent(this.userInput.text, this.userInput.id, previous) : userResearchIntent([parsed.url, parsed.productUrl, parsed.campaignUrl].filter(Boolean).join(" "));
    const home = previous?.brandKit?.canonicalStoreUrl;
    if (this.userInput) {
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
    const next = { ...data, design: data.design ?? structuredClone(DEFAULT_DESIGN), tokens: resolveBrandTokens(research), id: randomUUID(), researchId: research.id };
    await validateCreative(next, research);
    this.session.brief = next;
    await this.event("brief", "completed", "Waiting for human approval of this revision and photo.");
    return this.session.brief;
  }
  private async requireDesign() {
    const brief = this.session.brief;
    if (brief && (!brief.design || !brief.tokens)) {
      await this.proposeBrief(brief);
      throw new WorkflowError("This legacy brief now has a new design revision. Review and approve its design and copy before generating.", 409);
    }
  }
  async approveBrief(id: string) {
    const brief = this.session.brief;
    if (!brief || brief.id !== id) throw new WorkflowError("The brief changed. Review the current revision first.", 409);
    await this.requireDesign();
    if (brief.generationAttemptedAt) throw new WorkflowError("This revision already attempted generation. Draft and approve a new revision to try again.", 409);
    groundBrief(brief, this.session.research!, false);
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
    if (brief.generationAttemptedAt && !brief.visualCheckpoint) throw new WorkflowError("Generation was already attempted. Check saved outputs/events before approving a new revision; a timed-out request may be billed.", 409);
    groundBrief(brief, research, false);
    await validateCreative(brief, research);
    let asset = brief.visualCheckpoint;
    if (asset && !matchesVisual(brief, asset)) throw new WorkflowError("Saved visual checkpoint is incompatible with this brief. Save a new revision.");
    if (!asset && brief.design?.reuseVisualFromVariantId) {
      const parent = this.session.variants.find(variant => variant.id === brief.design!.reuseVisualFromVariantId);
      if (!compatibleParent(brief, parent)) throw new WorkflowError("Requested visual reuse is incompatible or missing. Use the matching parent/photo/direction, or save and approve a brief requesting a new visual.");
      asset = parent!.visualAsset;
    }
    if (asset && !await this.deps.readVisual(asset.id)) throw new WorkflowError("Saved visual bytes are missing. Restore the asset or save a new brief explicitly requesting a new visual.");
    brief.generationAttemptedAt ??= new Date().toISOString();
    await this.deps.save(this.session); // Persist before the paid side effect.
    return this.run("generate", async () => {
      const output = await this.deps.createAd(brief, research, {
        visual: asset,
        checkpoint: async visual => {
          brief.visualCheckpoint = structuredClone(visual);
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
    if (this.session.brief) delete this.session.brief.approvedAt;
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
