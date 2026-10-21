import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const docs = resolve(root, 'docs'), dist = resolve(docs, '.vitepress/dist');
const legacy = JSON.parse(readFileSync(resolve(docs, 'maintenance/legacy-headings.json'), 'utf8'));
const ids = html => new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1].replace(/&amp;/g,'&')));
const target = name => resolve(dist, name.replace(/\.md$/, '.html'));
const errors = [];
let anchors = 0, routes = 0, pairs = 0;
for (const row of legacy) {
  const file = target(row.source);
  if (!existsSync(file)) { errors.push('Lost route: ' + row.source); continue; }
  routes++;
  const present = ids(readFileSync(file, 'utf8'));
  for (const heading of row.headings) { anchors++; if (!present.has(heading.id)) errors.push(`${row.source}: lost #${heading.id}`); }
}
for (const name of readdirSync(docs).filter(n=>n.endsWith('.md'))) {
  const zh = resolve(docs, 'zh-CN', name);
  if (!existsSync(zh) || /translationPending: true/.test(readFileSync(resolve(docs, name), 'utf8') + readFileSync(zh,'utf8'))) continue;
  pairs++;
  const enHtml = readFileSync(target(name), 'utf8'), zhHtml = readFileSync(target('zh-CN/'+name),'utf8');
  for (const [from, to] of [[enHtml,zhHtml],[zhHtml,enHtml]]) {
    const present = ids(to);
    for (const match of from.matchAll(/<h[1-6] id="([^"]+)"/g)) if (!present.has(match[1])) errors.push(`${name}: missing locale fragment #${match[1]}`);
  }
}
console.log(`${routes} legacy routes; ${anchors} old heading anchors; ${pairs} fully translated root pairs; ${errors.length} compatibility errors`);
for (const error of errors) console.error(error);
if (errors.length) process.exitCode = 1;
