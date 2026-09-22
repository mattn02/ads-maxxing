import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {ImageResponse} from 'next/og.js';
import React from 'react';
async function main(){
const url=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const r=await fetch(url+'/auth/v1/signup',{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:'{}'});const auth=await r.json();if(!auth.user)throw Error('Signup failed');
const dir=await fs.mkdtemp('/private/tmp/creative-import-fixture-');await fs.mkdir(path.join(dir,'sessions'));

const png=Buffer.from(await new ImageResponse(React.createElement('div',{style:{width:'100%',height:'100%',background:'#555',display:'flex'}}),{width:576,height:1024}).arrayBuffer());
const makeResearch=(host)=>({id:randomUUID(),sources:[{url:'https://'+host,title:'Legacy import fixture',description:'',images:['https://example.com/source.png'],markdown:'',fetchedAt:new Date().toISOString(),colors:{}}],colors:[],voice:'',audience:'',sales:[],warnings:[]});
const a=makeResearch('loopycases.com'),b=makeResearch('shop.example.com');const variants=[a,b].map(research=>{const id=randomUUID();return {id,imageUrl:'/api/outputs/'+id,model:'legacy-fixture',prompt:'Fixture only',referenceImage:'https://example.com/source.png',createdAt:new Date().toISOString(),brief:{id,researchId:research.id,productUrl:research.sources[0].url,referenceImage:'https://example.com/source.png',headline:'Legacy ad',cta:'Shop',direction:'Fixture',feedback:'',saleId:null,parentVariantId:null,approvedAt:new Date().toISOString()},research,status:'pending_review'};});
const session={id:randomUUID(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),messages:[],preferences:{},events:[],variants,research:a};
const file=path.join(dir,'sessions',session.id+'.json');const content=JSON.stringify(session);await fs.writeFile(file,content);for(const v of variants)await fs.writeFile(path.join(dir,v.id+'.png'),png);
for(const apply of [false,true,true]){const result=spawnSync(process.execPath,['--import','tsx','scripts/import-local.ts','--owner',auth.user.id,'--directory',dir,...(apply?['--apply']:[])],{cwd:process.cwd(),env:process.env,encoding:'utf8'});process.stdout.write(result.stdout);if(result.status!==0)throw Error(result.stderr);}
if(await fs.readFile(file,'utf8')!==content)throw Error('Importer changed source');console.log('PASS import dry run, mixed-brand split, real repeated import, source unchanged.');
}main().catch(e=>{console.error(e.message);process.exitCode=1;});
