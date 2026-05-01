import { vi } from 'vitest';
import React from 'react';
import { render, RenderResult } from '@testing-library/react';
import { Ways } from '../index';
import { resetTestRuntimeState } from '../testing';

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
          <React.Suspense fallback={null}>
            <Ways context={effectiveContext}>{children}</Ways>
          </React.Suspense>
        </Ways>
      );
    }

    return (
      <Ways {...waysProps}>
        <React.Suspense fallback={null}>{children}</React.Suspense>
      </Ways>
    );
  };

  return render(ui, { wrapper: Wrapper });
}

/**
 * Clear all Ways-related state
 */
export function clearWaysState() {
  resetTestRuntimeState();
  delete window.__18WAYS_TRANSLATION_STORE__;
  vi.clearAllMocks();
}
