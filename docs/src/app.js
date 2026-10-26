import {SOURCES,speciesName} from './sources.js';
import {analyze,reportCsv,validateInput} from './analysis.js';

const $=id=>document.getElementById(id);
const apiBase=document.querySelector('meta[name="scrna-api-base"]')?.content || '';

const fields=['question','species','tissue','library','material','disease','cellTypes','isolation','depth','platform','annotation','covariates','notes','publicationText','keyword'];
let catalog=null,report=null,visibleCount=15,modelConfigured=false,busy=false,modelBusy=false;
function node(tag,text,className) {const element=document.createElement(tag);if(text!==undefined)element.textContent=text;if(className)element.className=className;return element;}
function safeLink(text,url) {const link=node('a',text);try{const parsed=new URL(url);if(parsed.protocol==='https:'){link.href=parsed.href;link.target='_blank';link.rel='noopener noreferrer';}}catch{}return link;}
function error(message='') {$('error').textContent=message;$('error').hidden=!message;}
function selectedSources() {return [...document.querySelectorAll('input[name="source"]:checked')].map(input=>input.value);}
function inputValues() {
  const input=Object.fromEntries(fields.map(key=>[key,$(key).value.trim()]));
  for(const key of ['covariates','cellTypes']) input[key]=input[key].split(',').map(v=>v.trim()).filter(Boolean);
  input.depth=input.depth?Number(input.depth):null;
  input.mode='discovery';
  input.sources=selectedSources();input.includeCrossSpecies=$('includeCrossSpecies').checked;
  return input;
}
function populate(input) {
  for(const key of fields) {const value=input[key];$(key).value=key==='species' && value?speciesName(value):Array.isArray(value)?value.join(', '):value??'';}
  markStale();
}
function markStale() {if(report)$('stale').hidden=false;}
function setBusy(value) {
  busy=value;
  for(const input of $('analysisForm').querySelectorAll('input,textarea,select,button'))input.disabled=value;
  $('sampleButton').disabled=value;
  $('analyzeButton').disabled=value || !catalog;
  $('modelButton').disabled=value || modelBusy || !modelConfigured || !$('modelConsent').checked || !report?.ranked.length;
}
function renderSourceStatus(statuses) {
  $('sourceStatus').replaceChildren(...statuses.map(status=>{
    const section=node('div',undefined,'source-status-item');section.append(node('strong',SOURCES[status.source].name),node('div',`${status.count ?? status.records?.length ?? 0} records · ${status.status==='fallback'?'Snapshot fallback':status.status==='ok'?'Available':'Unavailable'}`),node('div',status.scope || status.error || ''),node('div',`Retrieved: ${status.retrievedAt || 'Not available'}`));
    if(status.error)section.append(node('div',`Live source error: ${status.error}`));return section;
  }));
}
for(const [id,source] of Object.entries(SOURCES)) {
  const label=node('label',undefined,'source-option'),checkbox=node('input');checkbox.type='checkbox';checkbox.name='source';checkbox.value=id;checkbox.checked=true;checkbox.defaultChecked=true;
  const caption=node('span',source.name);caption.append(node('small',source.description));label.append(checkbox,caption);$('sourceOptions').append(label);
}
async function initialize() {
  const outcomes=await Promise.allSettled([fetch('reference-data/catalog.json').then(async response=>{if(!response.ok)throw new Error('The public metadata catalog could not be loaded. Run npm run refresh:catalog and reload.');return response.json();}),fetch(apiBase+'/api/status').then(response=>response.ok?response.json():{modelConfigured:false})]);
  const [snapshot,status]=outcomes;
  if(snapshot.status==='fulfilled' && Array.isArray(snapshot.value.records)) {
    catalog=snapshot.value;$('catalogStatus').textContent=`${catalog.records.length.toLocaleString()} public metadata records · snapshot ${new Date(catalog.createdAt).toLocaleDateString()}`;renderSourceStatus(catalog.sourceStatus);$('analyzeButton').disabled=false;
  } else {error(snapshot.reason?.message || 'The catalog has an invalid format.');$('catalogStatus').textContent='Catalog unavailable.';}
  modelConfigured=status.status==='fulfilled' && status.value.modelConfigured;
  $('modelStatus').textContent=modelConfigured?`Configured model: ${status.value.model}. Review is optional and requires the consent checkbox below.`:'LLM review is not enabled. Search, metadata cross-checking, and exports are available without it.';
}

$('sampleButton').addEventListener('click',async()=>{
  try{const response=await fetch('examples/investigator.json');if(!response.ok)throw new Error('Example unavailable.');populate(await response.json());$('fileStatus').textContent='Example search loaded. Adjust the criteria to your research question.';error();}catch(e){error(e.message);}
});
$('analysisForm').addEventListener('input',markStale);
$('clearButton').addEventListener('click',()=>{
  $('analysisForm').reset();$('fileStatus').textContent='';$('progress').textContent='';error();report=null;$('report').hidden=true;$('emptyState').hidden=false;$('csvButton').disabled=true;$('jsonButton').disabled=true;$('stale').hidden=true;$('modelConsent').checked=false;$('modelReview').textContent='';renderSourceStatus(catalog.sourceStatus);
});

