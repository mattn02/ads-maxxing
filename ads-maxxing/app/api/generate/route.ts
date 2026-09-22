import { generateImage } from "@/lib/workflow/fal";
import { saveGeneration } from "@/lib/workflow/storage";
import { apiError, text, webUrl } from "@/lib/workflow/validation";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const referenceImage = webUrl(body?.referenceImage);
    const productUrl = webUrl(body?.productUrl);
    const prompt = text(body?.prompt, "Prompt");
    const generated = await generateImage(referenceImage, prompt);
    return Response.json(await saveGeneration({ ...generated, referenceImage, productUrl, prompt }));
  } catch (error) { return apiError(error); }
}
