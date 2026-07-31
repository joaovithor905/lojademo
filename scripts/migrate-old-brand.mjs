import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const ignored = new Set(['.git','node_modules','.netlify','dist','build']);
const extensions = new Set(['.html','.js','.mjs','.css','.md','.json','.toml','.sql','.txt','.yml','.yaml','.example']);
const replacements = [
  ['Vitta Fit Wear','Loja Demo'],
  ['VITTAFITWEAR','LOJAONLINE'],
  ['pedido_pago_vitta','pedido_pago_loja'],
  ['VITTA10','DEMO10'],
  ['vitta.afitwear','sualoja'],
  ['VITTA_CONFIG','STORE_CONFIG'],
  ['vitta-cart','loja-demo-cart'],
  ['vitta-pending-order','loja-demo-pending-order'],
  ['relatorio-vitta-','relatorio-loja-'],
  ['vitta-fit-wear','loja-demo'],
  ['vittafitwear','loja-demo']
];
let changed=0;
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(ignored.has(entry.name))continue;const file=path.join(dir,entry.name);if(entry.isDirectory()){walk(file);continue;}if(!extensions.has(path.extname(entry.name).toLowerCase()))continue;let text;try{text=fs.readFileSync(file,'utf8')}catch{continue}const original=text;for(const [from,to] of replacements)text=text.split(from).join(to);text=text.replace(/\bVitta\b/g,'Loja Demo');if(text!==original){fs.writeFileSync(file,text,'utf8');changed++;console.log('Atualizado:',path.relative(root,file));}}}
walk(root);
console.log(`Migração concluída. ${changed} arquivo(s) atualizado(s).`);
