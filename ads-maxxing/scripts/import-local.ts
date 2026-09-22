/** Explicit, idempotent import. Never edits source files or invokes research/image providers. */
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { persistenceContext, rows, rpc } from "../lib/supabase/server";
import { loadSession, lockSession, normalizedHostname, saveSession, sessionId } from "../lib/workflow/sessions";
import { imageMetadata } from "../lib/workflow/asset-download";
import { saveComposedGeneration } from "../lib/workflow/storage";
import { parseResearchSnapshot } from "../lib/workflow/research/persistence-schema";
import type { Research, Session, Variant } from "../lib/workflow/session-types";

async function main(){
const args=process.argv.slice(2);const value=(flag:string)=>args[args.indexOf(flag)+1];
const owner=args.includes('--owner')?sessionId(value('--owner')):null;
const directory=args.includes('--directory')?path.resolve(value('--directory')):null;
const apply=args.includes('--apply');
if(!owner||!directory)throw new Error('Usage: node --import tsx scripts/import-local.ts --owner UUID --directory /absolute/local-output [--apply]. Default is dry run. Load Supabase environment separately for --apply.');
const deterministicId=(text:string)=>{const h=createHash('sha256').update(text).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
const host=(r:Research)=>normalizedHostname(r.brandKit?.canonicalStoreUrl||r.sources[0].url);
let campaigns=0,images=0,failures=0;
for(const filename of (await readdir(path.join(directory,'sessions'))).filter(f=>f.endsWith('.json')).sort()) {
 const original:Session=JSON.parse(await readFile(path.join(directory,'sessions',filename),'utf8'));
 const groups=new Map<string,{research:Research;variants:Variant[]}>();
 for(const variant of original.variants){const key=host(variant.research);const group=groups.get(key)??{research:variant.research,variants:[]};group.variants.push(variant);groups.set(key,group);}
 if(original.research){const key=host(original.research);const group=groups.get(key)??{research:original.research,variants:[]};group.research=original.research;groups.set(key,group);}
 for(const [hostname,group] of groups){
  const campaignId=original.research&&host(original.research)===hostname?original.id:deterministicId(`${original.id}:${hostname}`);
  const snapshots=new Map(group.variants.map(v=>[v.research.id,v.research]));snapshots.set(group.research.id,group.research);
  let invalid=false;const outputs=new Map<string,Buffer>();
  for(const r of snapshots.values())try{parseResearchSnapshot(r,r.schemaVersion??1);}catch{console.error(`${filename}: invalid research ${r.id}`);invalid=true;}
  for(const variant of group.variants)try{const bytes=await readFile(path.join(directory,`${sessionId(variant.id)}.png`));const info=imageMetadata(bytes);if(info.mime!=="image/png"||info.width!==576||info.height!==1024)throw new Error("Legacy final must be a 576 × 1024 PNG");outputs.set(variant.id,bytes);}catch{console.error(`${filename}: missing final bytes ${variant.id}; campaign skipped`);invalid=true;}
  if(invalid){failures++;continue;}
  console.log(`${apply?'IMPORT':'DRY RUN'} ${campaignId}: ${hostname}, ${snapshots.size} snapshots, ${outputs.size} final images; legacy source provenance remains unavailable`);
  campaigns++;images+=outputs.size;
  if(!apply)continue;
  await persistenceContext.run({userId:owner},async()=>{
   const [existing]=await rows<{id:string}>('campaigns',`id=eq.${campaignId}&select=id`);
   if(!existing)await rpc('create_campaign',{p_owner:owner,p_id:campaignId});
   const release=await lockSession(campaignId);
   try{
    const saved=await loadSession(campaignId);
    if(saved.variants.length===group.variants.length&&saved.variants.every(v=>outputs.has(v.id))&&saved.research?.id===group.research.id){console.log(`Already imported ${campaignId}`);return;}
    if(saved.variants.length)throw new Error(`Conflicting partially populated campaign ${campaignId}; inspect before rerun.`);
    const session:Session={...saved,messages:original.messages,events:original.events,preferences:original.preferences,variants:[]};
    for(const r of snapshots.values()){session.research=r;await saveSession(session);}
    for(const variant of group.variants){
     const legacy=structuredClone(variant) as Variant & {brief:Variant['brief']&{legacyImported?:boolean}};
     legacy.brief.legacyImported=true;
     // No remote refetch can establish historical product identity; legacy images remain viewable only.
     delete legacy.visualAsset;delete legacy.visualAssetId;delete legacy.brief.visualCheckpoint;
     if(legacy.brief.parentVariantId&&!group.variants.some(v=>v.id===legacy.brief.parentVariantId)){console.warn(`Dropped cross-brand parent of ${legacy.id}`);legacy.brief.parentVariantId=null;}
     await saveComposedGeneration(legacy,outputs.get(legacy.id)!);session.variants.push(legacy);await saveSession(session);
    }
    session.research=group.research;
    // Ungenerated drafts lose approval; preserve ambiguous attempt markers so they cannot silently retry.
    if(original.brief&&original.brief.researchId===group.research.id&&!group.variants.some(v=>v.id===original.brief?.id)){
     session.brief=structuredClone(original.brief);delete session.brief.approvedAt;
    }
    await saveSession(session);
   }finally{await release();}
  }).catch(error=>{failures++;console.error(`${filename}: ${(error as Error).message}`);});
 }
}
console.log(JSON.stringify({mode:apply?'apply':'dry-run',campaigns,images,failures}));
if(failures)process.exitCode=1;

}
main().catch(error=>{console.error(error instanceof Error?error.message:"Check failed");process.exitCode=1;});
