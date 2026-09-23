/* eslint-disable @next/next/no-img-element -- Researched store photos have arbitrary remote hosts. */
import type { Research } from "@/lib/workflow/session-types";
import {
  memberReferenceReadiness,
  scopeForCampaign,
  type CampaignMember,
} from "@/lib/workflow/research/scope";
import { Badge, Button } from "./ui";
import { WorkspaceIcon } from "./workspace-icon";


function formatPrice(price: NonNullable<NonNullable<Research["products"]>[number]["price"]>) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: price.currency,
      currencyDisplay: "symbol",
    }).format(price.amount);
  } catch {
    return `${price.currency} ${price.amount}`;
  }
}

function availabilityLabel(availability: string | null) {
  if (!availability) return null;
  const value = availability.split("/").at(-1)?.replace(/([a-z])([A-Z])/g, "$1 $2");
  return value || availability;
}

export function CampaignProducts({ research, busy, plan }: {
  research: Research;
  busy: boolean;
  plan: (member: CampaignMember, productTitle: string, optionTitle?: string) => void;
}) {
  const products = research.products || [];
  const campaign = research.campaign;
  const scope = scopeForCampaign(campaign || { selectedProductId: null }, products);
  const assets = research.assets || [];
  const selectedProductId = campaign?.selectedProductId;
  const includedProductIds = [...new Set(scope.members.map((member) => member.productId))];
  const campaignProducts = includedProductIds
    .map((productId) => products.find((product) => product.id === productId))
    .filter((product): product is NonNullable<typeof product> => !!product);

  if (!campaignProducts.length) return null;

  return (
    <section className="campaign-products" aria-labelledby="campaign-products-title">
      <div className="campaign-products-heading">
        <div>
          <p className="eyebrow">CAMPAIGN PRODUCTS</p>
          <h2 id="campaign-products-title">Products in this campaign</h2>
          <p className="muted">
            Choose a researched product to create its next ad.
          </p>
        </div>
        <span className="small muted">
          {campaignProducts.length} {campaignProducts.length === 1 ? "product" : "products"}
        </span>
      </div>

      <div className="campaign-product-grid">
        {campaignProducts.map((product) => {
          const members = scope.members.filter((member) => member.productId === product.id);
          const readyMember = members.find((member) =>
            memberReferenceReadiness(member, products, assets).status === "ready"
          );
          const member = readyMember || members[0] || { productId: product.id, variantId: null };
          const readiness = memberReferenceReadiness(member, products, assets);
          const image = assets.find((asset) => readiness.referenceAssetIds.includes(asset.id))
            || assets.find((asset) => product.assetIds.includes(asset.id) && asset.eligibleAsProductReference);
          const option = member.variantId
            ? product.variants.find((variant) => variant.id === member.variantId)
            : undefined;
          const optionCount = members.filter((item) => item.variantId).length;
          const availability = availabilityLabel(product.price?.availability ?? null);

          return (
            <article className="campaign-product-card" key={product.id}>
              <div className="campaign-product-image">
                {image ? (
                  <img
                    src={image.originalUrl}
                    alt={`Researched product photo of ${product.title}`}
                    loading="lazy"
                  />
                ) : (
                  <span aria-hidden="true"><WorkspaceIcon name="ads" size={26} /></span>
                )}
              </div>
              <div className="campaign-product-content">
                <div className="campaign-product-meta">
                  {product.price ? <strong>{formatPrice(product.price)}</strong> : <span>Price not found</span>}
                  {availability && <span>{availability}</span>}
                </div>
                <h3>{product.title}</h3>
                {product.id === selectedProductId && <p className="small muted">Current product</p>}
                <p className="small muted">
                  {optionCount
                    ? `${optionCount} campaign ${optionCount === 1 ? "option" : "options"}`
                    : product.variants.length
                      ? `${product.variants.length} researched ${product.variants.length === 1 ? "option" : "options"}`
                      : "No specific option selected"}
                </p>
                {option && <p className="campaign-product-option">Starting with {option.title}</p>}
                <div className="campaign-product-footer">
                  {readiness.status === "ready" ? (
                    <Badge tone="success">Photo ready</Badge>
                  ) : (
                    <Badge tone="warning">Needs exact photo</Badge>
                  )}
                  <Button
                    disabled={busy || readiness.status !== "ready"}
                    onClick={() => plan(member, product.title, option?.title)}
                  >
                    Choose product →
                  </Button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
