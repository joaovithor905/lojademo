import fs from 'node:fs';
import path from 'node:path';

const output = path.resolve('public/config.js');
const supabaseUrl = process.env.SUPABASE_URL || 'https://udgbtazfbzemhioqohir.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || 'sb_publishable_HG6-iqXmt2BOa4ODmUhvOQ_UvWp09ib';

if (!fs.existsSync(output)) {
  throw new Error('public/config.js não encontrado.');
}

let content = fs.readFileSync(output, 'utf8');

function replaceStringProperty(source, property, value) {
  const pattern = new RegExp(`("${property}"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`, 'm');
  if (!pattern.test(source)) {
    throw new Error(`Propriedade "${property}" não encontrada em public/config.js.`);
  }
  return source.replace(pattern, (_, prefix) => `${prefix}${JSON.stringify(String(value))}`);
}

content = replaceStringProperty(content, 'supabaseUrl', supabaseUrl);
content = replaceStringProperty(content, 'supabaseAnonKey', supabaseAnonKey);

fs.writeFileSync(output, content, 'utf8');
console.log('Configuração pública atualizada sem sobrescrever a identidade da loja.');
