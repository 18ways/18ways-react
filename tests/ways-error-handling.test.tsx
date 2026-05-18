import React from 'react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { Ways, T, LanguageSwitcher } from '../index';
import { fetchTranslations, fetchSeed } from '@18ways/core/common';
import { clearQueueForTests, resetTestRuntimeState } from '../testing';

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
    fetchTranslations: vi.fn(),
    fetchSeed: vi.fn(),
    generateHashId: vi.fn((x) => JSON.stringify(x)),
  };
});

describe('WaysRoot - Error Handling', () => {
  beforeEach(() => {
    resetTestRuntimeState();
    delete window.__18WAYS_TRANSLATION_STORE__;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retries missing target-locale translations after a full remount', async () => {
    vi.mocked(fetchSeed).mockResolvedValue({ data: {} });
    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [],
      errors: [
        {
          locale: 'es-ES',
          key: 'retry-key',
          textHash: '["Retry me","retry-key"]',
        },
      ],
    });

    const firstRender = render(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-US">
        <React.Suspense fallback={null}>
          <Ways context="retry-key">
            <T>Retry me</T>
          </Ways>
        </React.Suspense>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    expect(screen.getByText('Retry me')).toBeInTheDocument();
    expect(vi.mocked(fetchTranslations)).toHaveBeenCalledTimes(1);

    firstRender.unmount();
    resetTestRuntimeState();
    delete window.__18WAYS_TRANSLATION_STORE__;

    render(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-US">
        <React.Suspense fallback={null}>
          <Ways context="retry-key">
            <T>Retry me</T>
          </Ways>
        </React.Suspense>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    expect(vi.mocked(fetchTranslations)).toHaveBeenCalledTimes(2);
  });

  it('should handle network failure gracefully', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // fetchTranslations catches errors and returns an error result, it doesn't throw
    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [],
      errors: [
        {
          locale: 'es-ES',
          key: 'test-key',
          textHash: '["Hello World","test-key"]',
        },
      ],
    });

    render(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-US">
        <React.Suspense fallback={null}>
          <Ways context="test-key">
            <T>Hello World</T>
          </Ways>
        </React.Suspense>
      </Ways>
    );

    await waitFor(() => {
      expect(screen.getByText('Hello World')).toBeInTheDocument();
    });

    await act(async () => {
      await clearQueueForTests();
    });

    await waitFor(() => {
      expect(consoleWarnSpy).toHaveBeenCalledWith('Some translations failed');
    });

    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('shuts down translations after a seed billing block', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.mocked(fetchSeed).mockResolvedValue({
      data: {},
      errors: [{ reason: 'Request would exceed your Free plan limit of 1000 words.' }],
      billingBlocked: true,
      billingBlockedMessage: 'Request would exceed your Free plan limit of 1000 words.',
    });
    vi.mocked(fetchTranslations).mockResolvedValue({ data: [], errors: [] });

    const { rerender } = render(
      <Ways
        apiKey="test-api-key"
        locale="es-ES"
        baseLocale="en-US"
        acceptedLocales={['en-US', 'es-ES']}
      >
        <React.Suspense fallback={null}>
          <Ways context="billing-key">
            <LanguageSwitcher />
            <T>Hello Billing</T>
          </Ways>
        </React.Suspense>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    expect(screen.getByText('Hello Billing')).toBeInTheDocument();
    expect(vi.mocked(fetchSeed)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchTranslations)).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0]?.[0]).toContain('Translation has been disabled');
    expect(document.querySelector('button[aria-haspopup="listbox"]')).toBeDisabled();

    rerender(
      <Ways
        apiKey="test-api-key"
        locale="es-ES"
        baseLocale="en-US"
        acceptedLocales={['en-US', 'es-ES']}
      >
        <React.Suspense fallback={null}>
          <Ways context="billing-key">
            <LanguageSwitcher />
            <T>Hello Billing</T>
            <T>Another string</T>
          </Ways>
        </React.Suspense>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    expect(document.body).toHaveTextContent('Another string');
    expect(vi.mocked(fetchSeed)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchTranslations)).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

    consoleErrorSpy.mockRestore();
  });

  it('shuts down translations after a translate billing block', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.mocked(fetchSeed).mockResolvedValue({ data: {} });
    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [],
      errors: [
        {
          locale: 'es-ES',
          key: 'billing-key',
          textHash: '["Translate Billing","billing-key"]',
        },
      ],
      billingBlocked: true,
      billingBlockedMessage: 'Request requires additional word credits.',
    });

    const { rerender } = render(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-US">
        <React.Suspense fallback={null}>
          <Ways context="billing-key">
            <T>Translate Billing</T>
          </Ways>
        </React.Suspense>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    expect(screen.getByText('Translate Billing')).toBeInTheDocument();
    expect(vi.mocked(fetchSeed)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchTranslations)).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

    rerender(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-US">
        <React.Suspense fallback={null}>
          <Ways context="billing-key">
            <T>Translate Billing</T>
            <T>After block</T>
          </Ways>
        </React.Suspense>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    expect(document.body).toHaveTextContent('After block');
    expect(vi.mocked(fetchSeed)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchTranslations)).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

    consoleErrorSpy.mockRestore();
  });
  it('should suppress immediate retries after translate failures', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [],
      errors: [
        {
          locale: 'es-ES',
          key: 'test-key',
          textHash: '["Error Text","test-key"]',
        },
      ],
    });

    const { rerender } = render(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-US">
        <React.Suspense fallback={null}>
          <Ways context="test-key">
            <T>Error Text</T>
          </Ways>
        </React.Suspense>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    await waitFor(() => {
      expect(vi.mocked(fetchTranslations)).toHaveBeenCalledTimes(1);
    });

    rerender(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-US">
        <React.Suspense fallback={null}>
          <Ways context="test-key">
            <T>Error Text</T>
          </Ways>
        </React.Suspense>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    await waitFor(() => {
      expect(vi.mocked(fetchTranslations)).toHaveBeenCalledTimes(1);
    });

    consoleWarnSpy.mockRestore();
  });

  it('should not immediately retry when a translate response acknowledges the request without a translation', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    vi.mocked(fetchSeed).mockResolvedValue({ data: {} });
    vi.mocked(fetchTranslations)
      .mockResolvedValueOnce({
        data: [
          {
            locale: 'es-ES',
            key: 'null-translation-key',
            textHash: '["Null Translation","null-translation-key"]',
            translationId: 'translation-null-1',
            translation: null,
          },
        ],
        errors: [],
      })
      .mockResolvedValue({
        data: [],
        errors: [
          {
            locale: 'es-ES',
            key: 'null-translation-key',
            textHash: '["Null Translation","null-translation-key"]',
          },
        ],
      });

    const tree = (
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-US">
        <React.Suspense fallback={null}>
          <Ways context="null-translation-key">
            <T>Null Translation</T>
          </Ways>
        </React.Suspense>
      </Ways>
    );
    const { rerender } = render(tree);

    await act(async () => {
      await clearQueueForTests();
    });

    expect(vi.mocked(fetchTranslations)).toHaveBeenCalledTimes(1);

    rerender(tree);
    await act(async () => {
      await clearQueueForTests();
    });

    expect(vi.mocked(fetchTranslations)).toHaveBeenCalledTimes(1);
    consoleWarnSpy.mockRestore();
  });

  it('should avoid infinite retries when API response does not acknowledge requested locale', async () => {
    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [
        {
          locale: 'es-ES',
          key: 'test-key',
          textHash: '["Locale Mismatch","test-key"]',
          translation: 'Desajuste de idioma',
        },
      ],
      errors: [],
    });

    const { rerender } = render(
      <Ways apiKey="test-api-key" locale="ja-JP" baseLocale="en-US">
        <React.Suspense fallback={null}>
          <Ways context="test-key">
            <T>Locale Mismatch</T>
          </Ways>
        </React.Suspense>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    expect(vi.mocked(fetchTranslations)).toHaveBeenCalledTimes(1);

    rerender(
      <Ways apiKey="test-api-key" locale="ja-JP" baseLocale="en-US">
        <React.Suspense fallback={null}>
          <Ways context="test-key">
            <T>Locale Mismatch</T>
          </Ways>
        </React.Suspense>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    expect(vi.mocked(fetchTranslations)).toHaveBeenCalledTimes(1);
  });
});
