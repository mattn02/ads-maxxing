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

export type WorkflowDependencies = { research: typeof research; createAd: typeof createAd; reviewAd: typeof reviewAd; save: typeof saveSession; readVisual: typeof readVisual };
const defaults: WorkflowDependencies = { research, createAd, reviewAd, save: saveSession, readVisual };

/** Workflow rules live here, independently of the LLM, HTTP routes and UI. */
export class Workflow {
  constructor(public session: Session, private deps: WorkflowDependencies = defaults) {}

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
    return this.run("research", async () => {
      const result = await this.deps.research(researchInputSchema.parse(input));
      this.session.research = result;
      delete this.session.brief; // New evidence invalidates old approval.
      return result;
    });
  }
  async proposeBrief(input: BriefInput) {
    const data = briefSchema.parse(input);
    const research = this.session.research;
    if (!research) throw new WorkflowError("Research a store before drafting an ad.");
    const source = research.sources.find(source => new URL(source.url).href === new URL(data.productUrl).href);
    if (!source) {
      throw new WorkflowError("Select a photo from the researched product page. Research another page if the product is missing.");
    }
    data.productUrl = source.url;
    if (!source.images.includes(data.referenceImage)) {
      const requested = new URL(data.referenceImage);
      // A model may omit CDN size/version parameters. Resolve only a unique
      // known asset, then send its original scraped URL to the artist.
      const candidates = source.images.filter(image => {
        const known = new URL(image);
        return known.href === requested.href || (!requested.search && known.origin === requested.origin && known.pathname === requested.pathname);
      });
      if (candidates.length !== 1) throw new WorkflowError("The photo reference is missing or ambiguous. Select the exact photo in the brief editor.");
      data.referenceImage = candidates[0];
    }
    if (data.saleId && !research.sales.some(sale => sale.id === data.saleId)) throw new WorkflowError("This sale is not supported by the saved research.");
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
