/** Bounded paid provider feasibility probe. Local artifacts are diagnostics, not production persistence. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { generateScene } from "../lib/workflow/fal";
import { scenePrompt } from "../lib/workflow/creative/scene";
import { DEFAULT_DESIGN } from "../lib/workflow/creative/schema";
import { renderCreative, normalizeScenePng } from "../lib/workflow/creative/render";
import type { Brief, Research, Source } from "../lib/workflow/session-types";

async function main() {
  const [sourceFile, outputDir, consent] = process.argv.slice(2);
  if (!sourceFile || !outputDir || consent !== "--allow-two-paid-calls") throw new Error("Usage: node --env-file=<keys> --import tsx scripts/smoke-artist.ts <saved-source.json> <new-output-dir> --allow-two-paid-calls");
  await mkdir(outputDir); // Refuse an existing run; uncertain calls are never automatically repeated.
  const source: Source = JSON.parse(await readFile(sourceFile, "utf8"));
  const referenceImage = source.images.find(url => /Dark_Cherry|dark.cherry/i.test(url)) ?? source.images[0];
  const response = await fetch(referenceImage); assert.ok(response.ok);
  const sourceBytes = Buffer.from(await response.arrayBuffer());
  const sourceType = response.headers.get("content-type") ?? "image/jpeg";
  await writeFile(path.join(outputDir, "source.jpg"), sourceBytes);
  const sourceData = `data:${sourceType};base64,${sourceBytes.toString("base64")}`;
  const research: Research = { id: randomUUID(), sources: [source], sales: [], colors: [], voice: "Playful", audience: "Phone owners (inferred)", warnings: [] };
  const brief: Brief = { id: randomUUID(), researchId: research.id, productUrl: source.url, referenceImage, headline: "Hold on to color", cta: "Shop Loopy", direction: "Loopy smoke", feedback: "", saleId: null, parentVariantId: null, design: structuredClone(DEFAULT_DESIGN), tokens: { background: "#fff7ec", foreground: "#30201a", accent: "#733534", ctaForeground: "#ffffff", fontId: "geist-fallback" } };
  brief.design!.scene.direction = "Stand the exact reference phone case upright on a cream countertop with the printed back, loop and camera openings clearly visible. Front-facing view of the back, matching the reference.";
  let calls = 0;
  const results: unknown[] = [];
  async function paid(name: string, generate: () => ReturnType<typeof generateScene>) {
    assert.ok(++calls <= 2);
    await writeFile(path.join(outputDir, `${name}-attempt.json`), JSON.stringify({ attemptedAt: new Date().toISOString(), call: calls }));
    const result = await generate();
    await writeFile(path.join(outputDir, `${name}-provider.json`), JSON.stringify(result, null, 2));
    const response = await fetch(result.imageUrl); assert.ok(response.ok);
    const raw = Buffer.from(await response.arrayBuffer());
    const bytes = await normalizeScenePng(raw);
    assert.equal(bytes.readUInt32BE(16), 576); assert.equal(bytes.readUInt32BE(20), 1024);
    await writeFile(path.join(outputDir, `${name}.png`), bytes);
    results.push({ name, model: result.model, seed: result.seed });
    return bytes;
  }
  const scene = await paid("simple-scene", () => generateScene(sourceData, scenePrompt(brief)));
  await writeFile(path.join(outputDir, "simple-ad.png"), await renderCreative({ brief, research, tokens: brief.tokens!, visualBytes: scene }));
  brief.headline = "Your everyday hold";
  await writeFile(path.join(outputDir, "copy-revision-ad.png"), await renderCreative({ brief, research, tokens: brief.tokens!, visualBytes: scene }));
  assert.equal(calls, 2, "copy-only render adds zero calls");
  brief.design!.scene.direction = "A natural adult hand holds the exact reference case upright, a finger through its real loop. Printed back and camera openings face the camera, loop visible. Preserve the exact case print and color. Keep hand contact plausible without hiding defining details.";
  const handheld = await paid("handheld-scene", () => generateScene(sourceData, scenePrompt(brief)));
  await writeFile(path.join(outputDir, "handheld-ad.png"), await renderCreative({ brief, research, tokens: brief.tokens!, visualBytes: handheld }));
  await writeFile(path.join(outputDir, "report.json"), JSON.stringify({ calls, source: referenceImage, results, callCounts: { firstAd: 1, copyRevision: 0, sceneRevision: 1 }, note: "Provider feasibility only. Inspect fidelity manually; Supabase persistence is not exercised by this diagnostic." }, null, 2));
  console.log(JSON.stringify({ calls, outputDir }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Smoke failed"); process.exitCode = 1; });
