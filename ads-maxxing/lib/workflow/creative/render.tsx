import React from "react";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import type { Brief, Research } from "../session-types";
import { WorkflowError } from "../validation";
import { imageMetadata } from "../asset-download";
import { creativeFont, validateCreative } from "./fit";
import { CreativeTemplate } from "./templates";
import type { BrandTokens, VerifiedLogo } from "./schema";

export async function renderCreative({ brief, research, tokens, visualBytes, logoBytes }: {
  brief: Brief; research: Research; tokens: BrandTokens; visualBytes: Buffer; logoBytes?: VerifiedLogo;
}): Promise<Buffer> {
  const copy = await validateCreative(brief, research);
  if (JSON.stringify(tokens) !== JSON.stringify(brief.tokens)) throw new WorkflowError("Render tokens differ from the approved brief.");
  if (logoBytes && (!Number.isFinite(logoBytes.width) || !Number.isFinite(logoBytes.height) || logoBytes.width <= 0 || logoBytes.height <= 0)) throw new WorkflowError("Verified logo dimensions must be positive.");
  try {
    const { data, family } = await creativeFont(tokens);
    // Satori's raster decoder is not reliable for every valid WebP/GIF logo.
    // Normalize the pinned, verified source bytes without changing their content.
    const rendererLogo = logoBytes ? await sharp(logoBytes.bytes, { animated: false }).rotate().png().toBuffer().then(bytes => {
      const metadata = imageMetadata(bytes);
      return { bytes, width: metadata.width, height: metadata.height, mime: metadata.mime };
    }) : undefined;
    const response = new ImageResponse(<CreativeTemplate design={brief.design!} tokens={tokens} copy={copy} visualBytes={visualBytes} logoBytes={rendererLogo} />, {
      width: 576, height: 1024, fonts: [{ name: family, data, weight: 400, style: "normal" }],
    });
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error("creative_composition_failed", detail.replace(/data:[^\s]+/g, "[embedded-image]").slice(0, 1000));
    throw new WorkflowError("Composition failed. The saved visual is retained; use Finish saved creative to retry without generating a new visual.", 502);
  }
}

/** Normalize the provider's portrait scene to the edge-to-edge renderer canvas. */
export async function normalizeScenePng(bytes: Buffer): Promise<Buffer> {
  const png = bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (!png) throw new WorkflowError("The scene provider must return a PNG.");
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width > 4096 || height > 4096 || Math.abs(width / height / (9 / 16) - 1) > 0.02) throw new WorkflowError("The scene is not a supported portrait image. Recover the saved output without another paid request.");
  if (width === 576 && height === 1024) return bytes;
  const response = new ImageResponse(React.createElement("img", { src: `data:image/png;base64,${bytes.toString("base64")}`, width: 576, height: 1024, style: { objectFit: "cover" } }), { width: 576, height: 1024 });
  return Buffer.from(await response.arrayBuffer());
}
