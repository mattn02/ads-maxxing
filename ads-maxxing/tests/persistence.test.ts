import test from "node:test";
import assert from "node:assert/strict";
import { publicAddress, imageMetadata, normalizeLogoImage } from "../lib/workflow/asset-download";
import { normalizedHostname, sessionId, saveSession } from "../lib/workflow/sessions";
import { publicSession } from "../lib/workflow/public-session";
import { authenticated, persistenceContext } from "../lib/supabase/server";
import type { Session } from "../lib/workflow/session-types";

test("download boundary rejects internal, metadata, mapped and reserved destinations",()=>{
 for(const address of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.1.2','169.254.169.254','100.64.0.1','0.0.0.0','224.1.1.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1'])assert.equal(publicAddress(address),false,address);
 assert.equal(publicAddress('8.8.8.8'),true);assert.equal(publicAddress('2606:4700:4700::1111'),true);
});
test("image validation accepts real PNG dimensions and rejects HTML, bombs and invalid bytes",()=>{
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCfkAAAAASUVORK5CYII=','base64');
 assert.deepEqual(imageMetadata(png),{width:1,height:1,mime:'image/png',extension:'png'});
 assert.throws(()=>imageMetadata(Buffer.from('<html>login</html>')),/Unsupported/);
 png.writeUInt32BE(50000,16);assert.throws(()=>imageMetadata(png),/oversized/);
});
test("logo normalization converts bounded SVGs to PNG and rejects active SVG content",async()=>{
 const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100" viewBox="0 0 400 100"><rect width="400" height="100" fill="#123456"/></svg>');
 const png=await normalizeLogoImage(svg);const metadata=imageMetadata(png);
 assert.equal(metadata.mime,'image/png');assert.equal(metadata.width,1200);assert.equal(metadata.height,300);
 const raster=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCfkAAAAASUVORK5CYII=','base64');
 assert.equal(await normalizeLogoImage(raster),raster);
 await assert.rejects(normalizeLogoImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')),/unsupported external or executable/);
 await assert.rejects(normalizeLogoImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="50000" height="50000"></svg>')),/could not be converted/);
});
test("hostname ownership preserves store subdomains and strips only ordinary www",()=>{
 assert.equal(normalizedHostname('https://WWW.LoopyCases.com/products/test?variant=1'),'loopycases.com');
 assert.equal(normalizedHostname('https://shop.example.com'),'shop.example.com');
 assert.throws(()=>sessionId('../../secret'),/Invalid/);
});
test("persistence rejects absent identity/lease rather than falling back to local files",async()=>{
 await assert.rejects(saveSession({} as Session),/Authenticated/);
 await persistenceContext.run({userId:'11111111-1111-4111-8111-111111111111'},async()=>assert.rejects(saveSession({id:'22222222-2222-4222-8222-222222222222'} as Session),/lease/));
});
test("client projection removes provider recovery URLs without mutating durable state",()=>{
 const session={brief:{backgroundCheckpoint:{provider:{imageUrl:'https://fal.media/private.png'},state:'output_pending_storage'}}} as unknown as Session;
 assert.doesNotMatch(JSON.stringify(publicSession(session)),/fal.media/);assert.match(JSON.stringify(session),/fal.media/);
});
test("campaign saves reference historical research without repeating its HTML per variant", async t => {
 const vars=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'] as const;
 const old=vars.map(name=>process.env[name]);vars.forEach(name=>process.env[name]=name==='SUPABASE_URL'?'https://project.supabase.co':'test-key');
 const id='22222222-2222-4222-8222-222222222222';
 const research={id:'33333333-3333-4333-8333-333333333333',sources:[{url:'https://store.example/products/case',title:'Case',description:'Real case',images:[],markdown:'Saved facts',rawHtml:'x'.repeat(100_000),fetchedAt:'now',colors:{}}],colors:[],voice:'Friendly',audience:'Phone owners',sales:[],warnings:[]};
 const brief={id:'44444444-4444-4444-8444-444444444444',researchId:research.id};
 const session={id,messages:[],events:[],preferences:{},research,variants:[{id:brief.id,brief,research,status:'pending_review'}]} as unknown as Session;
 t.mock.method(globalThis,'fetch',async(_url:string|URL,init?:RequestInit)=>{
  const payload=JSON.parse(String(init?.body)).p_session;
  assert.deepEqual(payload.research,research);
  assert.equal(payload.variants[0].research,undefined);
  assert.equal(payload.variants[0].brief.researchId,research.id);
  assert.equal(JSON.stringify(payload).match(/x{100000}/g)?.length,1);
  return Response.json({revision:2,brand_id:'brand'});
 });
 try {
  await persistenceContext.run({userId:'11111111-1111-4111-8111-111111111111',lease:{campaignId:id,token:'lease',revision:1}},()=>saveSession(session));
  assert.equal(session.variants[0].research,research,'The in-memory historical snapshot is untouched');
 } finally {vars.forEach((name,i)=>{if(old[i]===undefined)delete process.env[name];else process.env[name]=old[i];});t.mock.restoreAll();}
});
test("auth verifies identity remotely and rejects cross-origin mutations",async t=>{
 const vars=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'] as const;
 const old=vars.map(name=>process.env[name]);vars.forEach(name=>process.env[name]=name==='SUPABASE_URL'?'https://project.supabase.co':'test-key');
 t.mock.method(globalThis,'fetch',async(url:string|URL)=>{assert.match(String(url),/auth\/v1\/user$/);return Response.json({id:'verified-user'});});
 try{
  const response=await authenticated(new Request('https://app.example/api/sessions',{headers:{cookie:'creative-access=untrusted-token'}}),async()=>Response.json({owner:persistenceContext.getStore()?.userId}));
  assert.equal((await response.json()).owner,'verified-user');
  const rejected=await authenticated(new Request('https://app.example/api/sessions',{method:'POST',headers:{origin:'https://evil.example'}}),async()=>{throw new Error('must not execute');});assert.equal(rejected.status,403);
 }finally{vars.forEach((name,i)=>{if(old[i]===undefined)delete process.env[name];else process.env[name]=old[i];});t.mock.restoreAll();}
});

test("loaded and successfully saved research uses references; changed same-ID data still reaches the immutable full guard", async t => {
 const vars=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'] as const;
 const old=vars.map(name=>process.env[name]);vars.forEach(name=>process.env[name]=name==='SUPABASE_URL'?'https://project.supabase.co':'test-key');
 const id='22222222-2222-4222-8222-222222222222', rid='33333333-3333-4333-8333-333333333333';
 const research={id:rid,sources:[{url:'https://shop.example/',title:'Shop',description:'Store',images:[],markdown:'Facts',fetchedAt:'now',colors:{}}],colors:[],voice:'Friendly',audience:'Owners',sales:[],warnings:[]};
 const bodies: Record<string,unknown>[]=[];
 t.mock.method(globalThis,'fetch',async(url:string|URL,init?:RequestInit)=>{
  const target=new URL(String(url));
  if(target.pathname.endsWith('/campaigns'))return Response.json([{id,purpose:'campaign',brand_id:'brand',current_research_id:rid,messages:[],preferences:{},events:[]}]);
  if(target.pathname.endsWith('/ad_versions'))return Response.json([]);
  if(target.pathname.endsWith('/research_snapshots'))return Response.json([{id:rid,schema_version:1,data:research}]);
  assert.ok(target.pathname.endsWith('/rpc/commit_campaign_v2'));
  const payload=JSON.parse(String(init?.body)).p_session; bodies.push(payload);
  if(payload.research?.id===rid&&payload.research.voice!==research.voice)return Response.json({message:'WORKFLOW:Research snapshots are immutable.'},{status:400});
  return Response.json({revision:bodies.length+1,brand_id:'brand'});
 });
 try {
  await persistenceContext.run({userId:'11111111-1111-4111-8111-111111111111',lease:{campaignId:id,token:'lease',revision:1}},async()=>{
   const {loadSession}=await import('../lib/workflow/sessions');
   const session=await loadSession(id);await saveSession(session);
   assert.deepEqual(bodies[0].researchReference,{id:rid,schemaVersion:1});assert.equal(bodies[0].research,undefined);
   session.research!.voice='Changed same ID';await assert.rejects(saveSession(session),/immutable/);
   assert.equal((bodies[1].research as typeof research).voice,'Changed same ID');assert.equal(bodies[1].researchReference,undefined);
   session.research!.id='44444444-4444-4444-8444-444444444444';await saveSession(session);await saveSession(session);
   assert.ok(bodies[2].research);assert.equal(bodies[2].researchReference,undefined);
   assert.deepEqual(bodies[3].researchReference,{id:session.research!.id,schemaVersion:1});assert.equal(bodies[3].research,undefined);
  });
 } finally {vars.forEach((name,i)=>{if(old[i]===undefined)delete process.env[name];else process.env[name]=old[i];});t.mock.restoreAll();}
});

test("missing v2 RPC fails with migration guidance and never falls back to the old write", async t=>{
 const vars=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'] as const;
 const old=vars.map(name=>process.env[name]);vars.forEach(name=>process.env[name]=name==='SUPABASE_URL'?'https://project.supabase.co':'test-key');
 let calls=0;t.mock.method(globalThis,'fetch',async(url:string|URL)=>{calls++;assert.match(String(url),/\/rpc\/commit_campaign_v2$/);return Response.json({code:'PGRST202',message:'Not found'},{status:404});});
 try {
  const id='22222222-2222-4222-8222-222222222222';
  await persistenceContext.run({userId:'11111111-1111-4111-8111-111111111111',lease:{campaignId:id,token:'lease',revision:1}},async()=>{
   await assert.rejects(saveSession({id,messages:[],events:[],preferences:{},variants:[]} as unknown as Session),/Apply Supabase migration 202609220006/);
  });assert.equal(calls,1);
 } finally {vars.forEach((name,i)=>{if(old[i]===undefined)delete process.env[name];else process.env[name]=old[i];});t.mock.restoreAll();}
});
