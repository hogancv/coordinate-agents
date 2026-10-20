#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
const canonical = readFileSync(new URL('../docs/llms.txt', import.meta.url), 'utf8');
writeFileSync(new URL('../llms.txt', import.meta.url), canonical);
console.log('Generated root llms.txt from docs/llms.txt.');
