#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = join(root, 'docs', 'llms.txt');
const generatedPath = join(root, 'llms.txt');
const source = readFileSync(sourcePath, 'utf8');

if (process.argv.includes('--check')) {
  const generated = readFileSync(generatedPath, 'utf8');
  if (generated !== source) {
    console.error('llms.txt is out of sync with docs/llms.txt; run npm run sync:llms.');
    process.exitCode = 1;
  } else {
    console.log('llms.txt matches docs/llms.txt.');
  }
} else {
  writeFileSync(generatedPath, source, 'utf8');
  console.log('Copied docs/llms.txt to llms.txt.');
}
