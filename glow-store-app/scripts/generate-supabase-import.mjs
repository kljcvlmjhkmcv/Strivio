import { mkdir, readFile, writeFile } from 'node:fs/promises';

const quote = (value) => value == null ? '' : `"${String(value).replaceAll('"', '""')}"`;
const wilayas = JSON.parse(await readFile(new URL('../src/wilayas.json', import.meta.url), 'utf8'));
const communes = JSON.parse(await readFile(new URL('../public/data/communes.json', import.meta.url), 'utf8'));
const out = new URL('../output/glow-store-supabase-import/', import.meta.url);
await mkdir(out, { recursive: true });
await writeFile(new URL('glow_wilayas.csv', out), `code,name,name_ar\n${wilayas.map((r) => `${r.code},${quote(r.name)},${quote(r.name_ar)}`).join('\n')}\n`, 'utf8');
await writeFile(new URL('glow_communes.csv', out), `id,post_code,name,name_ar,wilaya_code,daira,daira_ar\n${communes.map((r) => [r.id, quote(r.post_code), quote(r.name), quote(r.name_ar), r.wilaya_code, quote(r.daira), quote(r.daira_ar)].join(',')).join('\n')}\n`, 'utf8');
process.stdout.write(`Prepared ${wilayas.length} wilayas and ${communes.length} communes for the dashboard import.\n`);
