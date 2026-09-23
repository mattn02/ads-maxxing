import type { ResearchProduct } from "./contracts";

type Price = NonNullable<ResearchProduct["price"]>;
// Shopify Ajax money is scaled by 100, including JPY/KRW (not ISO minor units).
const amount = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value / 100 : null;

export function shopifyPrice(node: Record<string, unknown>, currency?: string): Price | null {
  const value = amount(node.price);
  if (value === null || !currency || !/^[A-Z]{3}$/.test(currency)) return null;
  return { amount: value, currency, availability: typeof node.available === "boolean" ? node.available ? "InStock" : "OutOfStock" : null, compareAtAmount: amount(node.compare_at_price) };
}

export function shopifyProductPrice(node: Record<string, unknown>, currency?: string): Price | null {
  const variants: unknown[] = Array.isArray(node.variants) ? node.variants : [];
  const prices = variants.map(variant => variant && typeof variant === "object" && !Array.isArray(variant) ? shopifyPrice(variant as Record<string, unknown>, currency) : null);
  if (!prices.length || prices.some(price => !price)) return null;
  const known = prices as Price[];
  const min = Math.min(...known.map(price => price.amount));
  const max = Math.max(...known.map(price => price.amount));
  const declaredMin = amount(node.price_min), declaredMax = amount(node.price_max);
  return {
    amount: declaredMin ?? min, maxAmount: declaredMax ?? max, currency: currency!,
    availability: typeof node.available === "boolean" ? node.available ? "InStock" : "OutOfStock" : known.some(price => price.availability === "InStock") ? "InStock" : known.every(price => price.availability === "OutOfStock") ? "OutOfStock" : null,
  };
}

/** A selected variant's missing price must never inherit another option's price. */
export function selectedProductPrice(product: ResearchProduct | undefined, variantId?: string | null): Price | null {
  if (!product) return null;
  if (!variantId) return product.price;
  const variant = product.variants.find(item => item.id === variantId);
  if (!variant) return null;
  // Older snapshots have only a product-level price.
  return variant.price === undefined ? product.price : variant.price;
}

export function formatProductPrice(price: Price): string {
  const formatted = new Intl.NumberFormat("en-US", { style: "currency", currency: price.currency, currencyDisplay: "symbol" }).format(price.amount);
  return price.maxAmount !== undefined && price.maxAmount > price.amount ? `From ${formatted}` : formatted;
}
