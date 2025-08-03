import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Read root package.json
const rootPkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8'));

// Minimal dist package.json
const distPkg = {
  name: rootPkg.name,
  version: rootPkg.version,
  license: rootPkg.license,
  type: 'module',
  main: './index.js',
  module: './index.js',
  types: './index.d.ts',
  exports: rootPkg.exports,
  files: [
    '**/*.compact',
    '**/witnesses/**/*',
    'artifacts/**/*',
    '*.js',
    '*.d.ts',
  ],
};

writeFileSync(resolve('dist/package.json'), JSON.stringify(distPkg, null, 2));

console.log('📦 Wrote minimal dist/package.json');
