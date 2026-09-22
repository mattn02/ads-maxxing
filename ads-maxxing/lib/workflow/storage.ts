import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Generation } from "./types";
import { WorkflowError } from "./validation";
const outputDir = path.join(process.cwd(), "local-output");
export async function saveGeneration(input: { imageUrl: string; model: string; seed?: number; prompt: string; referenceImage: string; productUrl: string }): Promise<Generation> {
  const id = randomUUID();
  const record = { ...input, id, createdAt: new Date().toISOString(), imageUrl: `/api/outputs/${id}` };
  // Preserve provider URL and inputs first, so a failed download is recoverable.
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, `${id}.json`), JSON.stringify({ ...record, providerImageUrl: input.imageUrl }, null, 2));
  try {
    const url = new URL(input.imageUrl);
    if (url.protocol !== "https:" || !(url.hostname === "fal.media" || url.hostname.endsWith(".fal.media"))) throw new Error();
    const response = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: "error" });
    if (!response.ok) throw new Error();
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error();
    await writeFile(path.join(outputDir, `${id}.png`), bytes);
  } catch {
    throw new WorkflowError(`Image generated, but local download failed. Its recovery URL is in local-output/${id}.json. Recover it before generating again.`, 502);
  }
  return record;
}
export async function readImage(id: string) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) return null;
  try { return await readFile(path.join(outputDir, `${id}.png`)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
