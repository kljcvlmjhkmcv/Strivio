import { readFile, writeFile } from 'node:fs/promises';

const esc = (value) => value == null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
const wilayas = JSON.parse(await readFile(new URL('../src/wilayas.json', import.meta.url), 'utf8'));
const communes = JSON.parse(await readFile(new URL('../public/data/communes.json', import.meta.url), 'utf8'));
const statements = [
  '-- Public Algerian administrative reference data for Glow Store checkout.',
  '-- Source and license: public/data/NOTICE and public/data/LICENSE.',
  'insert into public.glow_wilayas(code, name, name_ar) values\n' + wilayas.map((row) => `(${row.code},${esc(row.name)},${esc(row.name_ar)})`).join(',\n') + '\non conflict (code) do update set name=excluded.name, name_ar=excluded.name_ar;',
];
for (let index = 0; index < communes.length; index += 150) {
  const rows = communes.slice(index, index + 150);
  statements.push(`insert into public.glow_communes(id, post_code, name, name_ar, wilaya_code, daira, daira_ar) values\n${rows.map((row) => `(${row.id},${esc(row.post_code)},${esc(row.name)},${esc(row.name_ar)},${row.wilaya_code},${esc(row.daira)},${esc(row.daira_ar)})`).join(',\n')}\non conflict (id) do update set post_code=excluded.post_code, name=excluded.name, name_ar=excluded.name_ar, wilaya_code=excluded.wilaya_code, daira=excluded.daira, daira_ar=excluded.daira_ar;`);
}
await writeFile(new URL('../supabase/seed.sql', import.meta.url), `${statements.join('\n\n')}\n`, 'utf8');
process.stdout.write(`Generated ${wilayas.length} wilayas and ${communes.length} communes.\n`);
