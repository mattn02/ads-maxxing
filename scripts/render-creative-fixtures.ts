import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { imageMetadata } from "../lib/workflow/asset-download";
import { ImageResponse } from "next/og";
import { createElement } from "react";
import { renderCreative } from "../lib/workflow/creative/render";
import { DEFAULT_DESIGN } from "../lib/workflow/creative/schema";
import { assembleResearch } from "../lib/workflow/agents/researcher";
import { resolveBrandTokens } from "../lib/workflow/creative/tokens";
import type { Brief, Source } from "../lib/workflow/session-types";

async function main() {
  const output = path.resolve(process.argv[2] || "local-output/creative-fixtures");
  await mkdir(output, { recursive: true });
  // Debug fixtures test typography independently; these are never generated product scenes.
  const sourceVisual = Buffer.from(await new ImageResponse(createElement("div", { style: { width: 240, height: 400, background: "#eab3be", display: "flex", alignItems: "center", justifyContent: "center", border: "16px solid #943749" } }, "PRODUCT"), { width: 240, height: 400 }).arrayBuffer());
  const logo = Buffer.from(await new ImageResponse(createElement("div", { style: { width: 120, height: 24, background: "#151515", color: "white", display: "flex", fontSize: 16 } }, "Fixture logo"), { width: 120, height: 24 }).arrayBuffer());
  const source: Source = { url: "https://fixture.example/product", images: ["https://fixture.example/photo.png"], title: "Fixture", description: "", markdown: "Members save 10%. Selected cases only. Ends Friday.", colors: {}, fetchedAt: "fixture" };
  const research = assembleResearch([source], { voice: "Fixture", audience: "Fixture", sales: [{ sourceUrl: source.url, quote: source.markdown, description: "Member offer" }] });
  const resolvedTokens = resolveBrandTokens(research);
  for (const template of ["copy-top", "photo-top"] as const) {
    for (const dark of [false, true]) {
      const brief: Brief = { id: randomUUID(), researchId: research.id, productUrl: source.url, referenceImage: source.images[0], headline: "Good grip. Great days. Your case, reimagined.", cta: "Find your favorite", direction: "Fixture", feedback: "", parentVariantId: null, saleId: research.sales[0].id,
        design: { ...DEFAULT_DESIGN, template, alignment: dark ? "center" : "left", ctaStyle: dark ? "outline" : "solid" },
        tokens: { ...resolvedTokens, background: dark ? "#171717" : "#f6f3ee", foreground: dark ? "#ffffff" : "#000000" } };
      const original = process.argv[3] ? await readFile(process.argv[3]) : sourceVisual;
      const visual = Buffer.from(await new ImageResponse(createElement("div", { style: { display: "flex", width: 576, height: 1024, background: "#f4ded0", position: "relative" } }, createElement("img", { src: `data:${imageMetadata(original).mime};base64,${original.toString("base64")}`, width: 576, height: 576, style: { position: "absolute", top: template === "copy-top" ? 448 : 0, objectFit: "contain" } })), { width: 576, height: 1024 }).arrayBuffer());
      const png = await renderCreative({ brief, research, tokens: brief.tokens!, visualBytes: visual, logoBytes: { bytes: logo, width: 120, height: 24 } });
      await writeFile(path.join(output, `${template}-${dark ? "dark" : "light"}.png`), png);
    }
  }
  console.log(`Rendered four fixtures in ${output}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
