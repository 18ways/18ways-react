#!/usr/bin/env bun

import { $ } from 'bun';

const EXTERNAL_DEPS = ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'];
const externalFlags = EXTERNAL_DEPS.map((dep) => `--external=${dep}`).join(' ');

async function build() {
  await $`rm -rf dist`;
  await $`mkdir -p dist`;

  await $`bun build ./index.tsx \
    --outdir=dist \
    --entry-naming="bundle.esm.[ext]" \
    --format=esm \
    --target=browser \
    ${externalFlags.split(' ')} \
    --sourcemap=linked \
    --minify \
    --banner="'use client';"`;

  await $`bun build ./index.tsx \
    --outdir=dist \
    --entry-naming="bundle.cjs.[ext]" \
    --format=cjs \
    --target=browser \
    ${externalFlags.split(' ')} \
    --sourcemap=linked \
    --minify \
    --banner="'use client';"`;
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
