import { createSession, listSessions } from "@/lib/workflow/sessions";
import { authenticated } from "@/lib/supabase/server";
export const runtime = "nodejs";
export async function GET(request: Request) {
 return authenticated(request, async () => Response.json(await listSessions()), true);
}
export async function POST(request: Request) {
 return authenticated(request, async () => Response.json(await createSession(), { status: 201 }), true);
}