async function discover(input) {
  let finished=0;
  const settled=await Promise.allSettled(input.sources.map(async source=>{
    try {
      const response=await fetch(apiBase+'/api/discover',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source,species:input.includeCrossSpecies?'':input.species,tissue:input.tissue})});
      const data=await response.json();if(!response.ok)throw new Error(data.error || 'Repository request failed.');return data;
    } finally {finished++;$('progress').textContent=`Repository discovery: ${finished} of ${input.sources.length} sources checked…`;}
  }));
  const statuses=[],records=[];
  settled.forEach((result,index)=>{
    const source=input.sources[index];
    if(result.status==='fulfilled'){const {records:rows,...status}=result.value;records.push(...rows);statuses.push({...status,count:rows.length});}
    else {const fallback=catalog.records.filter(r=>r.source===source);records.push(...fallback);statuses.push({...catalog.sourceStatus.find(s=>s.source===source),source,status:'fallback',error:result.reason.message,count:fallback.length});}
  });
  return {records,sourceStatus:statuses,catalogVersion:`live-discovery-${new Date().toISOString()}; fallback snapshot ${catalog.version}`};
}
$('analysisForm').addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;error();
  try {
    const input=inputValues();validateInput(input);setBusy(true);$('progress').textContent='Cross-checking public dataset metadata…';
    const selection=$('catalogMode').value==='live'?await discover(input):{records:catalog.records,sourceStatus:catalog.sourceStatus.filter(s=>input.sources.includes(s.source)),catalogVersion:catalog.version};
    report=analyze(input,selection.records,selection);visibleCount=15;renderSourceStatus(selection.sourceStatus);renderReport();const panel=$('reportTitle').closest('.report-panel');panel.scrollTop=0;panel.scrollIntoView({block:'start'});$('progress').textContent=`Assessment complete: ${report.candidateCount.toLocaleString()} candidate records ranked.`;
  } catch(e) {error(e.message);$('progress').textContent='Assessment could not be completed.';} finally {setBusy(false);}
});

