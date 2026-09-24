/* eslint-disable @next/next/no-img-element -- The server PNG renderer embeds saved bytes. */
import React from "react";
import { CREATIVE_FONT_FAMILY, templateGeometry, type BrandTokens, type DesignSpec, type VerifiedLogo } from "./schema";
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
  return <img src={dataUrl(bytes)} alt="" width={visual.width} height={visual.height} style={{ position: "absolute", left: visual.x, top: visual.y }} />;
}
function Logo({ logo }: { logo: VerifiedLogo }) {
  const scale = Math.min(160 / logo.width, 28 / logo.height);
  return <img src={dataUrl(logo.bytes, logo.mime)} alt="" width={logo.width * scale} height={logo.height * scale} style={{ position: "absolute", left: 32, top: 24, objectFit: "contain" }} />;
}
function Headline({ text, alignment }: { text: FittedText; alignment: DesignSpec["alignment"] }) {
  return <div style={{ display: "flex", alignItems: "center", height: 168, width: "100%" }}><TextLines text={text} alignment={alignment} /></div>;
}
function CTA({ text, design, tokens }: Pick<TemplateProps, "design" | "tokens"> & { text: FittedText }) {
  const solid = design.ctaStyle === "solid";
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 48, maxWidth: 512, padding: "0 24px", marginTop: 10, borderRadius: 12,
    border: `2px solid ${solid ? tokens.accent : tokens.foreground}`, background: solid ? tokens.accent : tokens.background,
    color: solid ? tokens.ctaForeground : tokens.foreground, textAlign: "center" }}><TextLines text={text} alignment="center" /></div>;
}
function OfferTerms({ text, alignment }: { text: FittedText; alignment: DesignSpec["alignment"] }) {
  return <div style={{ display: "flex", height: 54, width: "100%", marginTop: 6 }}><TextLines text={text} alignment={alignment} /></div>;
}
function Price({ text, alignment }: { text: FittedText; alignment: DesignSpec["alignment"] }) {
  return <div style={{ display: "flex", height: 34, width: "100%", marginTop: 8 }}><TextLines text={text} alignment={alignment} /></div>;
}
function CopyGroup({ design, tokens, copy, logoBytes }: TemplateProps) {
  return <div style={{ display: "flex", flexDirection: "column", alignItems: design.alignment === "left" ? "flex-start" : "center", textAlign: design.alignment,
    position: "absolute", left: 0, top: 0, width: 576, height: 1024, padding: "24px 32px", flexShrink: 0, background: "transparent" }}>
    {logoBytes && <Logo logo={logoBytes} />}
    <div style={{ display: "flex", width: "100%", marginTop: logoBytes ? 40 : 0 }}>
      <Headline text={copy.headline} alignment={design.alignment} />
    </div>
    <div style={{ display: "flex", flexDirection: "column", width: "100%", marginTop: "auto", alignItems: design.alignment === "left" ? "flex-start" : "center" }}>
      {copy.price && <Price text={copy.price} alignment={design.alignment} />}
      {copy.offer && <OfferTerms text={copy.offer} alignment={design.alignment} />}
      <CTA text={copy.cta} design={design} tokens={tokens} />
    </div>
  </div>;
}
// Paint every fade before the copy so neighboring feathers cannot wash out text.
// Protect fitted text height only, rather than filling the larger reserved slots.
function CopyProtection({ copy, tokens, logoBytes }: TemplateProps) {
  const rgb = [1, 3, 5].map(offset => parseInt(tokens.background.slice(offset, offset + 2), 16)).join(", ");
  const textHeight = (text: FittedText) => text.lines.length * text.lineHeight;
  const headlineHeight = textHeight(copy.headline);
  const bands = [{ top: 24 + (logoBytes ? 40 : 0) + (168 - headlineHeight) / 2, height: headlineHeight }];
  if (logoBytes) bands.push({ top: 24, height: Math.min(160 / logoBytes.width, 28 / logoBytes.height) * logoBytes.height });
  // Bottom stack: 24px inset, 48px CTA + 10px gap, optional price/offer slots.
  const footerTop = 1024 - 24 - 48 - 10 - (copy.price ? 42 : 0) - (copy.offer ? 60 : 0);
  if (copy.price) bands.push({ top: footerTop + 8, height: textHeight(copy.price) });
  if (copy.offer) bands.push({ top: footerTop + (copy.price ? 42 : 0) + 6, height: textHeight(copy.offer) });
  const feather = 20;
  return <div style={{ display: "flex", position: "absolute", left: 0, top: 0, width: 576, height: 1024, overflow: "hidden" }}>
    {bands.map((band, index) => <div key={index} style={{ position: "absolute", left: 0, top: band.top - feather, width: 576, height: band.height + feather * 2,
      backgroundImage: `linear-gradient(to bottom, rgba(${rgb}, 0) 0px, rgba(${rgb}, 0.94) ${feather}px, rgba(${rgb}, 0.94) ${band.height + feather}px, rgba(${rgb}, 0) ${band.height + feather * 2}px)` }} />)}
  </div>;
}
export function CreativeTemplate(props: TemplateProps) {
  return <div style={{ display: "flex", position: "relative", width: 576, height: 1024, background: props.tokens.background, color: props.tokens.foreground, fontFamily: CREATIVE_FONT_FAMILY, fontWeight: 400 }}>
    <ProductVisual bytes={props.visualBytes} design={props.design} />
    <CopyProtection {...props} />
    <CopyGroup {...props} />
  </div>;
}
