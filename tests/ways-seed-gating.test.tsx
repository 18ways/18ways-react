// @vitest-environment node
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderToPipeableStream } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { Writable } from 'node:stream';
import { JSDOM } from 'jsdom';
import { Ways, T } from '../index';
import {
  fetchConfig,
  fetchKnown,
  fetchSeed,
  fetchTranslations,
  resetServerInMemoryTranslations,
} from '@18ways/core/common';
import { resetTestRuntimeState } from '../testing';

vi.mock('@18ways/core/common', async () => {
  const actual = await vi.importActual('@18ways/core/common');
  return {
    ...actual,
    fetchAcceptedLocales: vi.fn(async (fallbackLocale?: string) => [fallbackLocale || 'en-GB']),
    fetchConfig: vi.fn(async () => ({
      languages: [],
      total: 0,
      translationFallback: { default: 'source', overrides: [] },
    })),
    fetchKnown: vi.fn(),
    fetchKnownContext: vi.fn().mockResolvedValue({ data: [], errors: [] }),
    fetchSeed: vi.fn(),
    fetchTranslations: vi.fn(),
    generateHashId: vi.fn((x) => JSON.stringify(x)),
  };
});

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const extractInjectedStoreHydrationPayload = (html: string) => {
  const match = html.match(
    /const next = (.*?);\s+const target = window\.__18WAYS_TRANSLATION_STORE__/s
  );
  if (!match?.[1]) {
    throw new Error('Could not find injected store hydration payload in SSR HTML');
  }
  return JSON.parse(match[1]) as Record<string, unknown>;
};

