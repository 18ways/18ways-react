import React, { useState } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, screen, waitFor, act } from '@testing-library/react';
import { Ways, T, useTranslationLoading } from '../index';
import { fetchSeed, fetchTranslations } from '@18ways/core/common';
import { clearQueueForTests } from '../testing';

vi.mock('@18ways/core/common', async () => {
  const actual = await vi.importActual('@18ways/core/common');
  return {
    ...actual,
    fetchTranslations: vi.fn(),
    fetchSeed: vi.fn(),
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

const LoadingStatus = () => {
  const isLoading = useTranslationLoading();
  return <div data-testid="translation-loading">{isLoading ? 'loading' : 'idle'}</div>;
};

const LocaleLoadingApp = () => {
  const [locale, setLocale] = useState('en-GB');

  return (
    <Ways apiKey="test-api-key" locale={locale} baseLocale="en-GB">
      <button onClick={() => setLocale('es-ES')}>Switch locale</button>
      <Ways context="key-1">
        <LoadingStatus />
        <T>Hello</T>
      </Ways>
    </Ways>
  );
};

const KeyScopedLoadingApp = () => {
  const [locale, setLocale] = useState('en-GB');

  return (
    <Ways apiKey="test-api-key" locale={locale} baseLocale="en-GB">
      <button onClick={() => setLocale('es-ES')}>Switch locale</button>
      <Ways context="switcher">
        <LoadingStatus />
      </Ways>
      <Ways context="content">
        <T>Hello</T>
      </Ways>
    </Ways>
  );
};

describe('useTranslationLoading', () => {
  beforeEach(() => {
    window.__18WAYS_IN_MEMORY_TRANSLATIONS__ = {
      'en-GB': {
        'key-1': {
          '["Hello","key-1"]': ['Hello'],
        },
      },
    };
    vi.clearAllMocks();
    vi.mocked(fetchSeed).mockResolvedValue({ data: {} });
  });

  it('reports loading while locale-triggered translations are in flight', async () => {
    const deferred = createDeferred<any>();

    vi.mocked(fetchTranslations).mockReturnValue(deferred.promise);

    render(<LocaleLoadingApp />);

    expect(screen.getByTestId('translation-loading')).toHaveTextContent('idle');
    expect(screen.getByText('Hello')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Switch locale'));

    await waitFor(() => {
      expect(screen.getByTestId('translation-loading')).toHaveTextContent('loading');
    });

    await act(async () => {
      deferred.resolve({
        data: [
          {
            locale: 'es-ES',
            key: 'key-1',
            textsHash: '["Hello","key-1"]',
            translation: ['Hola'],
          },
        ],
        errors: [],
      });
      await deferred.promise;
      await clearQueueForTests();
    });

    await waitFor(() => {
      expect(screen.getByText('Hola')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByTestId('translation-loading')).toHaveTextContent('idle');
    });
  });

  it('does not report unrelated context loading as local loading', async () => {
    const deferred = createDeferred<any>();

    vi.mocked(fetchTranslations).mockReturnValue(deferred.promise);

    render(<KeyScopedLoadingApp />);

    expect(screen.getByTestId('translation-loading')).toHaveTextContent('idle');

    fireEvent.click(screen.getByText('Switch locale'));

    // Translation work is happening for "content", but this hook is mounted under "switcher".
    await waitFor(() => {
      expect(screen.getByTestId('translation-loading')).toHaveTextContent('idle');
    });
  });
});
