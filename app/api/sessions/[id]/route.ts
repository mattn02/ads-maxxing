import { researchBrand } from "@/lib/workflow/onboarding";
import { validateStoreHost } from "@/lib/workflow/brands";
import { authenticated } from "@/lib/supabase/server";
import { publicSession } from "@/lib/workflow/public-session";
import { z } from "zod";
import { assetSchema } from "@/lib/workflow/research/contracts";
import { briefSchema } from "@/lib/workflow/schema";
import { Workflow } from "@/lib/workflow/service";
import { loadSession, lockSession } from "@/lib/workflow/sessions";
import { apiError, WorkflowError } from "@/lib/workflow/validation";
import { generateCampaignActionSchema, continueCampaignActionSchema, retryCreativeActionSchema, regenerateAdActionSchema, setCampaignScopeActionSchema, selectCampaignMemberActionSchema, generateCampaignMemberActionSchema, confirmCampaignSetupActionSchema, changeAdOfferActionSchema, refineAdActionSchema } from "@/lib/workflow/generation-contracts";
export const runtime = "nodejs";
export const maxDuration = 300;
type Context = { params: Promise<{ id: string }> };
const actionSchema = z.discriminatedUnion("action", [
  generateCampaignActionSchema, continueCampaignActionSchema, retryCreativeActionSchema, regenerateAdActionSchema,
  setCampaignScopeActionSchema, selectCampaignMemberActionSchema, generateCampaignMemberActionSchema, confirmCampaignSetupActionSchema, changeAdOfferActionSchema, refineAdActionSchema,
  z.object({ action: z.literal("researchBrand"), operationId: z.string().uuid() }),
  z.object({ action: z.literal("confirmOffer"), offerId: z.string(), productId: z.string() }),
  z.object({ action: z.literal("selectProduct"), productId: z.string() }),
  z.object({ action: z.literal("correctAsset"), assetId: z.string(), role: assetSchema.shape.role, productId: z.string().optional() }),
  z.object({ action: z.literal("correctBrand"), field: z.enum(["voice", "audience", "valueProposition"]), value: z.string().trim().min(1).max(2000) }),
  z.object({ action: z.literal("approveBrief"), briefId: z.string() }),
  z.object({ action: z.literal("generateAd"), briefId: z.string().min(1) }),
  z.object({ action: z.literal("reviseBrief"), brief: briefSchema }),
  z.object({ action: z.literal("approveAd"), variantId: z.string(), overrideReview: z.boolean().optional() }),
  z.object({ action: z.literal("reviewAd"), variantId: z.string() }),
]);
export async function GET(_request: Request, { params }: Context) {
  return authenticated(_request, async () => Response.json(publicSession(await loadSession((await params).id))));
}
export async function POST(request: Request, { params }: Context) {
  return authenticated(request, async () => {
  let release: (() => Promise<void>) | undefined;
  try {
    const { id } = await params;
    release = await lockSession(id);
    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) throw new WorkflowError("Invalid workflow action or brief.");
    const workflow = new Workflow(await loadSession(id));
    const action = parsed.data;
    if (action.action === "researchBrand") {
      if (workflow.session.setup) await validateStoreHost(workflow.session.setup.storeUrl);
      await researchBrand(workflow.session, action.operationId);
      return Response.json(publicSession(workflow.session));
    }
    if (workflow.session.purpose !== "campaign" || !workflow.session.research?.brandKit) throw new WorkflowError("Finish brand setup and choose Make creatives first.", 409);
    switch (action.action) {
      case "generateCampaign": await workflow.generateCampaign(action.requestId, action.source); break;
      case "continueCampaign": await workflow.continueCampaign(action.requestId); break;
      case "setCampaignScope": await workflow.setCampaignScope(action.members); break;
      case "selectCampaignMember": await workflow.selectCampaignMember(action.productId, action.variantId); break;
      case "generateCampaignMember": await workflow.generateCampaignMember(action.requestId, action.productId, action.variantId); break;
      case "confirmCampaignSetup": await workflow.confirmCampaignSetup(action.requestId, action.productId, action.variantId, action.referenceAssetId, action.saleId, action.confirmOffer); break;
      case "changeAdOffer": await workflow.changeAdOffer(action.requestId, action.variantId, action.saleId, action.confirmOffer); break;
      case "refineAd": await workflow.refineAd(action.requestId, action.variantId, action.feedback); break;
      case "regenerateAd": await workflow.regenerateAd(action.requestId, action.variantId); break;
      case "retryCreative": await workflow.retryCreative(action.requestId, action.previousRequestId, action.briefId, action.acknowledgePossibleDuplicate); break;
      case "confirmOffer": await workflow.confirmOffer(action.offerId, action.productId); break;
      case "selectProduct": await workflow.selectProduct(action.productId); break;
      case "correctAsset": await workflow.correctAsset(action.assetId, action.role, action.productId); break;
      case "correctBrand": await workflow.correctBrand(action.field, action.value); break;
      case "approveBrief": await workflow.approveBrief(action.briefId); break;
      case "generateAd": await workflow.generate(action.briefId); break;
      case "reviseBrief": await workflow.proposeBrief(action.brief); break;
      case "approveAd": await workflow.approveVariant(action.variantId, action.overrideReview); break;
      case "reviewAd": await workflow.review(action.variantId); break;
    }
    // The lease is released in finally before the browser can start its next step.
    return Response.json(publicSession({ ...workflow.session, leaseExpiresAt: undefined }));
  } catch (error) { return apiError(error); }
  finally { await release?.(); }
  });
}
