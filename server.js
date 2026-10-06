import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {pathToFileURL} from 'node:url';
import {fetchSource,SOURCES} from './src/sources.js';
import {reviewWithModel} from './src/model.js';
import {validateInput} from './src/analysis.js';

const root=new URL('./',import.meta.url);
const publicFiles=new Map([
  ['/', ['index.html','text/html']],['/index.html',['index.html','text/html']],
  ...['app','analysis','sources','metadata'].map(name=>[`/src/${name}.js`,[`src/${name}.js`,'text/javascript']]),
  ['/src/styles.css',['src/styles.css','text/css']],['/reference-data/catalog.json',['reference-data/catalog.json','application/json']],
  ['/examples/investigator.json',['examples/investigator.json','application/json']]
]);
const cache=new Map();
const pending=new Map();
function json(res,status,body) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));}
async function body(req) {
  let bytes=0;const chunks=[];
  for await(const chunk of req) {bytes+=chunk.length;if(bytes>2*1024*1024) throw Object.assign(new Error('Metadata request exceeds 2 MB.'),{status:413});chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(new Error('Request must contain valid JSON.'),{status:400});}
}
export function createApp({sourceFetcher=fetchSource,modelReviewer=reviewWithModel}={}) {
  return createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,'http://localhost');
      if(req.method==='GET' && url.pathname==='/api/status') return json(res,200,{modelConfigured:Boolean(process.env.OPENAI_API_KEY && process.env.SCRNA_MODEL),model:process.env.SCRNA_MODEL || null});
      if(req.method==='POST' && url.pathname.startsWith('/api/')) {
        if(req.headers.origin && new URL(req.headers.origin).host!==req.headers.host) return json(res,403,{error:'Cross-origin requests are not allowed.'});
        const input=await body(req);
        if(url.pathname==='/api/discover') {
          if(!SOURCES[input.source] || typeof input.tissue!=='string' || input.tissue.length>120 || !['','Homo sapiens','Mus musculus'].includes(input.species)) return json(res,400,{error:'A valid source, species, and tissue query are required.'});
          const key=input.source==='geo'?JSON.stringify([input.source,input.tissue,input.species]):input.source;
          const existing=cache.get(key);
          if(existing && Date.now()-existing.time<3600000) return json(res,200,{...existing.result,cached:true});
          if(!pending.has(key)) pending.set(key,sourceFetcher(input.source,{tissue:input.tissue,species:input.species}).then(result=>{cache.set(key,{time:Date.now(),result});if(cache.size>100) cache.delete(cache.keys().next().value);return result;}).finally(()=>pending.delete(key)));
          return json(res,200,await pending.get(key));
        }
        if(url.pathname==='/api/review') {
          if(input.consent!==true) return json(res,400,{error:'Explicit consent to send metadata to the configured model is required.'});
          if(!input.report || !Array.isArray(input.report.ranked) || !input.report.ranked.length || input.report.ranked.length>10) return json(res,400,{error:'Supply a report with 1–10 candidates.'});
          try{validateInput(input.report.input);}catch(error){return json(res,400,{error:error.message});}
          return json(res,200,await modelReviewer(input.report));
        }
      }
      if(req.method!=='GET' && req.method!=='HEAD') return json(res,405,{error:'Method not allowed.'});
      const target=publicFiles.get(url.pathname);
      if(!target) return json(res,404,{error:'Not found.'});
      const data=await readFile(new URL(target[0],root));
      res.writeHead(200,{'Content-Type':`${target[1]}; charset=utf-8`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});
      res.end(req.method==='HEAD'?undefined:data);
    } catch(error) {json(res,error.status || 503,{error:error.message || 'Request failed.'});}
  });
}
if(process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url) {
  const port=Number(process.env.PORT || 5181),host=process.env.HOST || '127.0.0.1';
  createApp().listen(port,host,()=>console.log(`scRNA-SeqAI running at http://${host}:${port} (${fileURLToPath(root)})`));
}
