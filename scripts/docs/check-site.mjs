import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const decode = text => text.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
export function checkSite(directory, base = '/coordinate-agents/') {
  const root = resolve(directory);
  const files = [];
  const walk = dir => { for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) walk(join(dir, entry.name));
    else if (entry.name.endsWith('.html')) files.push(join(dir, entry.name));
  }};
  walk(root);
  const ids = new Map(files.map(file => [file, new Set([...readFileSync(file, 'utf8').matchAll(/\bid="([^"]+)"/g)].map(m => decode(m[1])))]));
  const errors = [];
  let checked = 0;
  for (const file of files) {
    const name = relative(root, file).replaceAll('\\', '/');
    const source = new URL(base + name, 'https://hogancv.github.io');
    const html = readFileSync(file, 'utf8');
    for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
      const href = decode(match[1]);
      if (!href || /^(?:mailto:|tel:|data:|javascript:)/.test(href)) continue;
      const target = new URL(href, source);
      if (target.origin !== source.origin) continue;
      checked++;
      if (!target.pathname.startsWith(base)) { errors.push(`${name}: base leak ${href}`); continue; }
      const path = decodeURIComponent(target.pathname.slice(base.length));
      let dest = resolve(root, path);
      if (target.pathname.endsWith('/')) dest = join(dest, 'index.html');
      if (!existsSync(dest)) { errors.push(`${name}: missing ${href}`); continue; }
      if (target.hash && ids.has(dest)) {
        const hash = decodeURIComponent(target.hash.slice(1));
        if (!ids.get(dest).has(hash)) errors.push(`${name}: missing fragment ${href}`);
      }
    }
  }
  return { pages: files.length, checked, errors: [...new Set(errors)] };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkSite(fileURLToPath(new URL('../../docs/.vitepress/dist', import.meta.url)));
  console.log(`${result.pages} HTML pages; ${result.checked} local links/assets checked; ${result.errors.length} errors`);
  for (const error of result.errors) console.error(error);
  if (result.errors.length) process.exitCode = 1;
}
