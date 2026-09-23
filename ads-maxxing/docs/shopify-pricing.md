# Shopify pricing

Product research retains the public Shopify Ajax product's numeric prices, compare-at prices, availability, and variant prices. When prices are present, one additional bounded GET reads the same locale's `/cart.js` currency. Cookies from the product response are forwarded only to that same-store lookup and are never persisted; cart contents are discarded. Both requests use the existing HTTPS, public-address, timeout, response-size, and no-redirect safeguards.

Prices are normalized from Shopify's hundredths to display amounts, including JPY/KRW. The source snapshot retains raw amounts and currency provenance. The parsed product and variants retain display amounts through the existing research snapshot persistence; older snapshots remain compatible.

Campaign cards, brief previews, and rendered ads resolve the selected variant's price. An unspecified variant uses the product price, prefixed with “From” when prices vary. An explicitly missing variant price cannot inherit another variant's price. Compare-at prices are saved as evidence; they do not automatically create an approved promotional claim.

A failed currency lookup preserves products/photos and raw amounts but leaves display prices unknown. Currency is never inferred from a domain or `$` symbol. Existing research that previously discarded prices must be refreshed to populate these fields; historical ads are not rewritten.

References: [Ajax product API](https://shopify.dev/docs/api/ajax/reference/product), [Shopify price units](https://shopify.dev/docs/api/liquid/objects/variant#variant-price).
