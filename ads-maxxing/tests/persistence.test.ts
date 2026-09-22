import test from "node:test";
import assert from "node:assert/strict";
import { publicAddress, imageMetadata } from "../lib/workflow/asset-download";
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
