/** Read-only, compact diagnostics for one explicitly named campaign. */
import { persistenceContext, supabase, rows } from "../lib/supabase/server";
import { sessionId } from "../lib/workflow/sessions";
import type { Brief, Session, Variant } from "../lib/workflow/session-types";
import { compactShopifySource } from "../lib/workflow/research/shopify-fetch";
const id = sessionId(process.argv[2]);
async function main() {
  const [owner] = await (await supabase(`/rest/v1/campaigns?id=eq.${id}&select=user_id`)).json() as {user_id:string}[];
  if (!owner) throw new Error("Named campaign not found");
  await persistenceContext.run({ userId: owner.user_id }, async () => {
    const [campaign] = await rows<{id:string;updated_at:string;current_research_id:string|null;current_version_id:string|null;workflow_state:Session["researchState"];lease_expires_at:string|null;events:Session["events"]}>("campaigns", `id=eq.${id}&select=id,updated_at,current_research_id,current_version_id,workflow_state,lease_expires_at,events`);
    const versions = await rows<{id:string;brief:Brief;generation:Omit<Variant,"brief"|"research">|null}>("ad_versions", `campaign_id=eq.${id}&select=id,brief,generation`);
    const brief = versions.find(item=>item.id===campaign.current_version_id)?.brief;
    if (process.argv.includes("--measure-compaction") && campaign.current_research_id) {
      const [snapshot] = await rows<{data:NonNullable<Session["research"]>}>("research_snapshots", `id=eq.${campaign.current_research_id}&select=data`);
      const compact = { ...snapshot.data, sources: snapshot.data.sources.map(compactShopifySource) };
      console.log(JSON.stringify({compaction:{beforeBytes:Buffer.byteLength(JSON.stringify(snapshot.data)),afterBytes:Buffer.byteLength(JSON.stringify(compact)),shopifySources:snapshot.data.sources.filter(source=>source.shopify).length,members:compact.campaign?.scope?.members.length,products:compact.products?.length,assets:compact.assets?.length}}));
    }
    console.log(JSON.stringify({id,updatedAt:campaign.updated_at,stage:campaign.workflow_state?.stage,intent:campaign.workflow_state?.generationIntent,leaseActive:!!campaign.lease_expires_at&&Date.parse(campaign.lease_expires_at)>Date.now(),briefId:brief?.id,executionPlan:brief?.executionPlan,sourceAssetId:brief?.sourceAssetId,parentVariantId:brief?.parentVariantId,background:brief?.backgroundCheckpoint?.state,scene:brief?.sceneCheckpoint?.state,variants:versions.filter(item=>item.generation).map(item=>({id:item.id,status:item.generation!.status,review:item.generation!.review?.verdict})),recentEvents:campaign.events.slice(-5)}));
  });
}
main().catch(error=>{console.error(error instanceof Error?error.message:"Inspection failed");process.exitCode=1;});
