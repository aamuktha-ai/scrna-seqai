import { writeFile,mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fetchSource,SOURCES } from '../src/sources.js';

const destination=fileURLToPath(new URL('../reference-data/catalog.json',import.meta.url));
const results=await Promise.allSettled(Object.keys(SOURCES).map(source=>fetchSource(source)));
const errors=results.flatMap((result,i)=>result.status==='rejected'?[`${Object.keys(SOURCES)[i]}: ${result.reason.message}`]:[]);
if(errors.length) {
  console.error('Catalog refresh failed; existing snapshot preserved.\n'+errors.join('\n'));
  process.exitCode=1;
} else {
  const sources=results.map(result=>result.value);
  const snapshot={version:`public-metadata-${new Date().toISOString()}`,createdAt:new Date().toISOString(),sourceStatus:sources.map(({records,...status})=>({...status,count:records.length})),records:sources.flatMap(source=>source.records)};
  await mkdir(new URL('../reference-data/',import.meta.url),{recursive:true});
  await writeFile(`${destination}.tmp`,JSON.stringify(snapshot));
  const {rename}=await import('node:fs/promises');
  await rename(`${destination}.tmp`,destination);
  console.log(`Saved ${snapshot.records.length} public metadata records.`);
  for(const source of snapshot.sourceStatus) console.log(`${source.source}: ${source.count} — ${source.scope}`);
}
