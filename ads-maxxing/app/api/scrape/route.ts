import { scrapeProduct } from "@/lib/workflow/firecrawl";
import { buildPrompt } from "@/lib/workflow/prompt";
import { apiError, webUrl } from "@/lib/workflow/validation";
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const product = await scrapeProduct(webUrl(body?.url));
    return Response.json({ product, prompt: buildPrompt(product) });
  } catch (error) { return apiError(error); }
}
