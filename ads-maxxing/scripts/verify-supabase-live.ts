/** Explicit live integration test: creates two anonymous test users/campaigns, never calls paid providers. */
import assert from "node:assert/strict";
import { randomUUID,createHash } from "node:crypto";
import { createElement } from "react";
import { ImageResponse } from "next/og";
import { configuration,persistenceContext,ownerContext,rpc,supabase } from "../lib/supabase/server";
import {createSession,loadSession,lockSession,saveSession,listSessions} from "../lib/workflow/sessions";
import {readAsset,assetProviderUrl,saveComposedGeneration,readImage} from "../lib/workflow/storage";
import type {Research,Brief,Variant} from "../lib/workflow/session-types";
async function main(){
const config=configuration();
async function signup(){const response=await fetch(`${config.url}/auth/v1/signup`,{method:'POST',headers:{apikey:config.key,'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,200,'Enable anonymous Auth first');const data=await response.json();return {id:data.user.id as string,token:data.access_token as string};}
const first=await signup(),second=await signup();assert.notEqual(first.id,second.id);
const ids:{campaign?:string;source?:string;version?:string}={};
const png=Buffer.from(await new ImageResponse(createElement('div',{style:{width:'100%',height:'100%',background:'#ffcc44',display:'flex'}}),{width:576,height:1024}).arrayBuffer());
async function ready(id:string,kind:string,metadata:object={}){
 const c=ownerContext(),l=c.lease!;const path=`${c.userId}/${c.brandId}/${id}/image.png`;
 const data={id,kind,storage_path:path,storage_state:'pending',content_hash:createHash('sha256').update(png).digest('hex'),byte_size:png.length,mime_type:'image/png',width:576,height:1024,metadata};
 l.revision=(await rpc<{revision:number}>('register_asset',{p_owner:c.userId,p_id:l.campaignId,p_token:l.token,p_revision:l.revision,p_asset:data})).revision;
 await supabase(`/storage/v1/object/creative-assets/${path}`,{method:'POST',headers:{'Content-Type':'image/png'},body:new Uint8Array(png)});
 l.revision=(await rpc<{revision:number}>('register_asset',{p_owner:c.userId,p_id:l.campaignId,p_token:l.token,p_revision:l.revision,p_asset:{...data,storage_state:'ready'}})).revision;
 return path;
}
await persistenceContext.run({userId:first.id},async()=>{
 const session=await createSession();ids.campaign=session.id;const release=await lockSession(session.id);
 try{
  await persistenceContext.run({userId:first.id},async()=>assert.rejects(lockSession(session.id),/busy/));
  const research:Research={id:randomUUID(),sources:[{url:'https://www.loopycases.com',title:'Persistence integration fixture',description:'Synthetic fixture; no ad provider call',images:['https://example.com/fixture.png'],markdown:'Integration test',fetchedAt:new Date().toISOString(),colors:{}}],colors:[],voice:'Friendly',audience:'Fixture',sales:[],warnings:[]};
  session.research=research;await saveSession(session);
  const source=randomUUID();ids.source=source;const sourcePath=await ready(source,'product_photo');
  assert.deepEqual(await readAsset(source),png);
  const signed=await assetProviderUrl(source);assert.match(signed,/\/storage\/v1\/object\/sign\//);const signedResponse=await fetch(signed);assert.equal(signedResponse.status,200);assert.deepEqual(Buffer.from(await signedResponse.arrayBuffer()),png);
  const stranger=await fetch(`${config.url}/storage/v1/object/authenticated/creative-assets/${sourcePath}`,{headers:{apikey:config.key,Authorization:`Bearer ${second.token}`}});assert.ok(stranger.status>=400,'Other identity cannot read private bytes');
  const brief={id:randomUUID(),researchId:research.id,sourceAssetId:source,referenceImage:research.sources[0].images[0],productUrl:research.sources[0].url,headline:'Fixture creative',cta:'Shop now',direction:'Integration test',feedback:'',saleId:null,parentVariantId:null,approvedAt:new Date().toISOString()} as Brief;
  session.brief=brief;await saveSession(session);ids.version=brief.id;
  const generation={id:brief.id,imageUrl:`/api/outputs/${brief.id}`,model:'integration-fixture',prompt:'No provider call',referenceImage:brief.referenceImage,createdAt:new Date().toISOString()};
  await saveComposedGeneration(generation,png);
  const variant={...generation,brief:structuredClone(brief),research:structuredClone(research),status:'pending_review'} as Variant;
  session.variants.push(variant);await saveSession(session);assert.deepEqual(await readImage(variant.id),png);
  // Synthetic review tests persistence only; this is not a provider quality check.
  variant.review={verdict:'pass',checks:[{name:'durable_fixture_bytes',passed:png.equals((await readImage(variant.id))!),detail:'Stored synthetic image matches the uploaded fixture.'}],visual:{productFidelity:{status:'pass',reason:'Fixture'},textLegibility:{status:'pass',reason:'Fixture'},claimAccuracy:{status:'pass',reason:'Fixture'},brandFit:{status:'pass',reason:'Fixture'},summary:'Synthetic persistence fixture'},createdAt:new Date().toISOString()};variant.status='reviewed';await saveSession(session);
  variant.acceptance={acceptedAt:new Date().toISOString(),reviewedAt:variant.review.createdAt};variant.status='approved';await saveSession(session);
  delete session.brief;session.preferences={tone:'Changed'};session.research={...research,id:randomUUID()};await saveSession(session);
  const loaded=await loadSession(session.id);assert.equal(loaded.variants[0].status,'approved');assert.deepEqual(loaded.variants[0].acceptance,variant.acceptance);assert.equal(loaded.variants[0].research.id,research.id);assert.equal((await listSessions()).length,1);
 }finally{await release();}
});
await persistenceContext.run({userId:second.id},async()=>{
 assert.equal((await listSessions()).length,0);await assert.rejects(loadSession(ids.campaign!),/not found/);assert.equal(await readAsset(ids.source!),null);assert.equal(await readImage(ids.version!),null);
 const secondSession=await createSession();const release=await lockSession(secondSession.id);try{secondSession.research={id:randomUUID(),sources:[{url:'https://loopycases.com',title:'Second private fixture',description:'',images:[],markdown:'',fetchedAt:new Date().toISOString(),colors:{}}],colors:[],voice:'',audience:'',sales:[],warnings:[]};await saveSession(secondSession);}finally{await release();}
});
const clientHeaders={apikey:config.key,Authorization:`Bearer ${second.token}`,'Content-Type':'application/json'};
const read=await fetch(`${config.url}/rest/v1/campaigns?id=eq.${ids.campaign}&select=id`,{headers:clientHeaders});assert.deepEqual(await read.json(),[]);
const mutate=await fetch(`${config.url}/rest/v1/campaigns?id=eq.${ids.campaign}`,{method:'PATCH',headers:clientHeaders,body:'{"revision":999}'});assert.ok(mutate.status>=400);
const forbidden=await fetch(`${config.url}/rest/v1/rpc/claim_campaign`,{method:'POST',headers:clientHeaders,body:JSON.stringify({p_owner:first.id,p_id:ids.campaign})});assert.ok(forbidden.status>=400);
console.log(JSON.stringify({passed:true,checks:['two identities/same store isolated','guarded campaign claim','immutable research hydration','private asset upload/read','signed URL fetch','durable final/review/approval','historical approval after research/preference changes','cross-owner bytes and messages denied','client mutation and privileged RPC denied'],testCampaign:ids.campaign,paidProviderCalls:0}));

}
main().catch(error=>{console.error(error instanceof Error?error.message:"Check failed");process.exitCode=1;});
