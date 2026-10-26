import { SOURCES, list, speciesName } from './sources.js';

export const VERSION='scrna-feasibility-0.1.0';
export const DIMENSIONS=[
  ['species','Species',20],['tissue','Tissue of origin',20],['library','Library preparation',12],
  ['isolation','Cell isolation',10],['material','Cells / nuclei',8],['depth','Reads per cell',7],
  ['platform','Sequencing platform',5],['annotation','Annotation schema',6],['covariates','Required covariates',7],['disease','Disease / condition',5]
];
const aliases={'homo sapiens':'human','mus musculus':'mouse','single cell':'cell','cells':'cell','single nucleus':'nucleus','nuclei':'nucleus','healthy':'normal','healthy control':'normal','control':'normal','smart seq2':'smart-seq2','smartseq2':'smart-seq2','10xv2':"10x 3' v2",'10xv3':"10x 3' v3",'10xv1':"10x 3' v1",'10x5prime':"10x 5'",'donor':'donor id','donor_id':'donor id','donor identifier':'donor id','developmental stage':'development stage','cell ontology':'cell ontology'};
export function normalize(value) {
  const clean=String(value ?? '').trim().toLowerCase().replace(/[′’]/g,"'").replace(/\s+/g,' ');
  return aliases[clean] || clean;
}
const values=value=>list(value).map(normalize).filter(v=>v && !['unknown','not reported','na','n/a'].includes(v));
const display=value=>Array.isArray(value)?value.join('; ') || 'Not reported':value===null || value===undefined || value===''?'Not reported':String(value);

export function validateInput(input) {
  if(!input || typeof input!=='object' || Array.isArray(input)) throw new Error('Provide investigator metadata.');
  if(!['Homo sapiens','Mus musculus'].includes(speciesName(input.species))) throw new Error('Choose human or mouse.');
  if(typeof input.tissue!=='string' || !input.tissue.trim()) throw new Error('Tissue of origin is required.');
  if(input.tissue.length>120) throw new Error('Tissue must be 120 characters or fewer.');
  if(!Array.isArray(input.sources) || !input.sources.length || input.sources.some(s=>!SOURCES[s])) throw new Error('Select at least one supported repository.');
  if(input.keyword!==undefined && (typeof input.keyword!=='string' || input.keyword.length>200)) throw new Error('Keyword filter must be text under 200 characters.');
  if(input.depth!==null && input.depth!==undefined && input.depth!=='' && (!Number.isFinite(Number(input.depth)) || Number(input.depth)<=0)) throw new Error('Reads per cell must be a positive number, or left blank.');
  for(const key of ['question','notes','publicationText']) if(input[key] && (typeof input[key]!=='string' || input[key].length>30000)) throw new Error(`${key} must be text under 30,000 characters.`);
  for(const [key] of DIMENSIONS) {
    if(key==='depth') continue;
    if(input[key]!==undefined && typeof input[key]!=='string' && !(Array.isArray(input[key]) && input[key].every(v=>typeof v==='string'))) throw new Error(`${key} must be text or a list of text values.`);
  }
  return input;
}

// Search text is normalized independently of scientific metadata labels.
function searchText(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
}
function containsTerms(text, query) {
  const terms=searchText(query).split(/\s+/).filter(Boolean);
  const tokens=new Set(searchText(text).split(/\s+/));
  return terms.length>0 && terms.every(term=>tokens.has(term));
}
function conditionMatch(query, record) {
  const requested=values(query);
  if(!requested.length) return null;
  if(requested.some(term=>values(record.disease).some(label=>containsTerms(label,term)))) return 'structured';
  const description=[record.title,record.summary].join(' ');
  const mentions=requested.flatMap(term=>term==='normal'?['normal','healthy','healthy control']: [term]);
  return mentions.some(term=>containsTerms(description,term)) ? 'text' : null;
}

