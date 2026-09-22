import { z } from "zod";
import { listSessions } from "@/lib/workflow/sessions";
import { createSetup, startCampaign } from "@/lib/workflow/brands";
import { publicSession } from "@/lib/workflow/public-session";
import { authenticated } from "@/lib/supabase/server";
export const runtime = "nodejs";
const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("setup"), url: z.string().min(1).max(4000), key: z.string().uuid() }),
  z.object({ action: z.literal("campaign"), brandId: z.string().uuid(), setupId: z.string().uuid().optional(), key: z.string().uuid() }),
]);
export async function GET(request: Request) {
  return authenticated(request, async () => Response.json(await listSessions()), true);
}
export async function POST(request: Request) {
  return authenticated(request, async () => {
    const input = inputSchema.parse(await request.json());
    const session = input.action === "setup" ? await createSetup(input.url, input.key) : await startCampaign(input.brandId, input.key, input.setupId);
    return Response.json(publicSession(session), { status: 201 });
  }, true);
}
