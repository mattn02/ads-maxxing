import { createGateway } from "ai";
import { WorkflowError } from "./validation";

export const FREE_WORKFLOW_MODEL = "inclusionai/ling-3.0-flash-vl-free";

export function workflowModel(role: "concierge" | "researcher" | "reviewer") {
  const apiKey = process.env.AI_GATEWAY_API_KEY || process.env.AI_GATEWAY_KEY;
  if (!apiKey) throw new WorkflowError("Set AI_GATEWAY_API_KEY (or AI_GATEWAY_KEY) in .env.local.", 503);
  return createGateway({ apiKey })(process.env[`${role.toUpperCase()}_MODEL`] || FREE_WORKFLOW_MODEL);
}
