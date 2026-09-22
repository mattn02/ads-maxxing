"use client";
/* eslint-disable @next/next/no-img-element */
import { useState } from "react";
import type {
  BrandDetail,
  BrandEdits,
} from "@/lib/workflow/onboarding-contracts";
import { Badge, Button } from "./ui";
import { CampaignDirection } from "./campaign-direction";
import type { GenerationSource } from "@/lib/workflow/generation-contracts";

export function BrandSummaryView({
  brand,
  busy,
  save,
  start,
  dirty,
}: {
  brand: BrandDetail;
  busy: boolean;
  save: (edits: BrandEdits) => Promise<boolean>;
  start: (source: GenerationSource) => void;
  dirty: (value: boolean) => void;
}) {
  const research = brand.research!;
  const kit = research.brandKit!;
  function values(): BrandEdits {
    return {
      name: kit.name,
      voice: kit.overrides.voice ?? kit.voice.value ?? "",
      audience: kit.overrides.audience ?? kit.audience.value ?? "",
      valueProposition:
        kit.overrides.valueProposition ?? kit.valueProposition.value ?? "",
      colors: kit.colors
        .filter((color) => /^#[0-9a-f]{6}$/i.test(color.value))
        .map(({ role, value }) => ({ role, value })),
      selectedLogoAssetId: kit.selectedLogoAssetId,
    };
  }
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<BrandEdits>(values);
  const logos =
    research.assets?.filter(
      (asset) => kit.logoAssetIds.includes(asset.id) && asset.role === "logo",
    ) || [];
  const logo = logos.find((asset) => asset.id === kit.selectedLogoAssetId);
  const provenance = (field: "voice" | "audience" | "valueProposition") =>
    field in kit.overrides
      ? "Edited by you"
      : kit[field].status !== "found"
        ? "Not found"
        : kit[field].evidence?.origin === "observed"
          ? "Observed"
          : "Inferred";
  function close() {
    setEditing(false);
    dirty(false);
  }
  return (
    <section className="brand-summary">
      <div className="summary-heading">
        <div>
          <span className="eyebrow">YOUR CREATIVE FOUNDATION</span>
          <h1>{kit.name}</h1>
          <a href={brand.storeUrl} target="_blank" rel="noreferrer">
            {new URL(brand.storeUrl).hostname} ↗
          </a>
        </div>
        {logo && (
          <img
            className="summary-logo"
            src={logo.originalUrl}
            alt={`${kit.name} logo`}
          />
        )}
      </div>
      <p className="muted brand-positioning">
        {kit.overrides.valueProposition ?? kit.valueProposition.value ?? "Your brand is saved and ready for its first campaign."}
      </p>
      {!editing && <CampaignDirection research={research} busy={busy || !brand.ready} generate={start} />}
      <div className="actions summary-actions">
        {!editing && (
          <Button
            disabled={busy}
            onClick={() => {
              setDraft(values());
              setEditing(true);
              dirty(true);
            }}
          >
            Edit brand
          </Button>
        )}
      </div>
      {editing ? (
        <form
          inert={busy}
          className="card summary-editor"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await save(draft)) close();
          }}
        >
          <h2>Refine your brand</h2>
          <p className="small muted">
            Applies to new campaigns. Existing campaigns keep their saved brand
            settings.
          </p>
          <label htmlFor="brand-name">Name</label>
          <input
            id="brand-name"
            value={draft.name}
            maxLength={200}
            required
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
          />
          {(["valueProposition", "voice", "audience"] as const).map((field) => (
            <div key={field}>
              <label htmlFor={`edit-${field}`}>
                {field === "valueProposition"
                  ? "Positioning"
                  : field === "voice"
                    ? "Voice"
                    : "Audience"}
              </label>
              <textarea
                id={`edit-${field}`}
                value={draft[field]}
                maxLength={2000}
                onChange={(event) =>
                  setDraft({ ...draft, [field]: event.target.value })
                }
              />
            </div>
          ))}
          <fieldset>
            <legend>Palette</legend>
            {draft.colors.map((color, index) => (
              <label className="color-editor" key={index}>
                {color.role}
                <input
                  type="color"
                  value={color.value}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      colors: draft.colors.map((item, at) =>
                        at === index
                          ? { ...item, value: event.target.value }
                          : item,
                      ),
                    })
                  }
                />
              </label>
            ))}
            {!draft.colors.length && (
              <Button
                type="button"
                onClick={() =>
                  setDraft({
                    ...draft,
                    colors: [
                      { role: "background", value: "#f6f3ee" },
                      { role: "accent", value: "#18251e" },
                    ],
                  })
                }
              >
                Add palette
              </Button>
            )}
          </fieldset>
          <label htmlFor="brand-logo">Logo</label>
          <select
            id="brand-logo"
            value={draft.selectedLogoAssetId || ""}
            onChange={(event) =>
              setDraft({
                ...draft,
                selectedLogoAssetId: event.target.value || null,
              })
            }
          >
            <option value="">No logo</option>
            {logos.map((asset, index) => (
              <option key={asset.id} value={asset.id}>
                Observed logo {index + 1}
              </option>
            ))}
          </select>
          {!!logos.length && (
            <div className="logo-options">
              {logos.map((asset, index) => (
                <button
                  type="button"
                  key={asset.id}
                  aria-pressed={draft.selectedLogoAssetId === asset.id}
                  onClick={() =>
                    setDraft({ ...draft, selectedLogoAssetId: asset.id })
                  }
                >
                  <img
                    src={asset.originalUrl}
                    alt={`Observed logo ${index + 1}`}
                  />
                </button>
              ))}
            </div>
          )}
          <div className="actions">
            <Button primary disabled={busy}>
              Save changes
            </Button>
            <Button type="button" disabled={busy} onClick={close}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <details className="brand-foundation">
          <summary>Brand kit · voice, audience & palette</summary>
          <div className="card">
            <Badge>{provenance("valueProposition")}</Badge>
            <h2>Positioning</h2>
            <p>
              {kit.overrides.valueProposition ??
                kit.valueProposition.value ??
                "Not found. Add what makes your brand different."}
            </p>
          </div>
          <div className="findings-grid">
            {(["voice", "audience"] as const).map((field) => (
              <div className="card" key={field}>
                <Badge>{provenance(field)}</Badge>
                <h2>{field === "voice" ? "Voice" : "Audience"}</h2>
                <p>{research[field] || "Not found. You can add this later."}</p>
              </div>
            ))}
          </div>
          <div className="card">
            <h2>
              Your palette{" "}
              <Badge>
                {kit.visualOverrides?.colors ? "Edited by you" : "Observed"}
              </Badge>
            </h2>
            <div className="palette">
              {kit.colors.map((color, index) => (
                <div key={index}>
                  <span style={{ backgroundColor: color.value }} />
                  {color.role} · {color.value}
                </div>
              ))}
            </div>
            {!kit.colors.length && (
              <p className="small muted">
                No palette found. You can add one, or start with a neutral
                palette.
              </p>
            )}
            {!logo && (
              <p className="small muted">
                No logo selected. Creatives can proceed without one.
              </p>
            )}
          </div>
        </details>
      )}
      <details className="card">
        <summary>Products, collections & sources</summary>
        <p className="small muted">
          Links observed on your store. Product details and photos are
          researched after you choose a direction.
        </p>
        <div className="observed-links">
          {(research.discoveredLinks || research.suggestions || []).map(
            (link) => (
              <a key={link.id} href={link.url} target="_blank" rel="noreferrer">
                {link.label} ↗
              </a>
            ),
          )}
        </div>
        <h3>Typography</h3>
        <p>
          {kit.typography.heading.value || "Not found"} /{" "}
          {kit.typography.body.value || "Not found"}
        </p>
        {research.sources.map((source) => (
          <p key={source.url}>
            <a href={source.url} target="_blank" rel="noreferrer">
              {source.title} ↗
            </a>
          </p>
        ))}
      </details>
    </section>
  );
}
