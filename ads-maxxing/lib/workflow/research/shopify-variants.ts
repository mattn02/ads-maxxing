type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const string = (value: unknown) => typeof value === "string" ? value : typeof value === "number" && Number.isSafeInteger(value) ? String(value) : "";
const imageUrl = (value: unknown) => typeof value === "string" ? value : string(object(value).src || object(value).url);

/** Parse inert product JSON only. JavaScript assignments and recommendation trees are not executed. */
export function shopifyProductNodes(html: string): Json[] {
  const nodes: Json[] = [];
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const root = object(JSON.parse(match[1]));
      for (const node of [root, object(root.product)]) {
        if (Array.isArray(node.variants) && (typeof node.handle === "string" || typeof node.url === "string")) nodes.push(node);
      }
    } catch { /* Other embedded JSON is unrelated or malformed. */ }
  }
  return nodes;
}

/** Option names/values and image links must be explicitly declared by Shopify, never guessed from SKUs. */
export function shopifyVariants(product: Json) {
  const names = list(product.options).map(value => typeof value === "string" ? value : string(object(value).name));
  const images = list(product.images);
  return list(product.variants).flatMap(value => {
    const variant = object(value), storeId = string(variant.id);
    if (!storeId) return [];
    const attributes = Object.fromEntries(names.flatMap((name, index) => {
      const option = list(variant.options)[index] ?? variant[`option${index + 1}`];
      return name && typeof option === "string" ? [[name, option]] : [];
    }));
    const declared = [variant.featured_image, object(variant.featured_media).preview_image,
      ...images.filter(image => string(object(image).id) === string(variant.image_id) && !!variant.image_id),
      ...images.filter(image => list(object(image).variant_ids).some(id => string(id) === storeId))];
    return [{ storeId, title: string(variant.title), attributes, images: [...new Set(declared.map(imageUrl).filter(Boolean))] }];
  });
}

export function shopifyImages(product: Json): string[] {
  return [...new Set([...list(product.images), product.featured_image].map(imageUrl).filter(Boolean))];
}
