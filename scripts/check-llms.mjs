#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const docs = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const index = readFileSync(join(docs, 'llms.txt'), 'utf8');
const site = 'https://hogancv.github.io/coordinate-agents/';
const routes = [...new Set(index.match(/https:\/\/hogancv\.github\.io\/coordinate-agents\/[^\s)]*/g) || [])];
const errors = [];
if (!index.startsWith('# Coordinate Agents\n')) errors.push('Missing index title.');
if (!index.includes('Canonical repository: https://github.com/hogancv/coordinate-agents')) {
  errors.push('Missing canonical repository.');
}
if (!routes.length) errors.push('Missing documentation routes.');
for (const route of routes) {
  let page = new URL(route).pathname.slice(new URL(site).pathname.length);
  if (!page || page.endsWith('/')) page += 'index.md';
  else if (page.endsWith('.html')) page = page.slice(0, -5) + '.md';
  const target = resolve(docs, page);
  if (!target.startsWith(docs + sep) || !existsSync(target)) errors.push(`Unresolved documentation route: ${route}`);
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`docs/llms.txt: ${routes.length} documentation routes verified.`);
}