function compare(key, investigator, candidate) {
  const local=values(investigator[key]), remote=values(candidate[key]);
  if(investigator.mode==='discovery' && !local.length) return {status:'not-requested',credit:0,note:'No preference specified. Public metadata is shown for cross-checking.'};
  if(!local.length || !remote.length) return {status:'unknown',credit:0,note:!local.length?'Investigator metadata not supplied.':'Not reported in the retrieved repository metadata.'};
  if(key==='depth') {
    const a=Number(investigator.depth), b=Number(candidate.depth);
    if(!Number.isFinite(a)||!Number.isFinite(b)||a<=0||b<=0) return {status:'unknown',credit:0,note:'Comparable reads-per-cell values are unavailable; detected genes or UMIs are not read depth.'};
    const ratio=Math.min(a,b)/Math.max(a,b);
    return {status:ratio>=0.8?'match':'partial',credit:ratio>=0.8?1:0.5,note:ratio>=0.8?'Reported read depths within 20%; review per-cell distributions and saturation.':'Depth differs by more than 20%; assess detection sensitivity and downsampling.'};
  }
  const overlap=local.filter(v=>remote.includes(v));
  if(candidate.inferredFields?.includes(key)) return {status:'review',credit:overlap.length?0.25:0,note:'Extracted from free text, not confirmed structured metadata. Verify the source.'};
  if(key==='covariates') {
    const missing=local.filter(v=>!remote.includes(v));
    return {status:missing.length?(overlap.length?'partial':'mismatch'):'match',credit:overlap.length/local.length,note:missing.length?`Required covariates not reported: ${missing.join(', ')}.`:'Requested covariate fields are reported. Check missingness, definitions, coding, and donor-level availability.'};
  }
  if(overlap.length) {
    const exact=local.length===remote.length && overlap.length===local.length;
    return {status:exact?'match':'partial',credit:exact?1:0.5,note:exact?'Reported labels agree; this does not establish biological or technical equivalence.':'Only part of the metadata overlaps. Select a matching sample subset before reuse.'};
  }
  return {status:'mismatch',credit:0,note:({species:'Different species. Direct pooling or ordinary reference mapping is not supported; a separate orthology-aware analysis is required.',tissue:'Tissue labels differ. Review anatomical subregions and ontology mappings.',library:'Library protocols differ. Review chemistry, gene coverage, and capture biases.',material:'Cells and nuclei have different capture profiles. Validate shared features and cell-type recovery.',isolation:'Isolation protocols differ; evaluate enrichment and dissociation bias.',annotation:'Annotation schemes differ; map labels to a common ontology.'})[key] || 'Reported values differ; harmonization or study-specific analysis is needed.'};
}

export function assessCandidate(input,candidate) {
  const dimensions=DIMENSIONS.map(([key,label,weight])=>({key,label,weight,investigator:display(input[key]),candidate:display(candidate[key]),...compare(key,input,candidate),evidenceUrl:candidate.url}));
  const byKey=Object.fromEntries(dimensions.map(d=>[d.key,d]));
  const requestedWeight=dimensions.reduce((sum,d)=>sum+(d.status==='not-requested'?0:d.weight),0);
  const score=Math.round(100*dimensions.reduce((sum,d)=>sum+d.credit*d.weight,0)/(requestedWeight || 100));
  const completeness=Math.round(dimensions.reduce((sum,d)=>sum+(values(candidate[d.key]).length?d.weight:0),0));
  const comparableEvidence=Math.round(dimensions.reduce((sum,d)=>sum+(!['unknown','review','not-requested'].includes(d.status)?d.weight:0),0));
  const speciesCompatible=['match','partial'].includes(byKey.species.status);
  const tissueCompatible=['match','partial'].includes(byKey.tissue.status);
  const unknown=dimensions.filter(d=>['unknown','review'].includes(d.status));
  let pathway='Needs metadata review';
  if(byKey.species.status==='mismatch') pathway='Cross-species analysis only';
  else if(byKey.tissue.status==='mismatch') pathway='Different tissue — review relevance';
  else if(speciesCompatible && tissueCompatible) {
    if(dimensions.every(d=>d.status==='match') && candidate.rawCounts===true && values(candidate.covariates).includes('donor id') && values(candidate.covariates).includes('batch')) pathway='Direct integration candidate';
    else if(values(candidate.annotation).length && byKey.species.status==='match') pathway='Reference-based mapping candidate';
    else if(comparableEvidence>=55 && values(candidate.covariates).includes('donor id')) pathway='Harmonized meta-analysis candidate';
  }
  const targetCells=values(input.cellTypes), availableCells=values(candidate.cellTypes);
  const cellTypeNote=targetCells.length ? !availableCells.length ? 'Target cell-type coverage is not reported.' : targetCells.every(x=>availableCells.includes(x)) ? 'Target labels are present; verify annotation quality and sufficient cells per donor.' : 'Some target cell-type labels are absent or use different terminology; ontology review is required.' : 'No target cell-type restriction supplied.';
  const flags=[...unknown.map(d=>`${d.label}: ${d.note}`),...dimensions.filter(d=>d.status==='mismatch').map(d=>`${d.label}: ${d.note}`),...(candidate.notes || [])];
  if(candidate.rawCounts!==true) flags.push('Availability and representation of raw counts have not been verified.');
  flags.push('Donor overlap and cohort independence require review across repositories and investigator data.');
  const actions=pathway==='Direct integration candidate' ? ['Inspect count matrices, feature identifiers, QC distributions, and donor/batch design.', 'Run a small integration pilot; test for overcorrection and preserved biological effects.'] : pathway==='Reference-based mapping candidate' ? ['Confirm an appropriate annotated reference subset and shared features.', 'Validate label transfer on held-out donors and inspect unmapped or low-confidence cell states.'] : pathway==='Harmonized meta-analysis candidate' ? ['Confirm independent donors, comparable outcomes, and covariate definitions.', 'Estimate effects within each study using donor-level replication, then assess heterogeneity before combining.'] : ['Review source metadata and linked methods to resolve missing information.', 'Confirm species, tissue, assay, target cell populations, and available sample-level covariates before selecting an analysis.'];
  return {...candidate,score,completeness,comparableEvidence,pathway,dimensions,cellTypeNote,flags,actions};
}

