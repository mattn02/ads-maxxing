"use client";
import { useState } from "react";
import type { Research } from "@/lib/workflow/session-types";
import {
  deviceTarget,
  matchingDeviceMembers,
  memberReferenceReadiness,
  scopeForCampaign,
  type CampaignMember,
} from "@/lib/workflow/research/scope";
import { Badge, Button } from "./ui";

const memberKey = (member: CampaignMember) => `${member.productId}:${member.variantId || "product"}`;

export function CampaignProducts({ research, busy, save, generate }: {
  research: Research;
  busy: boolean;
  save: (members: CampaignMember[]) => Promise<boolean>;
  generate: (member: CampaignMember) => void;
}) {
  const products = research.products || [];
  const campaign = research.campaign;
  const scope = scopeForCampaign(campaign || { selectedProductId: null }, products);
  const suggestedDevice = deviceTarget(campaign?.direction?.text || "");
  const [query, setQuery] = useState(suggestedDevice ? `iPhone ${suggestedDevice.generation}${suggestedDevice.model ? ` ${suggestedDevice.model}` : ""}` : "");
  const [draft, setDraft] = useState<CampaignMember[]>(scope.members);
  const [expanded, setExpanded] = useState(false);
  const target = deviceTarget(query);
  const search = query.trim().toLowerCase();
  const matches: CampaignMember[] = target
    ? matchingDeviceMembers(products, target)
    : products.flatMap((product): CampaignMember[] => !search || product.title.toLowerCase().includes(search)
      ? [{ productId: product.id, variantId: null }]
      : product.variants.filter((variant) => `${variant.title} ${Object.values(variant.attributes).join(" ")}`.toLowerCase().includes(search)).map((variant) => ({ productId: product.id, variantId: variant.id })));
  const matchProductIds = new Set(matches.map((member) => member.productId));
  const selectedKeys = new Set(draft.map(memberKey));
  const changed = JSON.stringify([...selectedKeys].sort()) !== JSON.stringify(scope.members.map(memberKey).sort());
  const includedProducts = new Set(scope.members.map((member) => member.productId));
  function toggle(member: CampaignMember) {
    if (selectedKeys.has(memberKey(member))) setDraft(draft.filter((item) => memberKey(item) !== memberKey(member)));
    else setDraft([...draft.filter((item) => item.productId !== member.productId || member.variantId !== null && item.variantId !== null), member]);
  }
  function label(member: CampaignMember) {
    const product = products.find((item) => item.id === member.productId);
    return member.variantId ? product?.variants.find((variant) => variant.id === member.variantId)?.title || "Product option" : "Product (no specific option)";
  }
  if (!products.length) return null;
  return (
    <section className="campaign-products card">
      <div className="campaign-products-heading">
        <div><h2>Campaign products</h2><p>{includedProducts.size} products included · {scope.coverage.foundProductIds.length} products discovered{scope.members.some((member) => member.variantId) ? ` · ${scope.members.length} selected product options` : ""}</p></div>
        <Button disabled={busy} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Close selection" : "Edit selection"}</Button>
      </div>
      <p className="small muted">{scope.coverage.status === "partial" ? "Partial catalog coverage" : "Catalog coverage not established"}. These are the products discovered so far; this is not the complete store catalog.</p>
      <div className="campaign-member-list">
        {products.filter((product) => includedProducts.has(product.id)).map((product) => (
          <div className="campaign-product-group" key={product.id}>
            <h3>{product.title}</h3>
            {scope.members.filter((member) => member.productId === product.id).map((member) => {
              const readiness = memberReferenceReadiness(member, products, research.assets || []);
              return <div className="campaign-member" key={memberKey(member)}>
                <div><strong>{label(member)}</strong><p className="small muted">{readiness.reason}</p></div>
                {readiness.status === "ready" ? <Button disabled={busy} onClick={() => generate(member)}>Generate ad</Button> : <Badge tone="warning">Needs exact photo</Badge>}
              </div>;
            })}
          </div>
        ))}
      </div>
      {expanded && <div className="campaign-selection">
        <label htmlFor="campaign-product-filter">Find products or product options</label>
        <input id="campaign-product-filter" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Product name, size, color, or model" disabled={busy} />
        <div className="actions"><span className="small muted">{matches.length} matches</span><Button disabled={busy || !matches.length} onClick={() => setDraft(matches)}>Use all matches</Button></div>
        {products.filter((product) => matchProductIds.has(product.id)).map((product) => {
          const choices = search ? matches.filter((member) => member.productId === product.id) : [{ productId: product.id, variantId: null }, ...product.variants.map((variant) => ({ productId: product.id, variantId: variant.id }))];
          return <details className="campaign-selection-group" key={product.id} open={!!search}>
            <summary>{product.title}</summary>
            {choices.map((member) => <label className="campaign-member-option" key={memberKey(member)}><input type="checkbox" disabled={busy} checked={selectedKeys.has(memberKey(member))} onChange={() => toggle(member)} /><span>{label(member)}</span></label>)}
          </details>;
        })}
        {!matches.length && <p className="muted">No matching products or options have been discovered. Try another search.</p>}
        <div className="actions"><Button primary disabled={busy || !changed || !draft.length} onClick={async () => { if (await save(draft)) setExpanded(false); }}>Save selection · {draft.length}</Button><Button disabled={busy} onClick={() => { setDraft(scope.members); setExpanded(false); }}>Cancel</Button></div>
        <p className="small muted">Selecting a size, color, or model does not verify its photo. We only generate when a saved photo establishes that exact option.</p>
      </div>}
    </section>
  );
}
