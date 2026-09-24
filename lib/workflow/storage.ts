import { isDeepStrictEqual } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import type { VisualAsset, VisualInputs } from "./creative/schema";
import type { Generation } from "./types";
import { WorkflowError } from "./validation";
import { configuration, ownerContext, rows, rpc, supabase } from "../supabase/server";
import { downloadImage, imageMetadata } from "./asset-download";
import { sessionId } from "./sessions";

type Asset = { id:string; kind:string; bucket:string; storage_path:string; storage_state:string; source_url:string|null; source_research_id:string|null; content_hash:string|null; metadata:Record<string,unknown>; mime_type:string; width:number; height:number; byte_size:number };
async function register(asset: object) {
  const context=ownerContext(); const lease=context.lease;
  if(!lease)throw new WorkflowError("A campaign lease is required to save assets.",409);
  const result=await rpc<{revision:number}>("register_asset",{p_owner:context.userId,p_id:lease.campaignId,p_token:lease.token,p_revision:lease.revision,p_asset:asset});
  lease.revision=result.revision;
}
async function assetRecord(id:string) { return (await rows<Asset>("assets",`id=eq.${sessionId(id)}&select=*`))[0]; }
async function persistBytes(input:{id:string;kind:string;sourceUrl?:string;researchId?:string;metadata:Record<string,unknown>},bytes:Buffer) {
  const context=ownerContext();if(!context.brandId||!context.lease)throw new WorkflowError("Save research before capturing assets.",409);
  const info=imageMetadata(bytes);const hash=createHash("sha256").update(bytes).digest("hex");
  const record={id:input.id,kind:input.kind,storage_path:`${context.userId}/${context.brandId}/${input.id}/image.${info.extension}`,source_url:input.sourceUrl??null,source_research_id:input.researchId??null,metadata:input.metadata,content_hash:hash,mime_type:info.mime,width:info.width,height:info.height,byte_size:bytes.length};
  const existing=await assetRecord(input.id);
  if(existing?.storage_state==="ready") { if(existing.content_hash!==hash)throw new WorkflowError("Saved asset bytes cannot change.",409);return existing; }
  await register({...record,storage_state:"pending"});
  // Never overwrite immutable object paths. An earlier successful upload can be registered after verifying its exact hash.
  const objectPath=`/storage/v1/object/creative-assets/${record.storage_path}`;
  const config=configuration();
  const upload=await fetch(`${config.url}${objectPath}`,{method:"POST",headers:{apikey:config.serviceKey,...(config.serviceKey.startsWith("eyJ")?{Authorization:`Bearer ${config.serviceKey}`} : {}),"Content-Type":info.mime,"x-upsert":"false"},body:new Uint8Array(bytes),signal:AbortSignal.timeout(30000)});
  if(!upload.ok) {
    const stored=await supabase(objectPath,{headers:{"Content-Type":"application/octet-stream"}}).then(r=>r.arrayBuffer()).catch(()=>null);
    if(!stored||createHash("sha256").update(Buffer.from(stored)).digest("hex")!==hash)throw new WorkflowError("Asset upload failed. Recover the saved provider output; do not generate again.",502);
  }
  await register({...record,storage_state:"ready"});
  return {...record,bucket:"creative-assets",storage_state:"ready"};
}
export async function readAsset(id:string):Promise<Buffer|null> {
  const asset=await assetRecord(id);if(!asset||asset.storage_state!=="ready")return null;
  const response=await supabase(`/storage/v1/object/${asset.bucket}/${asset.storage_path}`);
  return Buffer.from(await response.arrayBuffer());
}
export const readVisual=readAsset;
export async function assetProviderUrl(id:string):Promise<string> {
  const asset=await assetRecord(id);if(!asset||asset.storage_state!=="ready")throw new WorkflowError("Saved asset is missing or unavailable.",404);
  const data=await(await supabase(`/storage/v1/object/sign/${asset.bucket}/${asset.storage_path}`,{method:"POST",body:JSON.stringify({expiresIn:600})})).json();
  const signed = String(data.signedURL);
  if(!signed.startsWith("/object/sign/") && !signed.startsWith("/storage/v1/object/sign/"))throw new WorkflowError("Unexpected private asset URL.",502);
  return `${configuration().url}${signed.startsWith("/storage/v1/")?signed:`/storage/v1${signed}`}`;
}
export async function pinSourceAsset(input:{sourceUrl:string;researchId:string;kind?:"product_photo"|"logo"}):Promise<string> {
  const context=ownerContext();const kind=input.kind??"product_photo";
  const existing=await rows<Asset>("assets",`brand_id=eq.${context.brandId}&campaign_id=eq.${context.lease?.campaignId}&source_research_id=eq.${sessionId(input.researchId)}&source_url=eq.${encodeURIComponent(input.sourceUrl)}&kind=eq.${kind}&storage_state=eq.ready&select=*&limit=1`);
  if(existing[0])return existing[0].id;
  // Only accept an image observed in this owner's immutable research snapshot.
  const [snapshot]=await rows<{data:{sources?:{images?:string[]}[];assets?:{url?:string;originalUrl?:string}[];brandKit?:unknown}}>("research_snapshots",`id=eq.${input.researchId}&select=data`);
  const known=snapshot?.data.sources?.some(s=>s.images?.includes(input.sourceUrl))||snapshot?.data.assets?.some(a=>a.url===input.sourceUrl||a.originalUrl===input.sourceUrl);
  if(!known)throw new WorkflowError("Only images from saved research can be captured.");
  const bytes=await downloadImage(input.sourceUrl,false,{convertSvg:kind==="logo"});
  const asset=await persistBytes({id:randomUUID(),kind,sourceUrl:input.sourceUrl,researchId:input.researchId,metadata:{}},bytes);
  return asset.id;
}
export async function saveStageAsset(input:{id?:string;kind:"generated_background"|"generated_scene";imageUrl:string;prompt:string;model:string;seed?:number;inputs:Record<string,unknown>}) {
  const id=input.id??randomUUID();
  const existing=await assetRecord(id);
  if(existing?.storage_state==="ready") {
    if(existing.kind!==input.kind || !isDeepStrictEqual(existing.metadata.inputs,input.inputs) || existing.metadata.model!==input.model || existing.metadata.prompt!==input.prompt)throw new WorkflowError("Saved stage provenance does not match this approved plan.",409);
    return existing.metadata as unknown as {id:string;kind:typeof input.kind;inputs:Record<string,unknown>;prompt:string;model:string;seed?:number;createdAt:string};
  }
  const asset={id,kind:input.kind,inputs:input.inputs,prompt:input.prompt,model:input.model,...(input.seed===undefined?{}:{seed:input.seed}),createdAt:new Date().toISOString()};
  const raw=await downloadImage(input.imageUrl,true);
  const dimensions=imageMetadata(raw);
  let bytes=raw;
  if(input.kind==="generated_scene") {
    const {normalizeScenePng}=await import("./creative/render");
    bytes=await normalizeScenePng(raw);
  } else if(dimensions.mime!=="image/png"||dimensions.width!==576||dimensions.height!==1024)throw new WorkflowError("Background must be a 576 × 1024 PNG.");
  await persistBytes({id,kind:input.kind,metadata:asset},bytes);return asset;
}
export async function saveVisual(input:{imageUrl:string;prompt:string;model:string;seed?:number;inputs:VisualInputs}):Promise<VisualAsset> {
  const asset={id:randomUUID(),inputs:input.inputs,prompt:input.prompt,model:input.model,...(input.seed===undefined?{}:{seed:input.seed}),createdAt:new Date().toISOString()};
  await persistBytes({id:asset.id,kind:"generated_visual",metadata:asset},await downloadImage(input.imageUrl,true));return asset;
}
export async function saveComposedGeneration(record:Generation,bytes:Buffer):Promise<Generation> {
  sessionId(record.id);const info=imageMetadata(bytes);
  if(info.mime!=="image/png"||info.width!==576||info.height!==1024)throw new WorkflowError("Renderer must produce a 576 × 1024 PNG.");
  await persistBytes({id:record.id,kind:"composed_ad",metadata:{versionId:record.id}},bytes);return record;
}
export async function readImage(id:string) {
  const [version]=await rows<{final_asset_id:string|null}>("ad_versions",`id=eq.${sessionId(id)}&select=final_asset_id`);
  return version?.final_asset_id?readAsset(version.final_asset_id):null;
}
export async function assetResponse(id:string):Promise<Response> {
  const asset=await assetRecord(id);if(!asset||asset.storage_state!=="ready")return new Response("Asset not found",{status:404});
  const bytes=await readAsset(id);return new Response(new Uint8Array(bytes!),{headers:{"Content-Type":asset.mime_type,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
}
