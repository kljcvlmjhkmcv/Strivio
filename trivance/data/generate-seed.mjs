import fs from 'node:fs';
import path from 'node:path';

const folder = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:[A-Z]:)/, value => value.slice(1)));
const wilayas = JSON.parse(fs.readFileSync(path.join(folder, 'wilayas.json'), 'utf8'));
const communes = JSON.parse(fs.readFileSync(path.join(folder, 'communes.json'), 'utf8'));
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const output = [
  '-- Source: riadh2002/algeria-69-wilayas-1541-communes (MIT; see trivance/data/LICENSE and NOTICE).',
  `insert into trivance_private.wilayas (code, name_ar, name_latin) values\n${wilayas.map(item => `(${item.code}, ${quote(item.name_ar)}, ${quote(item.name)})`).join(',\n')}\non conflict (code) do update set name_ar = excluded.name_ar, name_latin = excluded.name_latin;`
];
for (let start = 0; start < communes.length; start += 200) {
  const chunk = communes.slice(start, start + 200);
  output.push(`insert into trivance_private.communes (id, wilaya_code, name_ar, name_latin) values\n${chunk.map(item => `(${item.id}, ${item.wilaya_code}, ${quote(item.name_ar)}, ${quote(item.name)})`).join(',\n')}\non conflict (id) do update set wilaya_code = excluded.wilaya_code, name_ar = excluded.name_ar, name_latin = excluded.name_latin;`);
}
fs.writeFileSync(path.resolve(folder, '../../supabase/migrations/202610030200_trivance_locations.sql'), output.join('\n\n') + '\n');
console.log(`Generated ${wilayas.length} wilayas and ${communes.length} communes`);
