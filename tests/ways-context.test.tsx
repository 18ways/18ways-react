import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Ways, T, useT } from '../index';
import { fetchSeed, fetchTranslations } from '@18ways/core/common';
import { encryptTranslationValue } from '@18ways/core/crypto';
import { clearQueueForTests } from '../testing';

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
    fetchKnown: vi.fn().mockResolvedValue({ data: [], errors: [] }),
    fetchKnownContext: vi.fn().mockResolvedValue({ data: [], errors: [] }),
    fetchSeed: vi.fn(),
    fetchTranslations: vi.fn(),
    generateHashId: vi.fn((x) => JSON.stringify(x)),
  };
});

describe('WaysRoot - Context Nesting', () => {
  beforeEach(() => {
    delete window.__18WAYS_TRANSLATION_STORE__;
    vi.clearAllMocks();
    vi.mocked(fetchSeed).mockResolvedValue({ data: {} });
  });

  it('should isolate context keys properly', async () => {
    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [
        {
          locale: 'es-ES',
          key: 'context-1',
          textHash: '["Shared Text","context-1"]',
          translation: 'Contexto 1',
        },
        {
          locale: 'es-ES',
          key: 'context-2',
          textHash: '["Shared Text","context-2"]',
          translation: 'Contexto 2',
        },
      ],
      errors: [],
    });

    render(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-US">
        <Ways context="context-1">
          <div data-testid="context-1">
            <T>Shared Text</T>
          </div>
        </Ways>
        <Ways context="context-2">
          <div data-testid="context-2">
            <T>Shared Text</T>
          </div>
        </Ways>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    const context1 = screen.getByTestId('context-1');
    const context2 = screen.getByTestId('context-2');

    expect(context1).toHaveTextContent('Contexto 1');
    expect(context2).toHaveTextContent('Contexto 2');
  });

  it('should handle context without key', async () => {
    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [
        {
          locale: 'es-ES',
          key: 'default-key',
          textHash: '["No Context","default-key"]',
          translation: 'Sin Contexto',
        },
      ],
      errors: [],
    });

    render(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-US">
        <Ways context="default-key">
          <T>No Context</T>
        </Ways>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    expect(await screen.findByText('Sin Contexto')).toBeInTheDocument();
  });

  it('should handle overlapping context with different locales', async () => {
    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [
        {
          locale: 'es-ES',
          key: 'greeting',
          textHash: '["Hello","greeting"]',
          translation: 'Hola',
        },
        {
          locale: 'fr-FR',
          key: 'greeting',
          textHash: '["Hello","greeting"]',
          translation: 'Bonjour',
        },
      ],
      errors: [],
    });

    render(
      <Ways apiKey="test-api-key" locale="en-GB" baseLocale="en-GB">
        <Ways context="greeting" locale="es-ES">
          <div data-testid="spanish">
            <T>Hello</T>
          </div>
        </Ways>
        <Ways context="greeting" locale="fr-FR">
          <div data-testid="french">
            <T>Hello</T>
          </div>
        </Ways>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    expect(screen.getByTestId('spanish')).toHaveTextContent('Hola');
    expect(screen.getByTestId('french')).toHaveTextContent('Bonjour');
  });

  it('keeps the outer tree visible while a nested WaysRoot subtree resolves', async () => {
    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [
        {
          locale: 'es-ES',
          key: 'nested-hero',
          textHash: '["Nested hero","nested-hero"]',
          translation: 'Hero anidado',
        },
      ],
      errors: [],
    });

    const NestedHero = () => {
      return (
        <div data-testid="nested-hero">
          <T>Nested hero</T>
        </div>
      );
    };

    render(
      <Ways apiKey="test-api-key" locale="en-GB" baseLocale="en-GB">
        <div data-testid="outer-shell">Outer shell</div>
        <React.Suspense fallback={null}>
          <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-GB" persistLocaleCookie={false}>
            <Ways context="nested-hero">
              <NestedHero />
            </Ways>
          </Ways>
        </React.Suspense>
      </Ways>
    );

    expect(screen.getByTestId('outer-shell')).toHaveTextContent('Outer shell');
    expect(screen.queryByTestId('nested-hero')).not.toBeInTheDocument();

    await act(async () => {
      await clearQueueForTests();
    });

    expect(screen.getByTestId('outer-shell')).toHaveTextContent('Outer shell');
    expect(screen.getByTestId('nested-hero')).toHaveTextContent('Hero anidado');
  });

  it('should handle context with baseLocale override', async () => {
    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [
        {
          locale: 'es-ES',
          key: 'test',
          textHash: '["Test","test"]',
          translation: 'Prueba',
        },
      ],
      errors: [],
    });

    render(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="fr-FR">
        <Ways context="test" baseLocale="en-US">
          <T>Test</T>
        </Ways>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    expect(await screen.findByText('Prueba')).toBeInTheDocument();
    expect(vi.mocked(fetchTranslations)).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          baseLocale: 'en-US',
          targetLocale: 'es-ES',
        }),
      ]),
      { origin: undefined }
    );
  });

  it('supports a nested WaysRoot with its own selected locale session', async () => {
    vi.mocked(fetchTranslations).mockImplementation(async (entries) => ({
      data: entries.map((entry) => ({
        locale: entry.targetLocale,
        key: entry.key,
        textHash: entry.textHash,
        translation:
          entry.targetLocale === 'es-ES'
            ? entry.text === 'Inner hello'
              ? 'Hola interior'
              : 'Hola'
            : entry.text === 'Outer hello'
              ? 'Bonjour extérieur'
              : 'Bonjour',
      })),
      errors: [],
    }));

    render(
      <Ways apiKey="test-api-key" locale="fr-FR" baseLocale="en-US">
        <Ways context="outer">
          <div data-testid="outer-copy">
            <T>Outer hello</T>
          </div>
        </Ways>

        <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-US" persistLocaleCookie={false}>
          <Ways context="inner">
            <div data-testid="inner-copy">
              <T>Inner hello</T>
            </div>
          </Ways>
        </Ways>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    expect(screen.getByTestId('outer-copy')).toHaveTextContent('Bonjour extérieur');
    expect(screen.getByTestId('inner-copy')).toHaveTextContent('Hola interior');

    const fetchTranslationsMock = fetchTranslations as unknown as {
      mock: {
        calls: Array<[Array<{ targetLocale: string }>]>;
      };
    };
    const requestedLocales = fetchTranslationsMock.mock.calls.flatMap(([entries]) =>
      entries.map((entry) => entry.targetLocale)
    );

    expect(requestedLocales).toEqual(expect.arrayContaining(['fr-FR', 'es-ES']));
  });

  it('attaches a context fingerprint and metadata to translation requests', async () => {
    vi.mocked(fetchTranslations).mockResolvedValue({ data: [], errors: [] });

    render(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-US">
        <React.Suspense fallback={null}>
          <Ways context="cta">
            <main id="shell" className="layout" data-testid="shell-root">
              <section id="hero" aria-label="hero area">
                <div className="wrapper">
                  <div>
                    <div role="group">
                      <button>
                        <T context="button-label">Open</T>
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            </main>
          </Ways>
        </React.Suspense>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    const payload = vi.mocked(fetchTranslations).mock.calls[0]?.[0]?.[0];

    expect(vi.mocked(fetchTranslations)).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'cta.button-label',
          text: 'Open',
          contextMetadata: expect.objectContaining({
            name: 'cta.button-label',
            label: '',
            treePath: '',
            filePath: '',
          }),
        }),
      ]),
      { origin: undefined }
    );

    expect(payload?.contextFingerprint).toBe(JSON.stringify(payload?.contextMetadata));
  });

  it('merges parent and local object context metadata when using t(...) directly', async () => {
    vi.mocked(fetchTranslations).mockResolvedValue({ data: [], errors: [] });

    const DirectT: React.FC = () => {
      const t = useT();
      return (
        <a href="https://example.com/open" data-testid="direct-link">
          {t('Open', {
            context: {
              name: 'leaf',
              description: 'leaf context',
              treePath: '#my-id > a > span',
              filePath: 'src/components/nav/Nav.tsx',
            },
          })}
        </a>
      );
    };

    render(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-US">
        <React.Suspense fallback={null}>
          <Ways context={{ name: 'root', description: 'root context' }}>
            <Ways context={{ name: 'nav', description: 'nav context' }}>
              <div id="nav">
                <DirectT />
              </div>
            </Ways>
          </Ways>
        </React.Suspense>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    expect(vi.mocked(fetchTranslations)).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'root.nav.leaf',
          text: 'Open',
          contextMetadata: expect.objectContaining({
            name: 'root.nav.leaf',
            label: 'root context\n\nnav context\n\nleaf context',
            treePath: '#my-id > a > span',
            filePath: 'src/components/nav/Nav.tsx',
          }),
        }),
      ]),
      { origin: undefined }
    );
  });

  it('captures a base-locale view once per context fingerprint', async () => {
    const key = 'cta.button-label';
    const textHash = '["Open","cta.button-label"]';
    const encryptedTranslation = encryptTranslationValue({
      translatedText: 'Open',
      sourceText: 'Open',
      locale: 'en-US',
      key,
      textHash,
    });

    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [
        {
          locale: 'en-US',
          key,
          textHash,
          contextFingerprint: JSON.stringify({
            name: key,
            label: '',
            treePath: '',
            filePath: '',
          }),
          translationId: 'group-1',
          translation: encryptedTranslation,
        },
      ],
      errors: [],
    });

    const { rerender } = render(
      <Ways apiKey="test-api-key" locale="en-US" baseLocale="en-US" context="cta">
        <T context="button-label">Open</T>
      </Ways>
    );

    expect(screen.getByText('Open')).toBeInTheDocument();

    await act(async () => {
      await clearQueueForTests();
    });

    expect(vi.mocked(fetchTranslations)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchTranslations).mock.calls[0]?.[0]?.[0]).toEqual(
      expect.objectContaining({
        key,
        textHash,
        baseLocale: 'en-US',
        targetLocale: 'en-US',
        contextFingerprint: JSON.stringify({
          name: key,
          label: '',
          treePath: '',
          filePath: '',
        }),
      })
    );

    rerender(
      <Ways apiKey="test-api-key" locale="en-US" baseLocale="en-US" context="cta">
        <T context="button-label">Open</T>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    expect(vi.mocked(fetchTranslations)).toHaveBeenCalledTimes(1);
  });
});
