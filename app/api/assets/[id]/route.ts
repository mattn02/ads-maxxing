import { authenticated } from "@/lib/supabase/server";
import { assetResponse } from "@/lib/workflow/storage";
export const runtime = "nodejs";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
 return authenticated(request,async()=>assetResponse((await params).id));
}
