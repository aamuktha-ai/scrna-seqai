export const SOURCES = {
  geo: { name: 'NCBI GEO', url: 'https://www.ncbi.nlm.nih.gov/geo/', description: 'Broad study coverage; protocol details often require sample-level review.' },
  cellxgene: { name: 'CZ CELLxGENE Census', url: 'https://chanzuckerberg.github.io/cellxgene-census/', description: 'Census membership verified by release; descriptive metadata from current Discover records.' },
  hca: { name: 'Human Cell Atlas', url: 'https://explore.data.humancellatlas.org/projects', description: 'Project metadata, experimental protocols, and publication references.' },
  ebi: { name: 'EMBL-EBI Single Cell Expression Atlas', url: 'https://www.ebi.ac.uk/gxa/sc/', description: 'Curated experiments with assay and experimental-factor metadata.' }
};

export const list = value => [...new Set((Array.isArray(value) ? value.flat(Infinity) : [value]).filter(v => v !== null && v !== undefined && v !== '').map(String))];
const labels = value => list((value || []).map(v => typeof v === 'string' ? v : v.label));
const gather = (rows, key) => list((rows || []).flatMap(row => row[key] || []));
const known = values => list(values).filter(v => !/^(unknown|na|not reported|not applicable)$/i.test(v));
export const speciesName = value => ({human:'Homo sapiens',mouse:'Mus musculus','homo sapiens':'Homo sapiens','mus musculus':'Mus musculus'})[String(value).toLowerCase()] || String(value || '');
const tissueTerms = ['lung','brain','pancreas','kidney','liver','blood','heart','spleen','skin','retina','thymus','colon','bone marrow','breast','prostate','ovary','intestine','lymph node'];
export function inferTissue(text) {
  return tissueTerms.filter(term => new RegExp(`\\b${term}\\b`, 'i').test(text));
}
function base(source, id, title, url) {
  return { source, id, title, url, species: [], tissue: [], library: [], isolation: [], material: [], platform: [], annotation: [], covariates: [], disease: [], cellTypes: [], depth: null, cells: null, rawCounts: null, publications: [], aliases: [], inferredFields: [], notes: [] };
}
export function normalizeCellxgene(d, release) {
  const url = `https://cellxgene.cziscience.com/collections/${d.collection_id}`;
  const r = base('cellxgene', d.dataset_id, d.title, url);
  Object.assign(r, {species:labels(d.organism), tissue:labels(d.tissue), library:labels(d.assay), material:list(d.suspension_type), cellTypes:known(labels(d.cell_type)), disease:known(labels(d.disease)), cells:d.cell_count || null,
    summary:d.collection_name || d.title, collectionId:d.collection_id, datasetVersion:d.dataset_version_id, censusRelease:release,
    censusUrl:`https://cellxgene-census-public-us-west-2.s3.us-west-2.amazonaws.com/cell-census/${release}/h5ads/${d.dataset_id}.h5ad`,
    annotation:known(labels(d.cell_type)).length ? ['Cell Ontology'] : [],
    publications:d.collection_doi ? [`https://doi.org/${d.collection_doi}`] : [],
    covariates:[...(known(labels(d.sex)).length ? ['sex'] : []), ...(known(labels(d.development_stage)).length ? ['development stage'] : []), ...(known(labels(d.disease)).length ? ['disease'] : []), ...(known(d.donor_id).length ? ['donor id'] : [])],
    notes:['Census membership is release-specific. Discover metadata may describe a newer dataset version; inspect the Census file before integration. Cell counts are descriptive and must not be summed across overlapping studies.'] });
  return r;
}
export function normalizeHca(hit) {
  const p = hit.projects?.[0] || {};
  const r = base('hca', hit.entryId, p.projectTitle || hit.entryId, `https://explore.data.humancellatlas.org/projects/${hit.entryId}`);
  Object.assign(r, {species:gather(hit.donorOrganisms,'genusSpecies'), tissue:gather(hit.samples,'organ'), library:gather(hit.protocols,'libraryConstructionApproach'), platform:gather(hit.protocols,'instrumentManufacturerModel'), material:gather(hit.protocols,'nucleicAcidSource').map(x => x === 'single cell' ? 'cell' : x === 'single nucleus' ? 'nucleus' : x),
    disease:known(gather(hit.samples,'disease')), cellTypes:known(gather(hit.cellSuspensions,'selectedCellType')), summary:p.projectDescription || '', cells:p.estimatedCellCount || null,
    publications:(p.publications || []).map(x => x.publicationUrl || (x.doi ? `https://doi.org/${x.doi}` : '')).filter(Boolean),
    aliases:(p.accessions || []).map(x=>x.accession),
    covariates:[...(known(gather(hit.donorOrganisms,'biologicalSex')).length ? ['sex'] : []), ...((hit.donorOrganisms || []).some(x=>x.organismAge?.some(a=>a?.value)) ? ['age'] : []), ...(known(gather(hit.donorOrganisms,'developmentStage')).length ? ['development stage'] : [])],
    notes:['Project-level aggregates can mix protocols and tissues. Confirm the exact samples, donor identifiers, and matrix representation in the manifest.']});
  return r;
}
export function normalizeEbi(d) {
  const r=base('ebi',d.experimentAccession,d.experimentDescription,`https://www.ebi.ac.uk/gxa/sc/experiments/${d.experimentAccession}`);
  const factors=d.experimentalFactors || [];
  Object.assign(r,{species:[d.species],library:list(d.technologyType),tissue:inferTissue(d.experimentDescription),summary:d.experimentDescription,cells:d.numberOfAssays || null,
    annotation:factors.some(x=>/ontology labels/i.test(x)) ? ['Cell Ontology'] : factors.some(x=>/authors labels/i.test(x)) ? ['Author labels'] : [],
    covariates:factors.filter(x=>/^(age|sex|disease|individual|donor|batch|developmental stage)$/i.test(x)).map(x=>/individual|donor/.test(x)?'donor id':x),
    aliases:d.experimentAccession.startsWith('E-GEOD-') ? [d.experimentAccession.replace('E-GEOD-','GSE')] : [],
    inferredFields:['tissue'],notes:['Tissue terms are extracted from the title and need confirmation in the experiment design. Reported covariates indicate columns, not completeness or usable coding.']});
  return r;
}
export function normalizeGeo(d) {
  const r=base('geo',d.accession,d.title,`https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${d.accession}`);
  Object.assign(r,{species:list((d.taxon || '').split(';').map(x=>x.trim())),tissue:inferTissue(`${d.title} ${d.summary}`),summary:d.summary || '',sampleCount:d.n_samples || null,
    publications:(d.pubmedids || []).map(id=>`https://pubmed.ncbi.nlm.nih.gov/${id}/`), inferredFields:['tissue'],
    notes:['GEO series summaries are incomplete metadata. Tissue extracted from the title/summary needs confirmation. GEO sample count is not a cell or donor count. Review linked samples and publications.']});
  return r;
}

