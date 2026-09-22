/** Explicit, bounded comparison using a saved original and background. Never a production fallback. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { ImageResponse } from "next/og";
import { createElement } from "react";
import path from "node:path";
import { scenePrompt } from "../lib/workflow/creative/scene";
import { renderCreative } from "../lib/workflow/creative/render";
import { DEFAULT_DESIGN } from "../lib/workflow/creative/schema";
import type { Brief, Research } from "../lib/workflow/session-types";
async function main() {
  const [savedDir, outputDir, consent] = process.argv.slice(2);
  if (consent !== "--allow-two-paid-scenes") throw new Error("Supply saved original/background directory, new output directory, --allow-two-paid-scenes");
  await mkdir(outputDir);
  const source = await readFile(path.join(savedDir, "source.jpg"));
  const background = await readFile(path.join(savedDir, "background.png"));
  const research: Research = { id: "probe", sources: [], colors: [], voice: "Playful", audience: "Phone owners", sales: [], warnings: [] };
  const brief: Brief = { id: "probe", researchId: research.id, productUrl: "https://www.loopycases.com", referenceImage: "https://www.loopycases.com", headline: "Hold on to color", cta: "Shop Loopy", direction: "Probe", feedback: "", parentVariantId: null, saleId: null, design: structuredClone(DEFAULT_DESIGN), tokens: { background: "#fff7ec", foreground: "#30201a", accent: "#733534", ctaForeground: "#ffffff", fontId: "geist-fallback" } };
  for (const name of ["simple", "handheld"]) {
    brief.design!.scene.direction = name === "simple" ? "The reference case rests flat on the cream countertop, its shiny cherry back and authentic loop and single camera module clearly visible. Retain the same orientation and visible details as the reference. Remove the original handbag, plants and original person's hand." : "A relaxed adult hand holds the original glossy cherry case with one finger through its authentic loop, as demonstrated in the source. Keep the orientation supported by the reference with its single camera module visible. Remove the handbag and plants; use the saved cream background. Entire product in the lower half.";
    const prompt = scenePrompt(brief);
    await writeFile(path.join(outputDir, `${name}-attempt.json`), JSON.stringify({ model: "fal-ai/nano-banana-pro/edit", prompt, attemptedAt: new Date().toISOString() }, null, 2));
    const response = await fetch("https://fal.run/fal-ai/nano-banana-pro/edit", { method: "POST", headers: { Authorization: `Key ${process.env.FAL_AI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ prompt, image_urls: [`data:image/jpeg;base64,${source.toString("base64")}`, `data:image/png;base64,${background.toString("base64")}`], aspect_ratio: "9:16", resolution: "1K", num_images: 1, output_format: "png", limit_generations: true }), signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
    const result = await response.json();
    await writeFile(path.join(outputDir, `${name}-provider.json`), JSON.stringify(result, null, 2));
    const bytes = Buffer.from(await (await fetch(result.images[0].url)).arrayBuffer());
    await writeFile(path.join(outputDir, `${name}-raw.png`), bytes);
    // Entire scene scaled without cropping; no generative pass after copy.
    const normalized = Buffer.from(await new ImageResponse(createElement("img", { src: `data:image/png;base64,${bytes.toString("base64")}`, width: 576, height: 1024, style: { objectFit: "fill" } }), { width: 576, height: 1024 }).arrayBuffer());
    await writeFile(path.join(outputDir, `${name}-scene.png`), normalized);
    await writeFile(path.join(outputDir, `${name}-ad.png`), await renderCreative({ brief, research, tokens: brief.tokens!, visualBytes: normalized }));
  }
  console.log(JSON.stringify({ outputDir, calls: 2 }));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
