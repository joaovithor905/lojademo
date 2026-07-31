import fs from 'node:fs';
import path from 'node:path';

const output = path.resolve('public/config.js');
const supabaseUrl = process.env.SUPABASE_URL || 'COLE_AQUI_A_URL_DO_SUPABASE';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || 'COLE_AQUI_A_CHAVE_PUBLICA_DO_SUPABASE';

if (!fs.existsSync(output)) throw new Error('public/config.js não encontrado.');
let content = fs.readFileSync(output, 'utf8');

function replaceStringProperty(source, property, value) {
  const pattern = new RegExp(`("${property}"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`, 'm');
  if (!pattern.test(source)) throw new Error(`Propriedade "${property}" não encontrada em public/config.js.`);
  return source.replace(pattern, (_, prefix) => `${prefix}${JSON.stringify(String(value))}`);
}

// O deploy só injeta as credenciais públicas. Nome, slogan, WhatsApp,
// Instagram, cidade e taxa de entrega permanecem como você editou no config.js.
content = replaceStringProperty(content, 'supabaseUrl', supabaseUrl);
content = replaceStringProperty(content, 'supabaseAnonKey', supabaseAnonKey);
fs.writeFileSync(output, content, 'utf8');
console.log('config.js atualizado sem sobrescrever a identidade da loja.');
