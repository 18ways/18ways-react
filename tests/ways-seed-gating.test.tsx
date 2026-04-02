// @vitest-environment node
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderToPipeableStream } from 'react-dom/server';
import { Writable } from 'node:stream';
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

const extractInjectedTranslationsPayload = (html: string): Record<string, unknown> => {
  const match = html.match(
    /const next = (.*?);\s+const target = window\.__18WAYS_IN_MEMORY_TRANSLATIONS__/s
  );
  if (!match?.[1]) {
    throw new Error('Could not find injected translations payload in SSR HTML');
  }
  return JSON.parse(match[1]) as Record<string, unknown>;
};

const extractInjectedAcceptedLocales = (html: string): string[] => {
  const match = html.match(/window\.__18WAYS_ACCEPTED_LOCALES__ = (\[.*?\]);/s);
  if (!match?.[1]) {
    throw new Error('Could not find injected accepted locales payload in SSR HTML');
  }
  return JSON.parse(match[1]) as string[];
};

const extractInjectedTranslationFallbackConfig = (html: string) => {
  const match = html.match(/window\.__18WAYS_TRANSLATION_FALLBACK_CONFIG__ = (\{.*?\});/s);
  if (!match?.[1]) {
    throw new Error('Could not find injected translation fallback config payload in SSR HTML');
  }
  return JSON.parse(match[1]) as { default: string; overrides: Array<unknown> };
};

describe('WaysRoot - Seed gating', () => {
  beforeEach(() => {
    resetServerInMemoryTranslations();
    resetTestRuntimeState();
    vi.clearAllMocks();
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
    const injectedPayload = extractInjectedTranslationsPayload(html);
    expect(Object.keys(injectedPayload)).toContain('es-ES');
    expect(html).not.toContain('const next = {};');
    expect(vi.mocked(fetchTranslations)).not.toHaveBeenCalled();
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

  it('does not make same-locale observation calls during server render', async () => {
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
    expect(vi.mocked(fetchKnown)).not.toHaveBeenCalled();
    expect(vi.mocked(fetchTranslations)).not.toHaveBeenCalled();
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
    expect(extractInjectedAcceptedLocales(html)).toEqual(['en-GB', 'es-ES', 'ja-JP']);
    expect(extractInjectedTranslationFallbackConfig(html)).toEqual({
      default: 'blank',
      overrides: [{ locale: 'ja-JP', fallback: 'key' }],
    });
  });
});
