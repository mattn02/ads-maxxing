import React from "react";
import { ImageResponse } from "next/og";
import type { Brief, Research } from "../session-types";
import { WorkflowError } from "../validation";
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
    const { data } = await creativeFont();
    const response = new ImageResponse(<CreativeTemplate design={brief.design!} tokens={tokens} copy={copy} visualBytes={visualBytes} logoBytes={logoBytes} />, {
      width: 576, height: 1024, fonts: [{ name: "Geist", data, weight: 400, style: "normal" }],
    });
    return Buffer.from(await response.arrayBuffer());
  } catch {
    throw new WorkflowError("Composition failed. The saved visual is retained; use Finish saved creative to retry without generating a new visual.", 502);
  }
}

/** Preserve the entire provider scene, never crop product details to achieve the template size. */
export async function normalizeScenePng(bytes: Buffer): Promise<Buffer> {
  const png = bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (!png) throw new WorkflowError("The scene provider must return a PNG.");
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width > 4096 || height > 4096 || Math.abs(width / height / (9 / 16) - 1) > 0.02) throw new WorkflowError("The scene is not a supported portrait image. Recover the saved output without another paid request.");
  if (width === 576 && height === 1024) return bytes;
  const response = new ImageResponse(React.createElement("img", { src: `data:image/png;base64,${bytes.toString("base64")}`, width: 576, height: 1024, style: { objectFit: "contain" } }), { width: 576, height: 1024 });
  return Buffer.from(await response.arrayBuffer());
}
