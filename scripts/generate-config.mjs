import fs from 'node:fs';
import path from 'node:path';

const output = path.resolve('public/config.js');
const supabaseUrl = process.env.SUPABASE_URL || 'COLE_AQUI_A_URL_DO_SUPABASE';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || 'COLE_AQUI_A_CHAVE_PUBLICA_DO_SUPABASE';

const config = `window.VITTA_CONFIG = ${JSON.stringify({
  supabaseUrl,
  supabaseAnonKey,
  deliveryFee: 10,
  whatsappNumber: '5564992886556',
  instagram: 'vitta.afitwear'
}, null, 2)};\n`;

fs.writeFileSync(output, config, 'utf8');
console.log(`Configuração pública gerada em ${output}`);
