/* eslint-disable @next/next/no-img-element -- The server PNG renderer embeds saved bytes. */
import React from "react";
import { templateGeometry, type BrandTokens, type DesignSpec, type VerifiedLogo } from "./schema";
import type { CopyLayout, FittedText } from "./fit";
import { textRuns } from "./emoji";

type TemplateProps = { design: DesignSpec; tokens: BrandTokens; copy: CopyLayout; visualBytes: Buffer; logoBytes?: VerifiedLogo };
const dataUrl = (bytes: Buffer, mime = "image/png") => `data:${mime};base64,${bytes.toString("base64")}`;
function TextLines({ text, alignment = "left" }: { text: FittedText; alignment?: "left" | "center" }) {
  return <div style={{ display: "flex", flexDirection: "column", fontSize: text.size, lineHeight: `${text.lineHeight}px`, width: "100%" }}>
    {text.lines.map((line, index) => <div key={index} style={{ whiteSpace: "pre", height: text.lineHeight, display: "flex", alignItems: "center", justifyContent: alignment === "center" ? "center" : "flex-start" }}>
      {textRuns(line || " ", text.emojis).map((run, index) => run.image
        ? <img key={index} src={run.image} alt="" width={text.size} height={text.size} style={{ flexShrink: 0 }} />
        : <span key={index} style={{ whiteSpace: "pre" }}>{run.text}</span>)}
    </div>)}
  </div>;
}
function ProductVisual({ bytes, design }: { bytes: Buffer; design: DesignSpec }) {
  const visual = templateGeometry(design.template).visual;
  // Providers can ignore empty-space instructions. Contain the complete scene
  // in its own slot so an opaque copy panel can never hide product details.
  return <img src={dataUrl(bytes)} alt="" width={visual.width} height={visual.height} style={{ position: "absolute", left: visual.x, top: visual.y, objectFit: "contain" }} />;
}
function Logo({ logo }: { logo: VerifiedLogo }) {
  const scale = Math.min(160 / logo.width, 28 / logo.height);
  return <img src={dataUrl(logo.bytes, logo.mime)} alt="" width={logo.width * scale} height={logo.height * scale} style={{ objectFit: "contain", marginBottom: 12 }} />;
}
function Headline({ text, alignment }: { text: FittedText; alignment: DesignSpec["alignment"] }) {
  return <div style={{ display: "flex", alignItems: "center", height: 168, width: "100%" }}><TextLines text={text} alignment={alignment} /></div>;
}
function CTA({ text, design, tokens }: Pick<TemplateProps, "design" | "tokens"> & { text: FittedText }) {
  const solid = design.ctaStyle === "solid";
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 48, maxWidth: 512, padding: "0 24px", marginTop: 16, borderRadius: 12,
    border: `2px solid ${solid ? tokens.accent : tokens.foreground}`, background: solid ? tokens.accent : tokens.background,
    color: solid ? tokens.ctaForeground : tokens.foreground, textAlign: "center" }}><TextLines text={text} alignment="center" /></div>;
}
function OfferTerms({ text, alignment }: { text: FittedText; alignment: DesignSpec["alignment"] }) {
  return <div style={{ display: "flex", height: 66, width: "100%", marginTop: 14 }}><TextLines text={text} alignment={alignment} /></div>;
}
function CopyGroup({ design, tokens, copy, logoBytes }: TemplateProps) {
  return <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: design.alignment === "left" ? "flex-start" : "center", textAlign: design.alignment,
    position: "absolute", left: 0, top: templateGeometry(design.template).copy.y, width: 576, height: 448, padding: "28px 32px", flexShrink: 0, background: tokens.background }}>
    {logoBytes && <Logo logo={logoBytes} />}
    <Headline text={copy.headline} alignment={design.alignment} />
    <CTA text={copy.cta} design={design} tokens={tokens} />
    {copy.offer && <OfferTerms text={copy.offer} alignment={design.alignment} />}
  </div>;
}
export function CreativeTemplate(props: TemplateProps) {
  return <div style={{ display: "flex", position: "relative", width: 576, height: 1024, background: props.tokens.background, color: props.tokens.foreground, fontFamily: "Geist", fontWeight: 400 }}>
    <ProductVisual bytes={props.visualBytes} design={props.design} />
    <CopyGroup {...props} />
  </div>;
}
