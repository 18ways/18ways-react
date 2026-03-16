import assert from 'node:assert/strict';
import { TextEncoder } from 'node:util';
import { JSDOM } from 'jsdom';
import React from 'react';

process.env.NODE_ENV = 'test';

const E2E_TIMEOUT_MS = 15000;

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost',
});

(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).navigator = dom.window.navigator;
(globalThis as any).HTMLElement = dom.window.HTMLElement;
(globalThis as any).Node = dom.window.Node;
(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).fetch = async () =>
  new Response(JSON.stringify({ data: [], errors: [] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

let teardownComplete = false;

const teardown = async (): Promise<void> => {
  if (teardownComplete) {
    return;
  }

  teardownComplete = true;

  try {
    const testingLibrary = await import('@testing-library/react');
    testingLibrary.cleanup();
  } catch {
    // Ignore cleanup failures during shutdown.
  }

  try {
    const reactTesting = await import('@18ways/react/testing');
    reactTesting.resetTestRuntimeState();
  } catch {
    // Ignore reset failures during shutdown.
  }

  dom.window.close();
};

const fail = async (label: string, error: unknown): Promise<never> => {
  await teardown();
  console.error(`[18ways-react:e2e] ${label}`, error);
  process.exit(1);
};

const timeoutId = setTimeout(() => {
  void fail('timed out waiting for test completion', new Error(`Exceeded ${E2E_TIMEOUT_MS}ms`));
}, E2E_TIMEOUT_MS);

process.on('unhandledRejection', (error) => {
  void fail('unhandled rejection', error);
});

process.on('uncaughtException', (error) => {
  void fail('uncaught exception', error);
});

const run = async () => {
  const reactRuntime = await import('@18ways/react');
  const testingLibrary = await import('@testing-library/react');
  const reactTesting = await import('@18ways/react/testing');

  const { render, screen } = testingLibrary;
  const { T, Ways, useT } = reactRuntime;

  const HookConsumer = () => {
    const t = useT();
    return <div data-testid="hook-text">{t('Dashboard')}</div>;
  };

  render(
    <Ways
      apiKey="demo-key"
      locale="en-GB"
      baseLocale="en-GB"
      context="app"
      acceptedLocales={['en-GB']}
    >
      <div data-testid="component-text">
        <T>Hello from React</T>
      </div>
      <HookConsumer />
    </Ways>
  );

  assert.equal(screen.getByTestId('component-text').textContent, 'Hello from React');
  assert.equal(screen.getByTestId('hook-text').textContent, 'Dashboard');

  await reactTesting.clearQueueForTests();
  clearTimeout(timeoutId);
  await teardown();
  console.log('[18ways-react:e2e] react smoke passed');
};

run().catch((error) => void fail('failed', error));
