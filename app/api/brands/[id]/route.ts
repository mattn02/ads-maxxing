import { z } from "zod";
import { authenticated } from "@/lib/supabase/server";
import { readBrand, saveBrandCorrections } from "@/lib/workflow/brands";
import { brandEditsSchema } from "@/lib/workflow/onboarding-contracts";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  return authenticated(request, async () =>
    Response.json(await readBrand((await params).id)),
  );
}
export async function POST(request: Request, { params }: Context) {
  return authenticated(request, async () => {
    const input = z
      .object({
        revision: z.number().int().nonnegative(),
        edits: brandEditsSchema,
      })
      .parse(await request.json());
    return Response.json(
      await saveBrandCorrections(
        (await params).id,
        input.revision,
        input.edits,
      ),
    );
  });
}
