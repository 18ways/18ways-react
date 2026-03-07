import assert from 'node:assert/strict';
import { TextEncoder } from 'node:util';
import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost',
});

(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).navigator = dom.window.navigator;
(globalThis as any).HTMLElement = dom.window.HTMLElement;
(globalThis as any).Node = dom.window.Node;
(globalThis as any).TextEncoder = TextEncoder;

const run = async () => {
  const testingLibrary = await import('@testing-library/react');
  const reactRuntime = await import('@18ways/react');

  const { cleanup, render, screen } = testingLibrary;
  const { T, Ways, useT } = reactRuntime;

  const HookConsumer = () => {
    const t = useT();
    return <div data-testid="hook-text">{t('Dashboard')}</div>;
  };

  render(
    <Ways apiKey="demo-key" locale="en-GB" baseLocale="en-GB" context="app">
      <div data-testid="component-text">
        <T>Hello from React</T>
      </div>
      <HookConsumer />
    </Ways>
  );

  assert.equal(screen.getByTestId('component-text').textContent, 'Hello from React');
  assert.equal(screen.getByTestId('hook-text').textContent, 'Dashboard');

  cleanup();
  console.log('[18ways-react:e2e] react smoke passed');
};

run().catch((error) => {
  console.error('[18ways-react:e2e] failed', error);
  process.exit(1);
});
