/* eslint-disable @next/next/no-img-element -- The server PNG renderer embeds saved bytes. */
import React from "react";
import type { BrandTokens, DesignSpec, VerifiedLogo } from "./schema";
import type { CopyLayout, FittedText } from "./fit";

type TemplateProps = { design: DesignSpec; tokens: BrandTokens; copy: CopyLayout; visualBytes: Buffer; logoBytes?: VerifiedLogo };
const dataUrl = (bytes: Buffer) => `data:image/png;base64,${bytes.toString("base64")}`;
function TextLines({ text, alignment = "left" }: { text: FittedText; alignment?: "left" | "center" }) {
  return <div style={{ display: "flex", flexDirection: "column", fontSize: text.size, lineHeight: `${text.lineHeight}px`, width: "100%" }}>
    {text.lines.map((line, index) => <div key={index} style={{ whiteSpace: "pre", height: text.lineHeight, display: "flex", justifyContent: alignment === "center" ? "center" : "flex-start" }}>{line || " "}</div>)}
  </div>;
}
function ProductVisual({ bytes }: { bytes: Buffer }) {
  return <img src={dataUrl(bytes)} alt="" width={576} height={576} style={{ objectFit: "contain", flexShrink: 0 }} />;
}
function Logo({ logo }: { logo: VerifiedLogo }) {
  const scale = Math.min(160 / logo.width, 28 / logo.height);
  return <img src={dataUrl(logo.bytes)} alt="" width={logo.width * scale} height={logo.height * scale} style={{ objectFit: "contain", marginBottom: 12 }} />;
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
    width: 576, height: 448, padding: "28px 32px", flexShrink: 0, background: tokens.background }}>
    {logoBytes && <Logo logo={logoBytes} />}
    <Headline text={copy.headline} alignment={design.alignment} />
    <CTA text={copy.cta} design={design} tokens={tokens} />
    {copy.offer && <OfferTerms text={copy.offer} alignment={design.alignment} />}
  </div>;
}
const templates = {
  "copy-top": (props: TemplateProps) => [<CopyGroup key="copy" {...props} />, <ProductVisual key="visual" bytes={props.visualBytes} />],
  "photo-top": (props: TemplateProps) => [<ProductVisual key="visual" bytes={props.visualBytes} />, <CopyGroup key="copy" {...props} />],
};
export function CreativeTemplate(props: TemplateProps) {
  return <div style={{ display: "flex", flexDirection: "column", width: 576, height: 1024, background: props.tokens.background, color: props.tokens.foreground, fontFamily: "Geist", fontWeight: 400 }}>
    {templates[props.design.template](props)}
  </div>;
}