describe('WaysRoot - Seed gating', () => {
  beforeEach(() => {
    resetServerInMemoryTranslations();
    resetTestRuntimeState();
    vi.resetAllMocks();
    vi.mocked(fetchConfig).mockResolvedValue({
      languages: [],
      total: 0,
      translationFallback: { default: 'source', overrides: [] },
    });
    vi.mocked(fetchKnown).mockResolvedValue({ data: [], errors: [] });
    vi.mocked(fetchSeed).mockResolvedValue({ data: {} });
    vi.mocked(fetchTranslations).mockResolvedValue({ data: [], errors: [] });
  });

  const renderServer = async (node: React.ReactElement): Promise<string> => {
    return new Promise((resolve, reject) => {
      let html = '';
      const sink = new Writable({
        write(chunk, _encoding, callback) {
          html += chunk.toString();
          callback();
        },
      });

      const stream = renderToPipeableStream(node, {
        onAllReady() {
          stream.pipe(sink);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          reject(error);
        },
      });

      sink.on('finish', () => resolve(html));
      sink.on('error', reject);
    });
  };

  const renderServerShell = async (node: React.ReactElement): Promise<string> => {
    return new Promise((resolve, reject) => {
      let html = '';
      let resolved = false;
      let didShellReady = false;
      let stream: ReturnType<typeof renderToPipeableStream> | null = null;

      const resolveOnce = () => {
        if (resolved) {
          return;
        }

        resolved = true;
        resolve(html);
      };

      const sink = new Writable({
        write(chunk, _encoding, callback) {
          html += chunk.toString();
          callback();
        },
      });

      stream = renderToPipeableStream(node, {
        onShellReady() {
          didShellReady = true;
          stream?.pipe(sink);
          setTimeout(() => {
            stream?.abort();
            resolveOnce();
          }, 0);
        },
        onShellError(error) {
          if (!resolved) {
            reject(error);
          }
        },
        onError(error) {
          if (!resolved && !didShellReady) {
            reject(error);
          }
        },
      });

      sink.on('finish', resolveOnce);
      sink.on('error', reject);
    });
  };

  const executeInjectedScripts = (dom: JSDOM): void => {
    const scripts = Array.from(dom.window.document.querySelectorAll('script'));

    for (const script of scripts) {
      const source = script.textContent;
      if (source?.trim()) {
        dom.window.eval(source);
      }
    }
  };

  const waitForCondition = async (
    assertion: () => void,
    timeoutMs = 2000,
    intervalMs = 10
  ): Promise<void> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        assertion();
        return;
      } catch {}

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    assertion();
  };

  const withTimeout = async <T,>(promise: Promise<T>, timeoutMs = 250): Promise<T> => {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  };

  it('waits for seed and skips translate when seed already provides the translation', async () => {
    const seedDeferred = createDeferred<any>();
    vi.mocked(fetchSeed).mockReturnValue(seedDeferred.promise);
    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [
        {
          locale: 'es-ES',
          key: 'key-1',
          textHash: '["Hello","key-1"]',
          translation: 'Hola',
        },
      ],
      errors: [],
    });

    const htmlPromise = renderServer(
      <React.Suspense fallback={null}>
        <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-US" context="key-1">
          <T>Hello</T>
        </Ways>
      </React.Suspense>
    );

    await waitForCondition(() => {
      expect(vi.mocked(fetchSeed)).toHaveBeenCalledWith(['key-1'], 'es-ES', {
        origin: undefined,
      });
    });

    expect(vi.mocked(fetchTranslations)).not.toHaveBeenCalled();

    seedDeferred.resolve({
      data: {
        'key-1': {
          '["Hello","key-1"]': 'Hola',
        },
      },
    });

    const html = await htmlPromise;
    expect(html).toContain('Hola');
    const injectedPayload = extractInjectedStoreHydrationPayload(html) as {
      translations: Record<string, unknown>;
    };
    expect(Object.keys(injectedPayload.translations || {})).toContain('es-ES');
    expect(html).not.toContain('const next = {};');
    expect(vi.mocked(fetchTranslations)).not.toHaveBeenCalled();
  });

  it('stops blocking SSR after suspenseTimeoutMs and renders fallback text while translation work continues', async () => {
    const translationDeferred = createDeferred<any>();

    vi.mocked(fetchSeed).mockResolvedValue({ data: {} });
    vi.mocked(fetchTranslations).mockReturnValue(translationDeferred.promise);

    const html = await withTimeout(
      renderServer(
        <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-GB" suspenseTimeoutMs={25}>
          <Ways context="timeout-test">
            <T>Hello</T>
          </Ways>
        </Ways>
      ),
      400
    );

    expect(html).toContain('Hello');
    expect(html).not.toContain('Hola');
  });

  it('stops blocking SSR after suspenseTimeoutMs when runtime config is still loading', async () => {
    const configDeferred = createDeferred<any>();

    vi.mocked(fetchConfig).mockReturnValue(configDeferred.promise);
    vi.mocked(fetchSeed).mockResolvedValue({ data: {} });
    vi.mocked(fetchTranslations).mockResolvedValue({ data: [], errors: [] });

    const html = await withTimeout(
      renderServer(
        <Ways apiKey="test-api-key" locale="en-GB" baseLocale="en-GB" suspenseTimeoutMs={25}>
          <Ways context="config-timeout-test">
            <T>Hello</T>
          </Ways>
        </Ways>
      ),
      400
    );

    expect(html).toContain('Hello');
  });

  it('does not timeout server blocking while seed is pending', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seedDeferred = createDeferred<{ data: Record<string, Record<string, string>> }>();
    vi.mocked(fetchSeed).mockReturnValue(seedDeferred.promise);
    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [],
      errors: [],
    });

    try {
      const htmlPromise = renderServer(
        <React.Suspense fallback={null}>
          <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-US" context="key-1">
            <T>Hello</T>
          </Ways>
        </React.Suspense>
      );

      let didResolveHtml = false;
      void htmlPromise.then(() => {
        didResolveHtml = true;
      });

      await Promise.resolve();
      await Promise.resolve();

      expect(didResolveHtml).toBe(false);
      expect(
        warnSpy.mock.calls.some((call) => {
          const message = call[0];
          return (
            typeof message === 'string' && message.includes('Initial render blocker timed out')
          );
        })
      ).toBe(false);

      seedDeferred.resolve({
        data: {
          'key-1': {
            '["Hello","key-1"]': 'Hola',
          },
        },
      });

      const html = await htmlPromise;
      const didTimeout = warnSpy.mock.calls.some((call) => {
        const message = call[0];
        return typeof message === 'string' && message.includes('Initial render blocker timed out');
      });

      expect(html).toContain('Hola');
      expect(didTimeout).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('batches seed requests across contexts into a single call per locale', async () => {
    vi.mocked(fetchSeed).mockResolvedValue({
      data: {},
    });
    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [],
      errors: [],
    });

    await renderServer(
      <React.Suspense fallback={null}>
        <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-US">
          <Ways context="key-1">
            <T>Hello</T>
          </Ways>
          <Ways context="key-2">
            <T>World</T>
          </Ways>
        </Ways>
      </React.Suspense>
    );

    expect(vi.mocked(fetchSeed)).toHaveBeenCalledTimes(1);

    const [keys, locale] = vi.mocked(fetchSeed).mock.calls[0];
    expect(locale).toBe('es-ES');
    expect([...keys].sort()).toEqual(['key-1', 'key-2']);
  });

  it('falls back to translate on the server when seed misses', async () => {
    vi.mocked(fetchSeed).mockResolvedValue({
      data: {},
    });
    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [
        {
          locale: 'es-ES',
          key: 'key-1',
          textHash: '["Hello","key-1"]',
          translation: 'Hola',
        },
      ],
      errors: [],
    });

    const html = await renderServer(
      <React.Suspense fallback={null}>
        <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-US" context="key-1">
          <T>Hello</T>
        </Ways>
      </React.Suspense>
    );

    expect(html).toContain('Hola');
    expect(vi.mocked(fetchTranslations)).toHaveBeenCalledTimes(1);
  });

  it('does not stream source-text fallback for pending non-base locales in the server shell', async () => {
    const translationDeferred = createDeferred<any>();

    vi.mocked(fetchSeed).mockResolvedValue({
      data: {},
    });
    vi.mocked(fetchTranslations).mockReturnValue(translationDeferred.promise);

    const shellHtml = await renderServerShell(
      <React.Suspense fallback={null}>
        <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-GB">
          <Ways context="about">
            <T>About</T>
          </Ways>
        </Ways>
      </React.Suspense>
    );

    expect(shellHtml).not.toContain('About');

    translationDeferred.resolve({
      data: [
        {
          locale: 'es-ES',
          key: 'about',
          textHash: '["About","about"]',
          translation: 'Acerca de',
        },
      ],
      errors: [],
    });

    const html = await renderServer(
      <React.Suspense fallback={null}>
        <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-GB">
          <Ways context="about">
            <T>About</T>
          </Ways>
        </Ways>
      </React.Suspense>
    );

    expect(html).toContain('Acerca de');
  });

  it('still runs baseLocaleObservation calls during server render', async () => {
    vi.mocked(fetchSeed).mockResolvedValue({
      data: {},
    });
    vi.mocked(fetchKnown).mockResolvedValue({
      data: [],
      errors: [],
    });
    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [],
      errors: [],
    });

    const html = await renderServer(
      <React.Suspense fallback={null}>
        <Ways apiKey="test-api-key" locale="en-GB" baseLocale="en-GB" context="key-1">
          <T>Hello</T>
        </Ways>
      </React.Suspense>
    );

    expect(html).toContain('Hello');
    expect(vi.mocked(fetchKnown)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchTranslations).mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('resolves accepted locales during server render and injects them for hydration', async () => {
    vi.mocked(fetchConfig).mockResolvedValue({
      languages: [
        { code: 'en-GB', name: 'English' },
        { code: 'es-ES', name: 'Spanish' },
        { code: 'ja-JP', name: 'Japanese' },
      ],
      total: 3,
      translationFallback: {
        default: 'blank',
        overrides: [{ locale: 'ja-JP', fallback: 'key' }],
      },
    });
    vi.mocked(fetchSeed).mockResolvedValue({
      data: {},
    });
    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [],
      errors: [],
    });

    const html = await renderServer(
      <React.Suspense fallback={null}>
        <Ways apiKey="test-api-key" locale="en-GB" baseLocale="en-GB">
          <div>Test App</div>
        </Ways>
      </React.Suspense>
    );

    expect(fetchConfig).toHaveBeenCalledWith({ origin: undefined });
    expect(extractInjectedStoreHydrationPayload(html)).toEqual({
      translations: {},
      config: {
        acceptedLocales: ['en-GB', 'es-ES', 'ja-JP'],
        translationFallback: {
          default: 'blank',
          overrides: [{ locale: 'ja-JP', fallback: 'key' }],
        },
      },
    });
  });

  it('hydrates nested Ways roots without a recoverable script mismatch', async () => {
    vi.mocked(fetchSeed).mockResolvedValue({
      data: {
        'home-hero-demo': {
          '["Hello","home-hero-demo"]': 'Hola',
        },
      },
    });
    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [],
      errors: [],
    });

    const app = (
      <React.Suspense fallback={null}>
        <Ways
          apiKey="outer-api-key"
          locale="en-GB"
          baseLocale="en-GB"
          acceptedLocales={['en-GB', 'es-ES']}
        >
          <div>
            <Ways
              apiKey="inner-api-key"
              locale="es-ES"
              baseLocale="en-GB"
              acceptedLocales={['en-GB', 'es-ES']}
            >
              <Ways context="home-hero-demo">
                <T>Hello</T>
              </Ways>
            </Ways>
          </div>
        </Ways>
      </React.Suspense>
    );

    const html = await renderServer(app);
    expect(html).toContain('Hola');

    const dom = new JSDOM(`<!doctype html><html><body><div id="root">${html}</div></body></html>`, {
      runScripts: 'outside-only',
      url: 'http://localhost/',
    });
    executeInjectedScripts(dom);

    const container = dom.window.document.getElementById('root');
    if (!container) {
      throw new Error('Failed to create hydration container');
    }

    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('navigator', dom.window.navigator);
    vi.stubGlobal('self', dom.window);
    vi.stubGlobal('Node', dom.window.Node);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('MutationObserver', dom.window.MutationObserver);
    vi.stubGlobal('requestAnimationFrame', dom.window.requestAnimationFrame?.bind(dom.window));
    vi.stubGlobal('cancelAnimationFrame', dom.window.cancelAnimationFrame?.bind(dom.window));

    const recoverableErrors: string[] = [];

    try {
      const root = hydrateRoot(container, app, {
        onRecoverableError(error) {
          recoverableErrors.push(error.message);
        },
      });

      await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

      expect(recoverableErrors.some((message) => message.includes('Hydration failed'))).toBe(false);
      expect(container.textContent).toContain('Hola');
      await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
      root.unmount();
      await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    } finally {
      vi.unstubAllGlobals();
      dom.window.close();
    }
  });
});