function renderReport() {
  $('emptyState').hidden=true;$('report').hidden=false;$('stale').hidden=true;$('csvButton').disabled=false;$('jsonButton').disabled=false;$('modelConsent').checked=false;$('modelReview').textContent='';
  const metrics=node('div',undefined,'metrics');
  for(const [value,label] of [[report.candidateCount.toLocaleString(),'candidate records'],[report.input.sources.length,'repositories selected'],[report.ranked[0]?.score ?? '—','top criteria fit / 100']]) {const tile=node('div',undefined,'metric');tile.append(node('strong',String(value)),node('span',label));metrics.append(tile);}
  $('summary').replaceChildren(metrics,node('p',`Search: ${report.input.species} · ${report.input.tissue}. Ranked by structured metadata; condition filter: ${report.input.disease || 'none'}; keyword filter: ${report.input.keyword || 'none'}. Screening scores require scientific review.`,'report-note'));
  const failures=report.sourceStatus.filter(s=>s.status==='fallback');if(failures.length)$('summary').append(node('p',`Live discovery failed for ${failures.map(s=>SOURCES[s.source].name).join(', ')}. These sources use the dated bundled snapshot; see provenance for errors and scope.`,'notice'));
  $('methodText').textContent=report.method;$('limitations').replaceChildren(...report.limitations.map(text=>node('li',text)));
  $('overlapNotice').replaceChildren();
  if(report.possibleOverlaps.length)$('overlapNotice').append(node('p',`${report.possibleOverlaps.length} shared accession/publication groups detected. Candidate rows may reuse the same donors or cells. Review the overlap groups in the JSON export before pooling.`,'notice'));
  renderResults();
}
function candidateCard(candidate,index) {
  const card=node('article',undefined,'candidate'),head=node('div',undefined,'candidate-head'),top=node('div',undefined,'candidate-topline');
  top.append(node('span',`#${index+1} · ${SOURCES[candidate.source].name}`,'rank'),node('span',candidate.id,'tag'));
  const heading=node('h3');heading.append(safeLink(candidate.title,candidate.url));
  const meta=node('p',[candidate.species.join(', '),candidate.tissue.join(', ')||'Tissue unconfirmed',candidate.library.join(', ')||'Protocol not reported'].join(' · '),'candidate-meta');
  const pathway=node('span',candidate.pathway,`pathway ${/review|Cross-species|Different tissue/.test(candidate.pathway)?'review':''}`);
  const scores=node('div',undefined,'score-line');
  for(const [value,label,suffix] of [[candidate.score,'criteria fit','/100'],[candidate.completeness,'metadata reported','%'],[candidate.comparableEvidence,'comparable evidence','%']]) {const item=node('span');item.append(node('strong',`${value}${suffix} `),document.createTextNode(label));scores.append(item);}
  head.append(top,heading,meta,pathway,scores);
  if(candidate.conditionMatch)head.append(node('p',candidate.conditionMatch==='structured'
    ? `Condition matches reported metadata: ${candidate.disease.join(', ')}. Verify the relevant sample subset.`
    : 'Condition terms occur in the title or summary only. This is a text match, not confirmation of sample condition; review the source.', 'report-note'));
  card.append(head);
  const details=node('details'),summary=node('summary','Review evidence, gaps & next steps');details.append(summary);
  let rendered=false;
  details.addEventListener('toggle',()=>{if(details.open&&!rendered){details.append(evidence(candidate));rendered=true;}});
  card.append(details);return card;
}
function evidence(candidate) {
  const content=node('div',undefined,'evidence-content');
  if(candidate.summary)content.append(node('p',candidate.summary));
  const wrap=node('div',undefined,'table-wrap'),table=node('table'),thead=node('thead'),tr=node('tr');
  for(const text of ['Dimension','Your criteria','Public metadata','Assessment'])tr.append(node('th',text));thead.append(tr);table.append(thead);
  const tbody=node('tbody');
  for(const dimension of candidate.dimensions) {const row=node('tr');row.append(node('td',dimension.label),node('td',dimension.investigator),node('td',dimension.candidate));const assessment=node('td');assessment.append(node('span',dimension.status,`status ${dimension.status}`),node('div',dimension.note));row.append(assessment);tbody.append(row);}
  table.append(tbody);wrap.append(table);content.append(wrap,node('p',candidate.cellTypeNote));
  if(candidate.cells)content.append(node('p',`${candidate.cells.toLocaleString()} reported cells in the source record (not a verified count for a selected subset).`));
  if(candidate.sampleCount)content.append(node('p',`${candidate.sampleCount} GEO samples reported; this is not a cell or independent donor count.`));
  for(const [title,items] of [['Evidence gaps & cautions',candidate.flags],['Suggested next steps',candidate.actions]]) {const ul=node('ul');ul.append(...items.map(text=>node('li',text)));content.append(node('h4',title),ul);}
  content.append(node('h4','Source evidence'),safeLink('Open repository record ↗',candidate.url));
  if(candidate.censusRelease){const p=node('p',`Census release ${candidate.censusRelease}. `);p.append(safeLink('Release-specific H5AD file (large download)',candidate.censusUrl));content.append(p);}
  if(candidate.publications?.length){content.append(node('h4','Linked publications — not automatically reviewed'));const ul=node('ul');for(const url of candidate.publications){const li=node('li');li.append(safeLink(url,url));ul.append(li);}content.append(ul);}
  return content;
}
function renderResults() {
  $('results').replaceChildren(...report.ranked.slice(0,visibleCount).map(candidateCard));
  if(!report.ranked.length)$('results').append(node('p','No candidate records matched these filters. Broaden the condition or keyword filters, or try live discovery. A limited catalog search does not establish that no suitable data exist.','notice'));
  $('moreButton').hidden=visibleCount>=report.ranked.length;
  $('moreButton').textContent=`Show more (${Math.min(visibleCount,report.ranked.length)} of ${report.ranked.length})`;
}
$('moreButton').addEventListener('click',()=>{visibleCount+=15;renderResults();});
function download(text,name,type) {const url=URL.createObjectURL(new Blob([text],{type}));const link=node('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('csvButton').addEventListener('click',()=>download(reportCsv(report),'scrna-seqai-feasibility.csv','text/csv;charset=utf-8'));
$('jsonButton').addEventListener('click',()=>download(JSON.stringify(report,null,2),'scrna-seqai-report.json','application/json'));
$('modelConsent').addEventListener('change',()=>{$('modelButton').disabled=busy || modelBusy || !modelConfigured || !$('modelConsent').checked || !report?.ranked.length;});
$('modelButton').addEventListener('click',async()=>{
  if(!report || modelBusy)return;
  const targetReport=report;
  modelBusy=true;$('modelButton').disabled=true;$('modelReview').textContent='Reviewing supplied metadata and excerpts…';
  try {
    const response=await fetch(apiBase+'/api/review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({consent:$('modelConsent').checked,report:{...targetReport,ranked:targetReport.ranked.slice(0,10)}})});
    const data=await response.json();if(!response.ok)throw new Error(data.error || 'Model review failed.');targetReport.llm=data;
    if(report===targetReport)$('modelReview').textContent=data.text;
  } catch(e) {targetReport.llm={status:'failed',error:e.message};if(report===targetReport)$('modelReview').textContent=`${e.message} Your metadata assessment and exports remain available.`;}
  finally {modelBusy=false;$('modelButton').disabled=busy || !modelConfigured || !$('modelConsent').checked || !report?.ranked.length;}
});
initialize();
