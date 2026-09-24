import type { Brief, Research } from "../session-types";

/** Stable, evidence-backed context shared by image prompts and reuse keys. */
export function visualPromptContext(brief: Brief, research?: Research) {
  const product = research?.products?.find(item => item.id === brief.productId);
  const variant = product?.variants.find(item => item.id === brief.variantId);
  const kit = research?.brandKit;
  return {
    brand: {
      name: kit?.name ?? null,
      voice: research?.voice ?? kit?.voice.value ?? null,
      audience: research?.audience ?? kit?.audience.value ?? null,
      valueProposition: kit?.overrides.valueProposition ?? kit?.valueProposition.value ?? null,
      colors: kit?.colors.map(({ role, value }) => ({ role, value })) ?? research?.colors.map(({ value }) => value) ?? [],
    },
    campaignDirection: research?.campaign?.direction?.text ?? null,
    product: {
      title: product?.title ?? null,
      description: product?.description ?? null,
      variant: variant ? { title: variant.title, attributes: variant.attributes } : null,
    },
  };
}
