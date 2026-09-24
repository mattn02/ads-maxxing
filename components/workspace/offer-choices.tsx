import type { Research } from "@/lib/workflow/session-types";

type Offer = NonNullable<Research["offers"]>[number];

export function offerIssue(offer: Offer): string | null {
  const now = Date.now();
  const checked = Date.parse(offer.checkedAt);
  if (offer.eligibility === "expired") return "Marked expired.";
  if (!Number.isFinite(checked) || checked > now + 300_000 || now - checked > 86_400_000) return "Source check is over 24 hours old.";
  if (offer.endsAt && (!Number.isFinite(Date.parse(offer.endsAt)) || Date.parse(offer.endsAt) <= now)) return "Offer has ended.";
  return null;
}

export function OfferChoices({ offers, name, saleId, setSaleId, confirmed, setConfirmed, busy, label }: {
  offers: Offer[];
  name: string;
  saleId: string | null;
  setSaleId: (id: string | null) => void;
  confirmed: boolean;
  setConfirmed: (value: boolean) => void;
  busy: boolean;
  label: string;
}) {
  function choose(id: string | null) {
    setSaleId(id);
    setConfirmed(false);
  }
  return <div className="offer-choices" role="group" aria-label={label}>
    <label className="checkpoint-offer"><input type="radio" name={name} checked={!saleId} disabled={busy} onChange={() => choose(null)} /> No offer</label>
    {!offers.length && <p className="small muted">No supported offers found for this product.</p>}
    {offers.map((offer) => {
      const issue = offerIssue(offer);
      return <label className="checkpoint-offer" key={offer.id}>
        <input type="radio" name={name} checked={saleId === offer.id} disabled={busy || !!issue} onChange={() => choose(offer.id)} />
        <span><strong>{offer.displayCopy}</strong>{offer.restrictions && offer.restrictions !== offer.displayCopy && <small>Terms: {offer.restrictions}</small>}<small>Store wording: “{offer.displayCopy}”</small>{issue && <small className="checkpoint-offer-unavailable">{issue} Research this offer again to use it.</small>}<small>Source: <a href={offer.sourceUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>{new URL(offer.sourceUrl).hostname}</a></small></span>
      </label>;
    })}
    {saleId && <label className="checkpoint-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} /> I confirm this offer is still valid, applies to this product, and the target customers meet all its terms.</label>}
  </div>;
}
