import { vi } from 'vitest';
import React from 'react';
import { render, RenderResult, act } from '@testing-library/react';
import { Ways } from '../index';
import { fetchTranslations } from '@18ways/core/common';
import { clearQueueForTests, resetTestRuntimeState } from '../testing';

/**
 * Mock fetchTranslations with provided translations
 */
export function mockTranslations(translations: Record<string, Record<string, string>>) {
  const mockFetch = fetchTranslations as ReturnType<typeof vi.fn>;
  mockFetch.mockResolvedValue(translations);
}

/**
 * Mock fetchTranslations with API response format
 */
export function mockTranslationsAPI(
  data: Array<{
    locale: string;
    key: string;
    textHash: string;
    translation: string;
  }>,
  errors: any[] = []
) {
  const mockFetch = fetchTranslations as ReturnType<typeof vi.fn>;
  mockFetch.mockResolvedValue({ data, errors });
}

/**
 * Render component with Ways providers
 */
export function renderWithWays(
  ui: React.ReactElement,
  options: {
    apiKey?: string;
    locale?: string;
    defaultLocale?: string;
    baseLocale?: string;
    context?: string;
    contextKey?: string;
  } = {}
): RenderResult {
  const {
    apiKey = 'test-api-key',
    locale,
    defaultLocale,
    baseLocale = 'en-US',
    context,
    contextKey,
  } = options;

  const Wrapper = ({ children }: { children: React.ReactNode }) => {
    const effectiveLocale = locale || defaultLocale || baseLocale;
    const waysProps: any = {
      apiKey,
      locale: effectiveLocale,
      baseLocale,
    };

    const effectiveContext = context || contextKey;
    if (effectiveContext) {
      return (
        <Ways {...waysProps}>
          <Ways context={effectiveContext}>{children}</Ways>
        </Ways>
      );
    }

    return <Ways {...waysProps}>{children}</Ways>;
  };

  return render(ui, { wrapper: Wrapper });
}

/**
 * Clear all Ways-related state
 */
export function clearWaysState() {
  resetTestRuntimeState();
  delete window.__18WAYS_ACCEPTED_LOCALES__;
  delete window.__18WAYS_IN_MEMORY_TRANSLATIONS__;
  delete window.__18WAYS_TRANSLATION_FALLBACK_CONFIG__;
  vi.clearAllMocks();
}

/**
 * Create a mock translation response for testing
 */
export function createMockTranslation(
  locale: string,
  key: string,
  translation: string,
  contextKey?: string
) {
  const textHash = contextKey ? `["${key}","${contextKey}"]` : `["${key}"]`;

  return {
    locale,
    key: contextKey || '',
    textHash,
    translation,
  };
}

/**
 * Setup common mocks for testing
 */
export function setupCommonMocks() {
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
      fetchSeed: vi.fn(),
      fetchTranslations: vi.fn(),
      generateHashId: vi.fn((x) => JSON.stringify(x)),
    };
  });
}

/**
 * Create translations for multiple locales
 */
export function createMultiLocaleTranslations(
  translations: Record<string, Record<string, string>>
) {
  return Object.entries(translations).reduce(
    (acc, [locale, trans]) => {
      acc[locale] = trans;
      return acc;
    },
    {} as Record<string, Record<string, string>>
  );
}

/**
 * Wait for translations to load
 */
export async function waitForTranslations() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await act(async () => {
    await clearQueueForTests();
  });
}
