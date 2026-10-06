import test from 'node:test';
import assert from 'node:assert/strict';
import {analyze,assessCandidate,reportCsv} from '../src/analysis.js';
import {parseMetadata} from '../src/metadata.js';
import {normalizeEbi,normalizeGeo,normalizeCellxgene,normalizeHca,censusMembership,fetchSource} from '../src/sources.js';

const input={species:'Homo sapiens',tissue:'lung',library:"10x 3' v3",isolation:'Enzymatic dissociation',material:'cell',depth:30000,platform:'Illumina NovaSeq 6000',annotation:'Cell Ontology',covariates:['age','sex','donor id','batch'],disease:'normal',sources:['geo','cellxgene','hca','ebi']};
const candidate={...input,id:'TEST1',source:'geo',title:'Test study',url:'https://example.org/study',species:['Homo sapiens'],tissue:['lung'],library:["10x 3' v3"],isolation:['Enzymatic dissociation'],material:['cell'],platform:['Illumina NovaSeq 6000'],annotation:['Cell Ontology'],disease:['normal'],rawCounts:true,publications:[],notes:[]};

test('fully documented compatible metadata is only a conditional integration candidate',()=>{
  const result=assessCandidate(input,candidate);assert.equal(result.score,100);assert.equal(result.pathway,'Direct integration candidate');assert.ok(result.flags.some(flag=>flag.includes('Donor overlap')));
});
test('unknown evidence earns zero and cannot trigger integration',()=>{
  const result=assessCandidate(input,{id:'empty',source:'geo',title:'Unknown',url:'https://example.org'});assert.equal(result.score,0);assert.equal(result.completeness,0);assert.equal(result.pathway,'Needs metadata review');assert.ok(result.dimensions.every(d=>d.status==='unknown'));
});
test('unknown raw count representation blocks direct integration despite otherwise perfect labels',()=>{
  assert.notEqual(assessCandidate(input,{...candidate,rawCounts:null}).pathway,'Direct integration candidate');
});
test('human and mouse cannot be recommended for direct integration or ordinary reference mapping',()=>{
  const mouse={...candidate,species:['Mus musculus']};assert.equal(assessCandidate(input,mouse).pathway,'Cross-species analysis only');assert.equal(analyze(input,[mouse]).candidateCount,0);assert.equal(analyze({...input,includeCrossSpecies:true},[mouse]).candidateCount,1);
});
test('cells and nuclei mismatch is recorded; mixed protocols are only partial',()=>{
  const r=assessCandidate(input,{...candidate,material:['nucleus'],library:["10x 3' v3",'Smart-seq2']});assert.equal(r.dimensions.find(d=>d.key==='material').status,'mismatch');assert.equal(r.dimensions.find(d=>d.key==='library').status,'partial');assert.notEqual(r.pathway,'Direct integration candidate');
});
test('inferred tissue is never treated as confirmed tissue',()=>{
  const r=assessCandidate(input,{...candidate,inferredFields:['tissue']});assert.equal(r.dimensions.find(d=>d.key==='tissue').status,'review');assert.equal(r.pathway,'Needs metadata review');assert.equal(r.score,85);
});
test('missing requested covariates reduce compatibility and identify the gap',()=>{
  const r=assessCandidate(input,{...candidate,covariates:['sex']});const d=r.dimensions.find(d=>d.key==='covariates');assert.equal(d.status,'partial');assert.match(d.note,/donor id/);assert.notEqual(r.pathway,'Direct integration candidate');
});
test('shared accession flags mirrored records; records remain visible for source-specific evidence',()=>{
  const report=analyze(input,[candidate,{...candidate,source:'ebi',id:'E-GEOD-1',aliases:['TEST1']}]);assert.equal(report.candidateCount,2);assert.equal(report.possibleOverlaps.length,1);assert.equal(report.possibleOverlaps[0].members.length,2);
});
test('source selection, keyword filtering, and zero results work',()=>{
  assert.equal(analyze({...input,sources:['hca']},[candidate]).candidateCount,0);assert.equal(analyze({...input,keyword:'pancreas'},[candidate]).candidateCount,0);assert.equal(analyze({...input,keyword:'test study'},[candidate]).candidateCount,1);assert.throws(()=>analyze({...input,sources:[]},[candidate]),/Select/);
});
test('read depth rejects UMIs represented as missing and accepts only numeric positive reads',()=>{
  assert.equal(assessCandidate(input,{...candidate,depth:null}).dimensions.find(d=>d.key==='depth').status,'unknown');assert.throws(()=>analyze({...input,depth:-4},[]),/positive/);
});
test('CSV exports protect spreadsheet formulas and quote embedded delimiters',()=>{
  const report=analyze(input,[{...candidate,title:'=HYPERLINK("bad"), title'}]);const csv=reportCsv(report);assert.ok(csv.includes("'="));assert.ok(csv.includes('""bad""'));
});
test('metadata parser accepts quoted field/value files and rejects cell-level tables',()=>{
  assert.deepEqual(parseMetadata('field,value\nspecies,human\ncovariates,"age, sex"','study.csv'),{species:'human',covariates:'age, sex'});assert.deepEqual(parseMetadata('tissue: lung\nreads per cell: 30000','study.txt'),{tissue:'lung',depth:'30000'});assert.throws(()=>parseMetadata('cell,gene,count\na,b,1','cells.csv'),/two columns/);assert.throws(()=>parseMetadata('[{"cell":"a"}]'),/single study/);
});
test('GEO samples are not cells; EBI tissue inference and GEO aliases are explicit',()=>{
  const geo=normalizeGeo({accession:'GSE1',title:'Human lung RNA',summary:'Study',taxon:'Homo sapiens',n_samples:3});assert.equal(geo.cells,null);assert.equal(geo.sampleCount,3);assert.deepEqual(geo.inferredFields,['tissue']);const ebi=normalizeEbi({experimentAccession:'E-GEOD-1',experimentDescription:'Human lung cells',species:'Homo sapiens',experimentalFactors:[]});assert.deepEqual(ebi.aliases,['GSE1']);assert.deepEqual(ebi.inferredFields,['tissue']);
});
test('CELLxGENE normalization does not turn mean genes into read depth or stages into age',()=>{
  const r=normalizeCellxgene({dataset_id:'x',collection_id:'y',title:'Test',mean_genes_per_cell:2000,development_stage:[{label:'adult stage'}]},'2025-11-08');assert.equal(r.depth,null);assert.ok(!r.covariates.includes('age'));assert.equal(r.censusRelease,'2025-11-08');
});
test('Census membership follows pages and matches IDs without downloading expression files',async()=>{
  const urls=[];const fetchImpl=async url=>{urls.push(String(url));return {ok:true,json:async()=>({stable:'2025-11-08'}),text:async()=>urls.length===2?'<Key>h5ads/aaaa-bbbb.h5ad</Key><IsTruncated>true</IsTruncated><NextContinuationToken>x&amp;y</NextContinuationToken>':'<Key>h5ads/cccc-dddd.h5ad</Key><IsTruncated>false</IsTruncated>'};};
  const result=await censusMembership(fetchImpl);assert.equal(result.ids.size,2);assert.ok(urls[2].includes('continuation-token=x%26y'));assert.ok(urls.every(u=>!u.endsWith('.h5ad')));
});
test('failed source response is an error, not an empty successful search',async()=>{
  await assert.rejects(fetchSource('ebi',{fetchImpl:async()=>({ok:false,status:503})}),/503/);
});
test('HCA missing age entries stay missing and do not break the catalog',()=>{
  const record=normalizeHca({entryId:'project',projects:[{projectTitle:'Test'}],donorOrganisms:[{genusSpecies:['Homo sapiens'],organismAge:[null,{value:null}],biologicalSex:['unknown']}],samples:[],protocols:[]});
  assert.deepEqual(record.covariates,[]);assert.deepEqual(record.species,['Homo sapiens']);
});
test('discovery cross-checks public metadata without uploads or investigator protocols',()=>{
  const criteria={mode:'discovery',species:'Homo sapiens',tissue:'lung',sources:['geo']};
  const result=analyze(criteria,[candidate]).ranked[0];
  assert.equal(result.score,100);
  assert.equal(result.dimensions.find(d=>d.key==='library').status,'not-requested');
  assert.notEqual(result.pathway,'Direct integration candidate');
  const missing=analyze(criteria,[{...candidate,tissue:[]}]).ranked[0];
  assert.equal(missing.score,50);
});
