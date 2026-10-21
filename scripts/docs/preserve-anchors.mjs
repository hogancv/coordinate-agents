import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const docs = resolve(root, 'docs');
const require = createRequire(resolve(docs, 'package.json'));
const { createMarkdownRenderer } = await import(require.resolve('vitepress'));
const md = await createMarkdownRenderer(docs);
const inventory = JSON.parse(readFileSync(resolve(docs, 'maintenance/content-inventory.json'), 'utf8'));
const legacy = JSON.parse(readFileSync(resolve(docs, 'maintenance/legacy-headings.json'), 'utf8'));
const cache = new Map();
function get(name) {
  if (cache.has(name)) return cache.get(name);
  const file = resolve(docs, name);
  const source = readFileSync(file, 'utf8');
  const body = source.replace(/^---\n[\s\S]*?\n---\n/, value => value.replace(/[^\n]/g, ' '));
  const tokens = md.parse(body, {});
  const headings = tokens.flatMap((token, i) => token.type === 'heading_open' ? [{ id: token.attrGet('id'), line: token.map[0], level: token.tag, title: tokens[i + 1].content.replace(/\s*\{#[^}]+\}/, '') }] : []);
  const ids = new Set([...source.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  for (const h of headings) ids.add(h.id);
  const value = { file, source, headings, ids, aliases: new Map() };
  cache.set(name, value); return value;
}
const norm = s => s.replace(/&amp;/g, '&').replace(/[`*_]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
function alias(page, id, heading) {
  if (!id || page.ids.has(id)) return;
  const line = heading?.line ?? page.headings[0]?.line ?? page.source.split('\n').length - 1;
  const entries = page.aliases.get(line) || [];
  entries.push(id); page.aliases.set(line, entries); page.ids.add(id);
}
let legacyCount = 0;
for (const row of legacy) {
  const page = get(row.source);
  for (const [i, heading] of (row.headings || []).entries()) {
    const text = norm(heading.title);
    const match = page.headings.find(h => norm(h.title) === text) ||
      page.headings.find(h => text.startsWith(norm(h.title)) && norm(h.title).length > 3) ||
      page.headings[Math.min(i, page.headings.length - 1)];
    const before = page.ids.size; alias(page, heading.id, match);
    legacyCount += page.ids.size - before;
  }
}
let localeCount = 0;
const localeSources = [...inventory.files, ...readdirSync(docs).filter(name => name.endsWith('.md') && !inventory.files.some(row => row.path === 'docs/' + name)).map(name => ({ path: 'docs/' + name }))];
for (const row of localeSources) {
  if (!row.path.startsWith('docs/') || row.path.startsWith('docs/zh-CN/')) continue;
  const name = row.path.slice(5), zhName = 'zh-CN/' + name;
  if (!existsSync(resolve(docs, zhName))) continue;
  const en = get(name), zh = get(zhName);
  const complete = !/translationPending: true/.test(en.source + zh.source);
  if (complete && (en.headings.length !== zh.headings.length || en.headings.some((h, i) => h.level !== zh.headings[i].level))) throw new Error('Heading alignment needs review: ' + name);
  for (const [i, h] of en.headings.entries()) { const n = zh.ids.size; alias(zh, h.id, complete ? zh.headings[i] : zh.headings[0]); localeCount += zh.ids.size - n; }
  for (const [i, h] of zh.headings.entries()) { const n = en.ids.size; alias(en, h.id, complete ? en.headings[i] : en.headings[0]); localeCount += en.ids.size - n; }
  // Legacy fragments can also be carried through the native language menu.
  for (const id of [...en.ids]) { const n = zh.ids.size; alias(zh, id, zh.headings.find((h, i) => en.headings[i]?.id === id)); localeCount += zh.ids.size - n; }
  for (const id of [...zh.ids]) { const n = en.ids.size; alias(en, id, en.headings.find((h, i) => zh.headings[i]?.id === id)); localeCount += en.ids.size - n; }
}
for (const page of cache.values()) {
  if (!page.aliases.size) continue;
  const lines = page.source.split('\n');
  for (const [line, ids] of [...page.aliases.entries()].sort((a, b) => b[0] - a[0])) {
    lines.splice(line, 0, ...ids.map(id => `<div id="${id.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" class="doc-anchor" aria-hidden="true"></div>`), '');
  }
  writeFileSync(page.file, lines.join('\n'));
}
console.log(`Preserved ${legacyCount} old heading aliases and ${localeCount} locale aliases.`);
