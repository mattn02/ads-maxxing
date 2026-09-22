import { z } from "zod";
import { researchV2FieldsSchema } from "./contracts";
import type { Research } from "../session-types";
import { WorkflowError } from "../validation";
const source = z.object({ url: z.string().url(), title: z.string(), description: z.string(), images: z.array(z.string().url()), markdown: z.string(), fetchedAt: z.string(), colors: z.record(z.string(), z.string()) }).passthrough();
const legacy = z.object({ id: z.string(), sources: z.array(source), colors: z.array(z.object({ value: z.string(), sourceUrl: z.string().url() })), voice: z.string(), audience: z.string(), sales: z.array(z.object({ id: z.string(), description: z.string(), sourceUrl: z.string().url(), quote: z.string() })), warnings: z.array(z.string()) });
export function parseResearchSnapshot(data: unknown, schemaVersion: number): Research {
  if (schemaVersion !== 1 && schemaVersion !== 2) throw new WorkflowError(`Research schema ${schemaVersion} is unsupported. Update the application before opening this campaign.`, 409);
  const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
  if (record.schemaVersion != null && record.schemaVersion !== schemaVersion) throw new WorkflowError("Research payload and stored schema version disagree.", 409);
  const parsed = (schemaVersion === 2 ? legacy.extend(researchV2FieldsSchema.shape) : legacy).safeParse({ ...record, ...(schemaVersion === 2 ? { schemaVersion: 2 } : {}) });
  if (!parsed.success) throw new WorkflowError("Saved research is invalid. Refresh the store research before preparing a new ad.", 409);
  return parsed.data as Research;
}
