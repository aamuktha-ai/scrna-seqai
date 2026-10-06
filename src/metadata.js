const fields=new Set(['species','tissue','library','isolation','material','depth','platform','annotation','covariates','disease','cellTypes','question','notes','publicationText','keyword']);
const aliases={'cell types':'cellTypes','celltypes':'cellTypes','reads per cell':'depth','library preparation':'library','cell isolation':'isolation','sequencing platform':'platform','annotation schema':'annotation','publication text':'publicationText'};
function delimitedRows(text,delimiter) {
  const rows=[];let row=[],value='',quoted=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='"') {if(quoted && text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}
    else if(c===delimiter && !quoted) {row.push(value);value='';}
    else if(c==='\n' && !quoted) {row.push(value.replace(/\r$/,''));if(row.some(v=>v.trim()))rows.push(row);row=[];value='';}
    else value+=c;
  }
  if(quoted) throw new Error('Unclosed quote in metadata file.');
  if(value || row.length) {row.push(value.replace(/\r$/,''));rows.push(row);}
  return rows;
}
export function parseMetadata(text,name='metadata.json') {
  let raw;
  if(name.toLowerCase().endsWith('.json')) raw=JSON.parse(text);
  else if(/\.(csv|tsv)$/i.test(name)) {
    const rows=delimitedRows(text,name.toLowerCase().endsWith('.tsv')?'\t':',');
    if(rows[0]?.[0]?.trim().toLowerCase()==='field' && rows[0]?.[1]?.trim().toLowerCase()==='value') rows.shift();
    if(rows.some(row=>row.length!==2)) throw new Error('Use two columns: field,value. Cell-level data tables are not supported.');
    raw=Object.fromEntries(rows);
  } else {
    const entries=text.split(/\r?\n/).filter(line=>line.trim()).map(line=>{const index=line.indexOf(':');if(index<1) throw new Error('Use one field: value per line.');return [line.slice(0,index),line.slice(index+1).trim()];});
    raw=Object.fromEntries(entries);
  }
  if(!raw || typeof raw!=='object' || Array.isArray(raw)) throw new Error('Upload a single study metadata object, not a table of cells.');
  const result={};
  for(const [rawKey,value] of Object.entries(raw)) {
    const trimmed=rawKey.trim();const key=aliases[trimmed.toLowerCase()] || [...fields].find(field=>field.toLowerCase()===trimmed.toLowerCase()) || trimmed;
    if(!fields.has(key)) throw new Error(`Unrecognized field: ${rawKey}. Use the study metadata template.`);
    if(value!==null && typeof value!=='string' && typeof value!=='number' && !(Array.isArray(value)&&value.every(x=>typeof x==='string'))) throw new Error(`Invalid metadata value for ${key}.`);
    result[key]=value;
  }
  if(!Object.keys(result).length) throw new Error('Metadata file is empty.');
  return result;
}
