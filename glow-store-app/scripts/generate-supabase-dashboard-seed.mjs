import { mkdir, readFile, writeFile } from 'node:fs/promises';

const wilayas = JSON.parse(await readFile(new URL('../src/wilayas.json', import.meta.url), 'utf8'));
const communes = JSON.parse(await readFile(new URL('../public/data/communes.json', import.meta.url), 'utf8'));
const json = (rows) => JSON.stringify(rows).replaceAll("'", "''");
const out = new URL('../output/glow-store-supabase-import/', import.meta.url);
await mkdir(out, { recursive: true });
const wilayaRows = wilayas.map((row) => ({ code: row.code, name: row.name, name_ar: row.name_ar }));
const wilayaQuery = `insert into public.glow_wilayas(code,name,name_ar) select x.code,x.name,x.name_ar from jsonb_to_recordset('${json(wilayaRows)}'::jsonb) as x(code smallint,name text,name_ar text) on conflict(code) do update set name=excluded.name,name_ar=excluded.name_ar;`;
await writeFile(new URL('wilayas.sql', out), wilayaQuery, 'utf8');
const batchSize = 200;
for (let start = 0; start < communes.length; start += batchSize) {
  const rows = communes.slice(start, start + batchSize).map((row) => ({ id: row.id, post_code: row.post_code, name: row.name, name_ar: row.name_ar, wilaya_code: row.wilaya_code }));
  const query = `insert into public.glow_communes(id,post_code,name,name_ar,wilaya_code) select x.id,x.post_code,x.name,x.name_ar,x.wilaya_code from jsonb_to_recordset('${json(rows)}'::jsonb) as x(id integer,post_code text,name text,name_ar text,wilaya_code smallint) on conflict(id) do update set post_code=excluded.post_code,name=excluded.name,name_ar=excluded.name_ar,wilaya_code=excluded.wilaya_code;`;
  const part = String(start / batchSize + 1).padStart(2, '0');
  await writeFile(new URL(`communes-${part}.sql`, out), query, 'utf8');
}
process.stdout.write(`Generated one wilaya statement and ${Math.ceil(communes.length / batchSize)} commune batches.\n`);
