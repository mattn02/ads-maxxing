import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { ownerContext, rows, rpc } from "../supabase/server";
import { publicAddress } from "./asset-download";
import {
  brandEditsSchema,
  normalizeStoreInput,
  type BrandDetail,
  type BrandSummary,
} from "./onboarding-contracts";
import {
  loadSession,
  normalizedHostname,
  parseSnapshot,
  sessionId,
} from "./sessions";
import {
  adoptBrandContext,
  effectiveBrandResearch,
} from "./research/brand-context";
import { WorkflowError } from "./validation";
import type { Research, Session } from "./session-types";

type BrandRow = {
  id: string;
  name: string;
  normalized_hostname: string;
  context_revision: number;
  completed_context_id: string | null;
};
export async function listBrands(): Promise<BrandSummary[]> {
  const [brands, setups] = await Promise.all([
    rows<BrandRow>(
      "brands",
      "select=id,name,normalized_hostname,context_revision,completed_context_id&order=updated_at.desc",
    ),
    rows<{ id: string; brand_id: string }>(
      "campaigns",
      "purpose=eq.brand_setup&select=id,brand_id",
    ),
  ]);
  return brands.map((brand) => ({
    id: brand.id,
    name: brand.name,
    revision: brand.context_revision,
    ready: !!brand.completed_context_id,
    setupId: setups.find((setup) => setup.brand_id === brand.id)?.id,
    storeUrl: `https://${brand.normalized_hostname}/`,
  }));
}
async function brandRecord(id: string) {
  const [brand] = await rows<BrandRow>(
    "brands",
    `id=eq.${sessionId(id)}&select=*`,
  );
  if (!brand) throw new WorkflowError("Brand not found.", 404);
  return brand;
}
async function contextResearch(brand: BrandRow): Promise<Research | undefined> {
  if (!brand.completed_context_id) return;
  const [snapshot] = await rows<{ schema_version: number; data: unknown }>(
    "research_snapshots",
    `id=eq.${brand.completed_context_id}&select=schema_version,data`,
  );
  if (!snapshot)
    throw new WorkflowError("Saved brand context is unavailable.", 409);
  return parseSnapshot(snapshot.data, snapshot.schema_version);
}
export async function readBrand(id: string): Promise<BrandDetail> {
  const brand = await brandRecord(id);
  const saved = await contextResearch(brand);
  const [setup] = await rows<{ id: string }>(
    "campaigns",
    `brand_id=eq.${brand.id}&purpose=eq.brand_setup&select=id&limit=1`,
  );
  return {
    id: brand.id,
    name: brand.name,
    revision: brand.context_revision,
    ready: !!saved,
    setupId: setup?.id,
    storeUrl:
      saved?.brandKit?.canonicalStoreUrl ||
      `https://${brand.normalized_hostname}/`,
    research: saved ? effectiveBrandResearch(saved) : undefined,
  };
}
export async function validateStoreHost(url: string) {
  const addresses = await lookup(new URL(url).hostname, { all: true });
  if (
    !addresses.length ||
    addresses.some((item) => !publicAddress(item.address))
  )
    throw new WorkflowError(
      "Enter a public store URL; private network addresses are not supported.",
    );
}
export async function createSetup(input: string, key: string) {
  let normalized: ReturnType<typeof normalizeStoreInput>;
  try {
    normalized = normalizeStoreInput(input);
  } catch {
    throw new WorkflowError("Enter a valid public store URL.");
  }
  const [existing] = await rows<{ id: string }>(
    "brands",
    `normalized_hostname=eq.${encodeURIComponent(normalizedHostname(normalized.storeUrl))}&select=id&limit=1`,
  );
  if (!existing) await validateStoreHost(normalized.storeUrl);
  const id = await rpc<string>("create_brand_setup", {
    p_owner: ownerContext().userId,
    p_key: sessionId(key),
    p_hostname: normalizedHostname(normalized.storeUrl),
    p_url: normalized.storeUrl,
    p_original: normalized.originalUrl,
  });
  return loadSession(id);
}
export function campaignOpening(
  research: Research,
): Session["messages"][number] {
  const choices = research.suggestions || [];
  const lines = choices.map(
    (choice, index) =>
      `${index + 1}. **${choice.label}** — ${choice.reason || "An observed store link we can explore for this campaign."}`,
  );
  return {
    id: randomUUID(),
    role: "assistant",
    parts: [
      {
        type: "text",
        text: `Let’s make creatives for ${research.brandKit?.name || "your brand"}. What would you like to promote?${lines.length ? `\n\n${lines.join("\n\n")}` : ""}\n\nChoose a direction below, describe your own idea, or paste a product or collection URL. I’ll research the product next, then ask you to approve the exact brief and photo before generating.`,
      },
    ],
  };
}
export async function startCampaign(
  brandId: string,
  key: string,
  setupId?: string,
) {
  const brand = await brandRecord(brandId);
  const saved = await contextResearch(brand);
  if (!saved) throw new WorkflowError("Finish brand setup first.", 409);
  const research = adoptBrandContext(saved);
  const id = await rpc<string>("start_brand_campaign", {
    p_owner: ownerContext().userId,
    p_brand: brand.id,
    p_key: sessionId(key),
    p_setup: setupId ? sessionId(setupId) : null,
    p_context: brand.completed_context_id,
    p_research: research,
    p_message: campaignOpening(research),
  });
  return loadSession(id);
}
export async function saveBrandCorrections(
  id: string,
  revision: number,
  input: unknown,
) {
  const edits = brandEditsSchema.parse(input);
  const brand = await brandRecord(id);
  const research = await contextResearch(brand);
  if (!research?.brandKit)
    throw new WorkflowError("Finish brand setup first.", 409);
  if (
    edits.selectedLogoAssetId &&
    !research.assets?.some(
      (asset) =>
        asset.id === edits.selectedLogoAssetId &&
        asset.role === "logo" &&
        research.brandKit!.logoAssetIds.includes(asset.id),
    )
  )
    throw new WorkflowError("Choose an observed brand logo.");
  research.id = randomUUID();
  research.revision = (research.revision || 0) + 1;
  const { colors, selectedLogoAssetId, ...text } = edits;
  const effective = effectiveBrandResearch(research).brandKit!;
  const current = {
    name: effective.name,
    voice: effective.overrides.voice ?? effective.voice.value ?? "",
    audience: effective.overrides.audience ?? effective.audience.value ?? "",
    valueProposition:
      effective.overrides.valueProposition ??
      effective.valueProposition.value ??
      "",
  };
  for (const field of [
    "name",
    "voice",
    "audience",
    "valueProposition",
  ] as const) {
    if (text[field] !== current[field])
      research.brandKit.overrides[field] = text[field];
  }
  const previousColors = effective.colors
    .filter((color) => /^#[0-9a-f]{6}$/i.test(color.value))
    .map(({ role, value }) => ({ role, value }));
  if (JSON.stringify(colors) !== JSON.stringify(previousColors))
    research.brandKit.visualOverrides = {
      ...research.brandKit.visualOverrides,
      colors,
    };
  if (selectedLogoAssetId !== effective.selectedLogoAssetId)
    research.brandKit.visualOverrides = {
      ...research.brandKit.visualOverrides,
      selectedLogoAssetId,
    };
  research.brandKit.revision = revision + 1;
  await rpc("correct_brand_context", {
    p_owner: ownerContext().userId,
    p_brand: brand.id,
    p_revision: revision,
    p_research: research,
  });
  return readBrand(id);
}
