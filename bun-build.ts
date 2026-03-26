#!/usr/bin/env bun

import { $ } from 'bun';

const EXTERNAL_DEPS = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  '@18ways/core',
  '@18ways/core/*',
] as const;
const externalFlags = EXTERNAL_DEPS.map((dep) => `--external=${dep}`).join(' ');

async function build() {
  await $`rm -f testing.js testing.js.map`;
  await $`rm -rf dist`;
  await $`rm -rf dist-types`;
  await $`mkdir -p dist`;
  await $`mkdir -p dist-types`;

  await $`bun build ./index.tsx \
    --outdir=dist \
    --entry-naming="bundle.esm.[ext]" \
    --production \
    --format=esm \
    --target=browser \
    ${externalFlags.split(' ')} \
    --sourcemap=linked \
    --minify \
    --banner="'use client';"`;

  await $`bun build ./index.tsx \
    --outdir=dist \
    --entry-naming="bundle.cjs.[ext]" \
    --production \
    --format=cjs \
    --target=browser \
    ${externalFlags.split(' ')} \
    --sourcemap=linked \
    --minify \
    --banner="'use client';"`;

  await $`bun build ./testing.ts \
    --outdir=dist \
    --entry-naming="testing.[ext]" \
    --production \
    --format=esm \
    --target=node \
    --sourcemap=linked`;

  await $`rm -f ../../.cache/tsc/18ways-react.tsbuildinfo`;
  await $`../../node_modules/.bin/tsc \
    -p tsconfig.json \
    --emitDeclarationOnly \
    --declaration \
    --noEmit false \
    --outDir dist-types`;

  await $`node -e "
    const fs = require('fs');
    for (const file of ['dist-types/index.d.ts', 'dist-types/testing.d.ts']) {
      const source = fs.readFileSync(file, 'utf8');
      const banner = '/// <reference path=\"../global.d.ts\" />\\n\\n';
      if (!source.startsWith(banner)) {
        fs.writeFileSync(file, banner + source);
      }
    }
  "`;
  await $`rm -f dist-types/tsconfig.tsbuildinfo`;
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
