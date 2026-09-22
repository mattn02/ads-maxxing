import { createSession, listSessions } from "@/lib/workflow/sessions";
import { apiError } from "@/lib/workflow/validation";
export const runtime = "nodejs";
export async function GET() {
  try { return Response.json(await listSessions()); } catch (error) { return apiError(error); }
}
export async function POST() {
  try { return Response.json(await createSession(), { status: 201 }); } catch (error) { return apiError(error); }
}
