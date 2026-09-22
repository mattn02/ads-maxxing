import type { Research } from "../session-types";
import type { BrandTokens } from "./schema";

function normalizeColor(value: string): string | null {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(value)) return `#${[...value.slice(1)].map(c => c + c).join("")}`.toLowerCase();
  return null;
}
export function readableText(hex: string) {
  const rgb = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? "#000000" : "#ffffff";
}
export function resolveBrandTokens(research: Research): BrandTokens {
  const colors = research.colors.map(({ value }) => normalizeColor(value)).filter((value): value is string => !!value);
  const role = (...roles: string[]) => research.brandKit?.colors.find(color => roles.includes(color.role))?.value;
  const background = normalizeColor(role("background", "backgroundColor") || "") || colors[0] || "#f6f3ee";
  const accent = normalizeColor(role("accent", "primary") || "") || colors[1] || readableText(background);
  return { background, foreground: readableText(background), accent, ctaForeground: readableText(accent), fontId: "geist-fallback" };
}