async function request(url, fetchImpl=fetch, format='json') {
  const response=await fetchImpl(url,{signal:AbortSignal.timeout(45000),headers:{Accept:format==='json'?'application/json':'application/xml'}});
  if(!response.ok) throw new Error(`Repository returned HTTP ${response.status}.`);
  return format==='json' ? response.json() : response.text();
}
const xmlDecode = value => value.replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&quot;','"').replaceAll('&apos;',"'");
export async function censusMembership(fetchImpl=fetch) {
  const registry=await request('https://census.cellxgene.cziscience.com/cellxgene-census/v1/release.json',fetchImpl);
  const release=registry.stable;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(release)) throw new Error('Unsupported Census release registry.');
  const ids=new Set(); let token='';
  for(let page=0;page<30;page++) {
    const url=new URL('https://cellxgene-census-public-us-west-2.s3.us-west-2.amazonaws.com/');
    url.search=new URLSearchParams({'list-type':'2',prefix:`cell-census/${release}/h5ads/`,'max-keys':'1000',...(token?{'continuation-token':token}:{})});
    const xml=await request(url,fetchImpl,'xml');
    for(const match of xml.matchAll(/<Key>[^<]*\/([a-f0-9-]+)\.h5ad<\/Key>/g)) ids.add(match[1]);
    if(!xml.includes('<IsTruncated>true</IsTruncated>')) return {release,ids};
    token=xmlDecode(xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1] || '');
    if(!token) throw new Error('Census listing was truncated without a continuation token.');
  }
  throw new Error('Census listing exceeded the pagination limit.');
}
export async function fetchSource(source,{fetchImpl=fetch,tissue='',species=''}={}) {
  let records, scope;
  if(source==='cellxgene') {
    const settled=await Promise.allSettled([request('https://api.cellxgene.cziscience.com/curation/v1/datasets',fetchImpl),censusMembership(fetchImpl)]);
    for(const item of settled) if(item.status==='rejected') throw item.reason;
    const [datasets,membership]=settled.map(x=>x.value);
    records=datasets.filter(d=>!d.tombstone && membership.ids.has(d.dataset_id)).map(d=>normalizeCellxgene(d,membership.release));
    scope=`Census ${membership.release}; ${records.length} current Discover records matched by dataset ID. Release-only or removed Discover records are not included.`;
  } else if(source==='ebi') {
    const payload=await request('https://www.ebi.ac.uk/gxa/sc/json/experiments',fetchImpl);
    if(!Array.isArray(payload.experiments)) throw new Error('Unexpected Expression Atlas response.');
    records=payload.experiments.map(normalizeEbi); scope='Single Cell Expression Atlas experiment index.';
  } else if(source==='hca') {
    records=[]; let url='https://service.azul.data.humancellatlas.org/index/projects?size=50';
    for(let page=0;url && page<20;page++) {
      if(new URL(url).origin!=='https://service.azul.data.humancellatlas.org') throw new Error('Unexpected HCA pagination origin.');
      const payload=await request(url,fetchImpl);
      if(!Array.isArray(payload.hits)) throw new Error('Unexpected HCA response.');
      records.push(...payload.hits.map(normalizeHca)); url=payload.pagination?.next;
    }
    if(url) throw new Error('HCA index exceeded the pagination limit.');
    scope='HCA project index; project metadata can aggregate multiple experiments.';
  } else if(source==='geo') {
    const terms=['gse[Entry Type]','("single cell"[All Fields] OR "single-cell"[All Fields] OR "single nucleus"[All Fields] OR "single-nucleus"[All Fields])','("RNA"[All Fields] OR "transcriptome"[All Fields] OR "transcriptomic"[All Fields] OR "RNAseq"[All Fields])'];
    if(tissue) terms.push(`"${tissue.replaceAll('"','')}"[All Fields]`);
    if(species) terms.push(`"${speciesName(species)}"[Organism]`);
    const search=await request(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${new URLSearchParams({db:'gds',retmode:'json',retmax:'50',term:terms.join(' AND ')})}`,fetchImpl);
    if(!search.esearchresult?.idlist) throw new Error('Unexpected GEO search response.');
    const ids=search.esearchresult.idlist;
    records=[];
    if(ids.length) {
      await new Promise(resolve=>setTimeout(resolve,400));
      const summary=await request(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?${new URLSearchParams({db:'gds',retmode:'json',id:ids.join(',')})}`,fetchImpl);
      if(!summary.result?.uids) throw new Error('Unexpected GEO summary response.');
      records=summary.result.uids.map(id=>summary.result[id]).filter(d=>d.entrytype==='GSE').map(normalizeGeo);
    }
    scope=`Up to 50 GEO series from ${search.esearchresult.count} search hits; search relevance does not establish assay compatibility.`;
  } else throw new Error('Unknown repository.');
  records=records.filter(r=>r.species.some(s=>['Homo sapiens','Mus musculus'].includes(s)));
  return {source,records,status:'ok',scope,retrievedAt:new Date().toISOString()};
}
