import { readImage } from "@/lib/workflow/storage";
export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const image = await readImage(id);
  if (!image) return new Response("Image not found", { status: 404 });
  return new Response(new Uint8Array(image), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
}
