import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { VisualAsset, VisualInputs } from "./creative/schema";
import type { Generation } from "./types";
import { WorkflowError } from "./validation";
import { dataDirectory } from "./sessions";
export async function saveGeneration(input: { imageUrl: string; model: string; seed?: number; prompt: string; referenceImage: string; productUrl: string }): Promise<Generation> {
  const outputDir = dataDirectory();
  const id = randomUUID();
  const record = { ...input, id, createdAt: new Date().toISOString(), imageUrl: `/api/outputs/${id}` };
  // Preserve provider URL and inputs first, so a failed download is recoverable.
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, `${id}.json`), JSON.stringify({ ...record, providerImageUrl: input.imageUrl }, null, 2));
  try {
    const bytes = await downloadFalPng(input.imageUrl);
    await writeFile(path.join(outputDir, `${id}.png`), bytes);
  } catch {
    throw new WorkflowError(`Image generated, but local download failed. Its recovery URL is in local-output/${id}.json. Recover it before generating again.`, 502);
  }
  return record;
}
export async function readImage(id: string) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) return null;
  try { return await readFile(path.join(dataDirectory(), `${id}.png`)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

/** Local composition writes never pass through the provider download trust boundary. */
async function atomicWrite(filename: string, bytes: Buffer | string) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, filename);
}
export async function saveVisual(input: {
  imageUrl: string; prompt: string; model: string; seed?: number;
  inputs: VisualInputs;
}): Promise<VisualAsset> {
  const directory = path.join(dataDirectory(), "visuals");
  await mkdir(directory, { recursive: true });
  const asset = { id: randomUUID(), inputs: input.inputs, prompt: input.prompt, model: input.model,
    ...(input.seed === undefined ? {} : { seed: input.seed }), createdAt: new Date().toISOString() };
  await atomicWrite(path.join(directory, `${asset.id}.json`), JSON.stringify({ ...asset, providerImageUrl: input.imageUrl }, null, 2));
  try {
    const bytes = await downloadFalPng(input.imageUrl);
    await atomicWrite(path.join(directory, `${asset.id}.png`), bytes);
  } catch {
    throw new WorkflowError(`Visual generated, but local download failed. Its recovery URL is in local-output/visuals/${asset.id}.json. Recover it before generating again.`, 502);
  }
  return asset;
}
export async function readVisual(id: string) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) return null;
  try { return await readFile(path.join(dataDirectory(), "visuals", `${id}.png`)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
export async function saveComposedGeneration(record: Generation, bytes: Buffer): Promise<Generation> {
  if (!/^[a-f0-9-]{36}$/.test(record.id)) throw new WorkflowError("Invalid output ID.");
  if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || bytes.length < 24 || bytes.readUInt32BE(16) !== 576 || bytes.readUInt32BE(20) !== 1024) throw new WorkflowError("Renderer must produce a 576 × 1024 PNG.");
  await mkdir(dataDirectory(), { recursive: true });
  await atomicWrite(path.join(dataDirectory(), `${record.id}.png`), bytes);
  await atomicWrite(path.join(dataDirectory(), `${record.id}.json`), JSON.stringify(record, null, 2));
  return record;
}

async function downloadFalPng(imageUrl: string): Promise<Buffer> {
  const url = new URL(imageUrl);
  if (url.protocol !== "https:" || !(url.hostname === "fal.media" || url.hostname.endsWith(".fal.media"))) throw new Error("Invalid fal host.");
  const response = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: "error" });
  if (!response.ok) throw new Error("Download failed.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error("Invalid PNG.");
  return bytes;
}
