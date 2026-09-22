"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@/lib/workflow/session-types";
import type { GenerationSource } from "@/lib/workflow/generation-contracts";
import type {
  BrandDetail,
  BrandSummary,
  BrandEdits,
} from "@/lib/workflow/onboarding-contracts";
import { workspaceApi, type CampaignSummary } from "@/lib/workspace/api";
import { BrandOnboarding } from "@/components/workspace/brand-onboarding";
import { BrandSummaryView } from "@/components/workspace/brand-summary";
import { CampaignWorkspace } from "@/components/workspace/campaign-workspace";
import { Button } from "@/components/workspace/ui";

type Target = { kind: "new" } | { kind: "session" | "brand"; id: string };
function locationTarget(): Target {
  const query = new URLSearchParams(window.location.search);
  if (query.get("session"))
    return { kind: "session", id: query.get("session")! };
  if (query.get("brand")) return { kind: "brand", id: query.get("brand")! };
  return { kind: "new" };
}
export function WorkflowConsole() {
  const [session, setSession] = useState<Session | null>(null);
  const [brand, setBrand] = useState<BrandDetail | null>(null);
  const [brands, setBrands] = useState<BrandSummary[]>([]);
  const [sessions, setSessions] = useState<CampaignSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [pendingGeneration, setPendingGeneration] = useState<{
    sessionId: string;
    requestId: string;
    source: GenerationSource;
  } | null>(null);
  const boot = useRef(false);
  const navigation = useRef(0);
  const creationKey = useRef<string | null>(null);
  const creationUrl = useRef("");
  const campaignKey = useRef<string | null>(null);
  const campaignBrand = useRef("");
  const working = useRef(false);

  async function lists() {
    // Establish anonymous identity once before the second request.
    const savedBrands = await workspaceApi.brands();
    const savedSessions = await workspaceApi.list();
    setBrands(savedBrands);
    setSessions(savedSessions);
    return { savedBrands, savedSessions };
  }
  function address(target: Target, replace = false) {
    const query =
      target.kind === "new"
        ? "?new=1"
        : `?${target.kind}=${encodeURIComponent(target.id)}`;
    window.history[replace ? "replaceState" : "pushState"]({}, "", `/${query}`);
  }
  const load = useCallback(async (target: Target, push = true) => {
    const version = ++navigation.current;
    setLoading(true);
    setError("");
    setLoadFailed(false);
    setPendingGeneration(null);
    if (push) address(target);
    try {
      let nextSession: Session | null = null,
        nextBrand: BrandDetail | null = null;
      if (target.kind === "session") {
        nextSession = await workspaceApi.open(target.id);
        if (
          nextSession.purpose === "brand_setup" &&
          nextSession.setup?.state === "ready" &&
          nextSession.brandId
        )
          nextBrand = await workspaceApi.brand(nextSession.brandId);
        // Old blank demo rows use the new URL form; no migration or replay.
        if (!nextSession.research && !nextSession.setup) nextSession = null;
      } else if (target.kind === "brand") {
        nextBrand = await workspaceApi.brand(target.id);
        if (!nextBrand.ready && nextBrand.setupId) {
          nextSession = await workspaceApi.open(nextBrand.setupId);
          nextBrand = null;
        }
      }
      if (version !== navigation.current) return;
      setSession(nextSession);
      setBrand(nextBrand);
      setDirty(false);
    } catch (cause) {
      if (version === navigation.current) {
        setError((cause as Error).message);
        setLoadFailed(true);
      }
    } finally {
      if (version === navigation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (boot.current) return;
    boot.current = true;
    void (async () => {
      try {
        const { savedBrands, savedSessions } = await lists();
        let target = locationTarget();
        if (!window.location.search) {
          const latest = savedSessions.find(
            (item) => item.purpose === "campaign",
          );
          target = latest
            ? { kind: "session", id: latest.id }
            : savedBrands[0]
              ? { kind: "brand", id: savedBrands[0].id }
              : { kind: "new" };
          address(target, true);
        }
        await load(target, false);
      } catch (cause) {
        setError((cause as Error).message);
        setLoadFailed(true);
        setLoading(false);
      }
    })();
  }, [load]);
  useEffect(() => {
    const onBack = () => {
      if (dirty || busy) {
        window.history.forward();
        setError(
          dirty
            ? "Save or cancel your brand edits before leaving."
            : "Wait for the current action to finish before navigating.",
        );
        return;
      }
      void load(locationTarget(), false);
    };
    window.addEventListener("popstate", onBack);
    return () => window.removeEventListener("popstate", onBack);
  }, [load, dirty, busy]);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  useEffect(() => {
    if (
      session?.purpose !== "brand_setup" ||
      (session.setup?.state !== "researching" && !session.operationActive)
    )
      return;
    let disposed = false;
    const poll = async () => {
      try {
        const next = await workspaceApi.open(session.id);
        if (disposed) return;
        setSession(next);
        if (next.setup?.state === "ready" && next.brandId) {
          const completed = await workspaceApi.brand(next.brandId);
          if (!disposed) {
            setBrand(completed);
            void lists();
          }
        }
      } catch {
        if (!disposed)
          setError(
            "Couldn’t refresh saved progress. Check your connection and reload; research will not restart automatically.",
          );
      }
    };
    const timer = setInterval(() => void poll(), 2500);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [
    session?.id,
    session?.purpose,
    session?.setup?.state,
    session?.operationActive,
  ]);
  async function research(next: Session) {
    try {
      setSession({
        ...next,
        setup: next.setup
          ? { ...next.setup, state: "researching", progress: "reading" }
          : undefined,
      });
      const result = await workspaceApi.action(next.id, {
        action: "researchBrand",
        operationId: crypto.randomUUID(),
      });
      setSession(result);
      if (result.brandId && result.setup?.state === "ready")
        setBrand(await workspaceApi.brand(result.brandId));
      await lists();
    } catch (cause) {
      setError((cause as Error).message);
      try {
        setSession(await workspaceApi.open(next.id));
      } catch {
        /* Keep explicit error and current state. */
      }
    }
  }
  async function submit(url: string) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      if (creationUrl.current !== url) {
        creationKey.current = null;
        creationUrl.current = url;
      }
      creationKey.current ??= crypto.randomUUID();
      const next = await workspaceApi.create(url, creationKey.current);
      setSession(next);
      setBrand(null);
      address({ kind: "session", id: next.id });
      if (next.brandId) {
        const saved = await workspaceApi.brand(next.brandId);
        if (saved.ready) {
          setBrand(saved);
          address({ kind: "brand", id: saved.id }, true);
          await lists();
          return;
        }
      }
      if (next.setup?.state === "needs_url") await research(next);
      else await lists();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  async function retry() {
    if (!session || working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      await research(session);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  async function start(brandId: string, setupId?: string, source?: GenerationSource) {
    if (working.current || dirty) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      if (campaignBrand.current !== brandId) {
        campaignKey.current = null;
        campaignBrand.current = brandId;
      }
      campaignKey.current ??= crypto.randomUUID();
      const next = await workspaceApi.startCampaign(
        brandId,
        campaignKey.current,
        setupId,
      );
      await lists();
      setSession(next);
      setBrand(null);
      setPendingGeneration(source ? { sessionId: next.id, requestId: crypto.randomUUID(), source } : null);
      address({ kind: "session", id: next.id });
      campaignKey.current = null;
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  async function save(edits: BrandEdits) {
    if (!brand) return false;
    setBusy(true);
    setError("");
    try {
      setBrand(await workspaceApi.saveBrand(brand.id, brand.revision, edits));
      await lists();
      return true;
    } catch (cause) {
      setError((cause as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  function newBrand() {
    creationKey.current = null;
    campaignKey.current = null;
    void load({ kind: "new" });
  }
  if (loading || loadFailed)
    return (
      <main className="workspace-loading" role="status">
        <h1>
          {loading ? "Opening your workspace…" : "Couldn’t open your workspace"}
        </h1>
        {error && <p role="alert">{error}</p>}
        {!loading && (
          <Button
            onClick={() => {
              void lists()
                .then(() => load(locationTarget(), false))
                .catch((cause) => setError(cause.message));
            }}
          >
            Retry
          </Button>
        )}
      </main>
    );
  if (!brand && session?.purpose === "campaign" && session.research)
    return (
      <>
        <CampaignWorkspace
          navigationBusy={busy}
          key={session.id}
          initial={session}
          initialGeneration={pendingGeneration?.sessionId === session.id ? pendingGeneration : undefined}
          sessions={sessions.filter(
            (item) =>
              item.purpose === "campaign" && item.brandId === session.brandId,
          )}
          brands={brands}
          selectBrand={(id) => void load({ kind: "brand", id })}
          open={(id) => load({ kind: "session", id })}
          newBrand={newBrand}
          newCampaign={() => session.brandId && void start(session.brandId)}
          viewBrand={() =>
            session.brandId && void load({ kind: "brand", id: session.brandId })
          }
        />
        {error && (
          <div className="workspace-toast" role="alert">
            {error}
            <Button onClick={() => setError("")}>Dismiss</Button>
          </div>
        )}
      </>
    );
  return (
    <div className="workspace chat-closed setup-workspace">
      <aside className="sidebar">
        <span className="wordmark">◈ studio.</span>
        <p className="nav-label">YOUR BRANDS</p>
        <nav aria-label="Saved brands">
          {brands.map((item) => (
            <button
              key={item.id}
              disabled={busy || dirty}
              className={`nav-item ${item.id === (brand?.id || session?.brandId) ? "selected" : ""}`}
              onClick={() => void load({ kind: "brand", id: item.id })}
            >
              {item.name}
            </button>
          ))}
        </nav>
        <Button disabled={busy || dirty} onClick={newBrand}>
          + New brand
        </Button>
        <p className="small muted sidebar-bottom">
          Your work saves to your private workspace.
        </p>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span>
            <strong>{brand?.ready ? "Brand" : "Brand setup"}</strong>
          </div>
        </header>
        {!!brand &&
          sessions.some(
            (item) => item.purpose === "campaign" && item.brandId === brand.id,
          ) && (
            <div className="campaign-bar">
              <label htmlFor="saved-campaigns">Campaigns</label>
              <select
                id="saved-campaigns"
                value=""
                disabled={busy || dirty}
                onChange={(event) =>
                  void load({ kind: "session", id: event.target.value })
                }
              >
                <option value="">Open a saved campaign</option>
                {sessions
                  .filter(
                    (item) =>
                      item.purpose === "campaign" && item.brandId === brand.id,
                  )
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
              </select>
            </div>
          )}
        <main className="main-scroll">
          {error && (
            <div className="error-box" role="alert">
              {error}
            </div>
          )}
          {brand?.ready && brand.research ? (
            <BrandSummaryView
              key={brand.id}
              brand={brand}
              busy={
                busy ||
                (session?.purpose === "brand_setup" &&
                  !!session.operationActive)
              }
              save={save}
              dirty={setDirty}
              start={(source) => void start(brand.id, brand.setupId, source)}
            />
          ) : (
            <BrandOnboarding
              key={session?.id || "new"}
              session={session}
              busy={busy}
              submit={(url) => void submit(url)}
              retry={() => void retry()}
              edit={newBrand}
            />
          )}
        </main>
      </div>
    </div>
  );
}
