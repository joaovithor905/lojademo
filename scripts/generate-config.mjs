import fs from 'node:fs';
import path from 'node:path';

const output = path.resolve('public/config.js');
const supabaseUrl = process.env.SUPABASE_URL || 'https://udgbtazfbzemhioqohir.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || 'sb_publishable_HG6-iqXmt2BOa4ODmUhvOQ_UvWp09ib';

const config = `window.VITTA_CONFIG = ${JSON.stringify({
  supabaseUrl,
  supabaseAnonKey,
  deliveryFee: 10,
  whatsappNumber: '5564992886556',
  instagram: 'vitt.afitwear'
}, null, 2)};\n`;

fs.writeFileSync(output, config, 'utf8');
console.log(`Configuração pública gerada em ${output}`);
