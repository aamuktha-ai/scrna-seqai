import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.js';
import {reviewWithModel} from '../src/model.js';

test('server serves only public files and validates model consent and discovery inputs',async t=>{
  const server=createApp();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const base=`http://127.0.0.1:${server.address().port}`;
  for(const path of ['/.env','/server.js','/src/model.js','/package.json','/.git/config'])assert.equal((await fetch(base+path)).status,404);
  assert.equal((await fetch(base+'/')).status,200);
  assert.equal((await fetch(base+'/api/discover',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:'bad',tissue:'lung',species:'Homo sapiens'})})).status,400);
  assert.equal((await fetch(base+'/api/review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({consent:false})})).status,400);
  assert.equal((await fetch(base+'/api/review',{method:'POST',headers:{Origin:'https://other.example','Content-Type':'application/json'},body:'{}'})).status,403);
});
test('model adapter uses server credentials, disables stored responses, and returns only completed text',async()=>{
  const report={input:{question:'Compare'},ranked:[{id:'GSE1',source:'geo',title:'Test'}],possibleOverlaps:[],method:'heuristic'};let request;
  const result=await reviewWithModel(report,{apiKey:'test-key',model:'test-model',fetchImpl:async(url,options)=>{request=options;return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Insufficient evidence.'}]}]})};}});
  const payload=JSON.parse(request.body);assert.equal(payload.store,false);assert.equal(payload.model,'test-model');assert.equal(result.text,'Insufficient evidence.');assert.ok(!result.text.includes('test-key'));
  await assert.rejects(reviewWithModel(report,{apiKey:'',model:'test-model'}),/not configured/);
  await assert.rejects(reviewWithModel(report,{apiKey:'test',model:'test',fetchImpl:async()=>({ok:false,status:429})}),/429/);
});
test('live discovery passes an unfiltered species query for cross-species review and exposes source failures',async t=>{
  let query;
  const server=createApp({sourceFetcher:async(source,options)=>{query=options;if(source==='ebi')throw new Error('Repository unavailable');return {source,status:'ok',records:[],scope:'No matches'};}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const url=`http://127.0.0.1:${server.address().port}/api/discover`;
  const request=source=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source,species:'',tissue:'test organ'})});
  const response=await request('geo');assert.equal(response.status,200);assert.equal(query.species,'');assert.deepEqual((await response.json()).records,[]);
  const failure=await request('ebi');assert.equal(failure.status,503);assert.match((await failure.json()).error,/unavailable/);
});
