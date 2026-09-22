"use client";
/* eslint-disable @next/next/no-img-element -- Plain previews for arbitrary scraped URLs in this local prototype. */
import { useState } from "react";
import type { Generation, Product } from "@/lib/workflow/types";

async function post<T>(endpoint: string, body: unknown): Promise<T> {
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}
export default function Home() {
  const [url, setUrl] = useState("https://www.loopycases.com");
  const [product, setProduct] = useState<Product | null>(null);
  const [referenceImage, setReferenceImage] = useState("");
  const [prompt, setPrompt] = useState("");
  const [outputs, setOutputs] = useState<Generation[]>([]);
  const [busy, setBusy] = useState<"scraping" | "generating" | null>(null);
  const [error, setError] = useState("");
  async function scrape() {
    setBusy("scraping"); setError(""); setProduct(null); setReferenceImage(""); setOutputs([]);
    try {
      const data = await post<{ product: Product; prompt: string }>("/api/scrape", { url });
      setProduct(data.product); setPrompt(data.prompt); setReferenceImage(data.product.images[0] || "");
    } catch (error) { setError(error instanceof Error ? error.message : "Scraping failed."); }
    finally { setBusy(null); }
  }
  async function generate() {
    if (!product) return;
    setBusy("generating"); setError("");
    try {
      const output = await post<Generation>("/api/generate", { productUrl: product.url, referenceImage, prompt });
      setOutputs((previous) => [output, ...previous]);
    } catch (error) { setError(error instanceof Error ? error.message : "Generation failed."); }
    finally { setBusy(null); }
  }
  return <main>
    <h1>URL → product → image</h1>
    <p>Local workflow test. Firecrawl scrape → fal image edit → local PNG.</p>
    <form onSubmit={(event) => { event.preventDefault(); void scrape(); }}>
      <label htmlFor="url">1. Product URL</label>
      <input id="url" type="url" required value={url} onChange={(event) => setUrl(event.target.value)} disabled={!!busy} />
      <p>A direct product page works best. A homepage may return banners and logos.</p>
      <button disabled={!!busy}>Scrape URL</button>
    </form>
    <p role="status">{busy === "scraping" ? "Scraping with Firecrawl…" : busy === "generating" ? "Generating with fal and saving locally… this can take a few minutes." : "Ready."}</p>
    {error && <p role="alert">{error}</p>}
    {product && <section>
      <h2>2. Inspect the scrape</h2>
      <p><strong>{product.title}</strong></p><p>{product.description || "No description found."}</p>
      <p>Choose the actual product photo before generating.</p>
      {product.images.length ? <div className="images">{product.images.map((image, index) => <button type="button" key={image} disabled={!!busy} aria-pressed={referenceImage === image} onClick={() => setReferenceImage(image)} aria-label={`Select image ${index + 1}`}>
        <img src={image} alt={`Scraped image ${index + 1}`} loading="lazy" />
      </button>)}</div> : <p>No images found. Paste a public product image URL below, or try another page.</p>}
      <label htmlFor="reference">Reference image URL</label>
      <input id="reference" type="url" value={referenceImage} disabled={!!busy} onChange={(event) => setReferenceImage(event.target.value)} />
      {referenceImage && <img className="reference" src={referenceImage} alt="Selected product reference" />}
      <details><summary>Scraped text</summary><pre>{product.markdown || "No text returned."}</pre></details>
      <h2>3. Generate an ad</h2>
      <p>FLUX.2 klein 4B · one 576 × 1024 image · four steps.</p>
      <label htmlFor="prompt">Prompt — edit this to steer the first or next generation</label>
      <textarea id="prompt" rows={10} value={prompt} maxLength={8000} disabled={!!busy} onChange={(event) => setPrompt(event.target.value)} />
      <button type="button" disabled={!!busy || !referenceImage || !prompt.trim()} onClick={() => void generate()}>{outputs.length ? "Generate another image" : "Generate image"}</button>
    </section>}
    {!!outputs.length && <section><h2>4. Output</h2><p>Saved in local-output/ as PNG + JSON. Check product fidelity and text; edit the prompt above to iterate.</p>
      {outputs.map((output) => <article key={output.id}>
        <img className="output" src={output.imageUrl} alt="Generated portrait product ad" />
        <p><a href={output.imageUrl} download={`${output.id}.png`}>Download PNG</a></p>
        <details><summary>Generation inputs</summary><pre>{JSON.stringify(output, null, 2)}</pre></details>
      </article>)}
    </section>}
  </main>;
}
