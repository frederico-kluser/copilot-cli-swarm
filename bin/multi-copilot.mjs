#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const binDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(binDir, '..');
const entryPoint = path.join(projectRoot, 'src', 'index.ts');
const tsxBin = path.join(projectRoot, 'node_modules', '.bin', 'tsx');

try {
  execFileSync(tsxBin, [entryPoint, ...process.argv.slice(2)], {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: { ...process.env },
  });
} catch (err) {
  process.exit(err.status ?? 1);
}
