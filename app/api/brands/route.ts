import { authenticated } from "@/lib/supabase/server";
import { listBrands } from "@/lib/workflow/brands";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return authenticated(
    request,
    async () => Response.json(await listBrands()),
    true,
  );
}
