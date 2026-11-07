// Saves this laptop's public backend address into Supabase (app_config.backend_url)
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = (process.argv[2] || '').trim().replace(/\/+$/, '');
if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i.test(url) && !/^https:\/\//i.test(url)) {
  console.error('Usage: node register-url.js https://<tunnel-address>');
  process.exit(1);
}
const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);
const { error } = await supabase
  .from('app_config')
  .upsert({ key: 'backend_url', value: url, updated_at: new Date().toISOString() }, { onConflict: 'key' });
if (error) { console.error('Could not save backend URL:', error.message); process.exit(1); }
console.log(`Live site will now use this laptop's backend: ${url}`);