export function relatedRecords(records) {
  const groups=new Map();
  for(const record of records) {
    for(const key of [record.id,...(record.aliases || []),...(record.publications || []).map(x=>x.replace(/^https?:\/\/(dx\.)?doi.org\//,'').replace(/\/$/,''))]) {
      if(!key) continue;
      if(!groups.has(key)) groups.set(key,[]);
      groups.get(key).push(`${record.source}:${record.id}`);
    }
  }
  return [...groups.entries()].filter(([,members])=>new Set(members).size>1).map(([evidence,members])=>({evidence,members:[...new Set(members)]}));
}

export function analyze(input,records,{sourceStatus=[],catalogVersion='imported'}={}) {
  validateInput(input);
  const selected=records.filter(r=>input.sources.includes(r.source));
  const eligible=selected.filter(r=>{
    const species=values(r.species);
    if(!input.includeCrossSpecies && species.length && !species.includes(normalize(input.species))) return false;
    if(input.mode==='discovery' && values(input.disease).length && !conditionMatch(input.disease,r)) return false;
    if(searchText(input.keyword)) {
      const text=[r.id,...list(r.aliases),r.title,r.summary,...DIMENSIONS.flatMap(([key])=>list(r[key])),...list(r.cellTypes)].join(' ');
      if(!containsTerms(text,input.keyword)) return false;
    }
    return true;
  });
  const ranked=eligible.map(r=>{
    const assessed=assessCandidate(input,r);
    if(input.mode==='discovery' && values(input.disease).length) assessed.conditionMatch=conditionMatch(input.disease,r);
    return assessed;
  }).sort((a,b)=>b.score-a.score || b.comparableEvidence-a.comparableEvidence || a.id.localeCompare(b.id));
  const overlaps=relatedRecords(eligible);
  return {version:VERSION,createdAt:new Date().toISOString(),catalogVersion,input,sourceStatus,totalAvailable:selected.length,candidateCount:ranked.length,ranked,possibleOverlaps:overlaps,
    method:'Unvalidated metadata screening heuristic, not a probability of successful integration. In discovery mode, criteria fit is normalized over specified criteria only; unspecified preferences are not mismatches. Missing public evidence receives zero credit; text-inferred fields receive at most 25% of their weight. Mixed labels receive partial credit. Candidate completeness measures reported fields across all dimensions, not their reliability. A high criteria-fit score does not establish integration readiness.',
    limitations:['Scientific question and narrative notes are retained for optional LLM review; deterministic ranking uses the structured fields and keyword filter.','Repository metadata cannot establish matrix quality, donor independence, statistical power, or successful integration.','Publications are linked, not automatically read. Model review can use supplied methods excerpts.','No expression matrices are downloaded or integrated.','Related records are flagged by shared accessions/publication links; unresolved duplicates may remain.'],
    llm:{status:'not-requested'}};
}

export function reportCsv(report) {
  const cell=value=>{let s=String(value??'');if(/^\s*[=+@\-]|^[\t\r]/.test(s)) s="'"+s;return `"${s.replaceAll('"','""')}"`;};
  const rows=[['Rank','Source','Accession','Title','Compatibility score','Metadata completeness','Comparable evidence','Suggested approach','Source URL','Flags']];
  report.ranked.forEach((r,i)=>rows.push([i+1,SOURCES[r.source]?.name||r.source,r.id,r.title,r.score,r.completeness,r.comparableEvidence,r.pathway,r.url,r.flags.join(' | ')]));
  return rows.map(row=>row.map(cell).join(',')).join('\r\n');
}
