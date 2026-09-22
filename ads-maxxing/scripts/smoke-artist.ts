/** Explicit opt-in: one paid fal visual and two reviewer calls, in an isolated demo session. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createAd } from "../lib/workflow/agents/artist";
import { reviewAd } from "../lib/workflow/agents/reviewer";
import { assembleResearch } from "../lib/workflow/agents/researcher";
import { generateImage } from "../lib/workflow/fal";
import { renderCreative } from "../lib/workflow/creative/render";
import { DEFAULT_DESIGN } from "../lib/workflow/creative/schema";
import { readImage, readVisual, saveComposedGeneration, saveVisual } from "../lib/workflow/storage";
import { createSession, loadSession, saveSession } from "../lib/workflow/sessions";
import { Workflow, type WorkflowDependencies } from "../lib/workflow/service";
import type { Source } from "../lib/workflow/session-types";
import { safeError } from "../lib/workflow/validation";

async function main() {
  const [sourceFile, referenceImage, consent] = process.argv.slice(2);
  if (!sourceFile || !referenceImage || consent !== "--allow-one-paid-visual") throw new Error("Usage: node --env-file=.env.local --import tsx scripts/smoke-artist.ts <saved-source.json> <reference-url> --allow-one-paid-visual");
  const source: Source = JSON.parse(await readFile(sourceFile, "utf8"));
  assert.ok(source.images.includes(referenceImage), "Select an image from the saved source");
  const research = assembleResearch([source], { voice: "Friendly (smoke fixture)", audience: "Phone owners (inferred smoke fixture)", sales: [] });
  process.env.WORKFLOW_DATA_DIR = path.resolve("local-output/artist-smoke");
  const marker = path.join(process.env.WORKFLOW_DATA_DIR, "smoke-session.txt");
  try { await readFile(marker); throw new Error("Smoke already started. Inspect its saved session before another paid run."); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  let falCalls = 0;
  const deps: WorkflowDependencies = {
    research: async () => research, save: saveSession, readVisual, reviewAd,
    createAd: (brief, research, execution) => createAd(brief, research, execution, {
      generate: async (reference, prompt) => { assert.equal(++falCalls, 1, "Only one paid visual is allowed"); return generateImage(reference, prompt); },
      saveVisual, readVisual, render: renderCreative, saveFinal: saveComposedGeneration,
    }),
  };
  const session = await createSession();
  await writeFile(marker, session.id);
  console.log(`Smoke session: ${session.id}`);
  const workflow = new Workflow(session, deps);
  await workflow.research({ url: source.url, productUrl: null, campaignUrl: null });
  const brief = await workflow.proposeBrief({ productUrl: source.url, referenceImage, headline: "Your daily dose of color", cta: "Shop Loopy", saleId: null, parentVariantId: null, direction: "A clean product portrait", feedback: "",
    design: { ...DEFAULT_DESIGN, visualDirection: "Place the photographed dark cherry case on a cream studio pedestal. Keep its full shape, loop, camera openings and existing markings visible." } });
  await workflow.approveBrief(brief.id); // Explicitly approved smoke fixture, never an existing user brief.
  const first = await workflow.generate();
  console.log(`First output: ${first.id}; review: ${first.status}`);
  const revision = await workflow.proposeBrief({ ...brief, headline: "Color worth holding on to", parentVariantId: first.id, feedback: "Put the photo first and make the CTA quieter.", design: { ...brief.design!, template: "photo-top", ctaStyle: "outline", reuseVisualFromVariantId: first.id } });
  await workflow.approveBrief(revision.id);
  const resumed = new Workflow(await loadSession(session.id), deps);
  const second = await resumed.generate();
  assert.equal(falCalls, 1);
  assert.equal(first.visualAssetId, second.visualAssetId);
  assert.notDeepEqual(await readImage(first.id), await readImage(second.id));
  const report = { sessionId: session.id, falCalls, visualAssetId: first.visualAssetId, outputs: [first, second].map(item => ({ id: item.id, status: item.status, review: item.review, reviewError: item.reviewError })) };
  await writeFile(path.join(process.env.WORKFLOW_DATA_DIR, "smoke-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, outputs: report.outputs.map(({ id, status }) => ({ id, status })) }, null, 2));
}
main().catch(error => { console.error(safeError(error)); process.exitCode = 1; });
