#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCli } from '../lib/cli-core.mjs';

export * from '../lib/cli-core.mjs';

function isInvokedDirectly() {
  if (!process.argv[1]) return false;
  const current = fileURLToPath(import.meta.url);
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(current);
  } catch {
    return resolve(process.argv[1]) === resolve(current);
  }
}

if (isInvokedDirectly()) await runCli(process.argv.slice(2));
