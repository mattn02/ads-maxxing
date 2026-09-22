import { z } from "zod";
import type { Research } from "./session-types";

export const setupSchema = z.object({
  state: z.enum(["needs_url", "researching", "ready", "failed"]),
  storeUrl: z.string().url(),
  originalUrl: z.string().url().optional(),
  operationId: z.string().uuid().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  progress: z.enum(["reading", "understanding", "saving"]).optional(),
  error: z.string().optional(),
});
export type BrandSetup = z.infer<typeof setupSchema>;
export const brandEditsSchema = z.object({
  name: z.string().trim().min(1).max(200),
  voice: z.string().trim().max(2000),
  audience: z.string().trim().max(2000),
  valueProposition: z.string().trim().max(2000),
  colors: z
    .array(
      z.object({
        role: z.string().trim().min(1).max(40),
        value: z.string().regex(/^#[0-9a-f]{6}$/i),
      }),
    )
    .max(12),
  selectedLogoAssetId: z.string().max(160).nullable(),
});
export type BrandEdits = z.infer<typeof brandEditsSchema>;
export type BrandSummary = {
  id: string;
  name: string;
  revision: number;
  ready: boolean;
  setupId?: string;
  storeUrl: string;
};
export type BrandDetail = BrandSummary & { research?: Research };

/** Same normalization in the form and server; network validation remains server-side. */
export function normalizeStoreInput(input: string) {
  const url = new URL(
    /^[a-z][a-z0-9+.-]*:\/\//i.test(input.trim())
      ? input.trim()
      : `https://${input.trim()}`,
  );
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    !url.hostname.includes(".")
  )
    throw new Error("Enter a public store URL.");
  url.hash = "";
  const originalUrl = url.href;
  return { storeUrl: new URL("/", url).href, originalUrl };
}
