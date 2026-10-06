import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
for(const path of ['index.html','src/app.js','src/analysis.js','src/sources.js','src/styles.css','examples/investigator.json','reference-data/catalog.json']) {
 const destination=resolve(root,'docs',path);await mkdir(dirname(destination),{recursive:true});
 if(path==='index.html') {let html=await readFile(resolve(root,path),'utf8');html=html.replace('<head>','<head><meta name="scrna-api-base" content="https://scrna-seqai.d7bt7qrzfj.chatgpt.site">');await writeFile(destination,html);}
 else await copyFile(resolve(root,path),destination);
}
await writeFile(resolve(root,'docs/.nojekyll'),'');
console.log('GitHub Pages bundle prepared in docs/.');
