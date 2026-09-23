import { createGateway } from "ai";
import { WorkflowError } from "./validation";

export const FREE_WORKFLOW_MODEL = "inclusionai/ling-3.0-flash-vl-free";
export const RESEARCHER_MODEL = "openai/gpt-5.4-nano";
export const FINAL_AD_REVIEW_MODEL = "openai/gpt-5.4";
export const FINAL_AD_REVIEW_FALLBACK_MODEL = FREE_WORKFLOW_MODEL;

function gatewayModel(model: string) {
  const apiKey = process.env.AI_GATEWAY_API_KEY || process.env.AI_GATEWAY_KEY;
  if (!apiKey) throw new WorkflowError("Set AI_GATEWAY_API_KEY (or AI_GATEWAY_KEY) in .env.local.", 503);
  return createGateway({ apiKey })(model);
}

export function workflowModel(role: "concierge" | "researcher" | "brief") {
  const fallback = role === "concierge" ? FREE_WORKFLOW_MODEL : RESEARCHER_MODEL;
  return gatewayModel(process.env[`${role.toUpperCase()}_MODEL`] || fallback);
}

export function finalAdReviewModel() {
  return gatewayModel(process.env.FINAL_AD_REVIEW_MODEL || FINAL_AD_REVIEW_MODEL);
}

/** Keep review available when the Gateway account cannot access the stronger paid model. */
export function finalAdReviewFallbackModel() {
  return gatewayModel(process.env.FINAL_AD_REVIEW_FALLBACK_MODEL || FINAL_AD_REVIEW_FALLBACK_MODEL);
}
