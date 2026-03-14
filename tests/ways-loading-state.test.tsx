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
    fetchAcceptedLocales: vi.fn(async (fallbackLocale?: string) => [fallbackLocale || 'en-GB']),
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

const PreviousLocaleFallbackApp = () => {
  const [locale, setLocale] = useState('fr-FR');

  return (
    <Ways apiKey="test-api-key" locale={locale} baseLocale="en-GB">
      <button onClick={() => setLocale('ja-JP')}>Switch locale</button>
      <Ways context="key-1">
        <T>Hello</T>
      </Ways>
    </Ways>
  );
};

const PreviousLocalePartialFallbackApp = () => {
  const [locale, setLocale] = useState('fr-FR');

  return (
    <Ways apiKey="test-api-key" locale={locale} baseLocale="en-GB">
      <button onClick={() => setLocale('ja-JP')}>Switch locale</button>
      <Ways context="key-1">
        <>
          <T>Hello</T>
          <T>Goodbye</T>
        </>
      </Ways>
    </Ways>
  );
};

const CachedLocaleReturnApp = () => {
  const [locale, setLocale] = useState('fr-FR');

  return (
    <Ways apiKey="test-api-key" locale={locale} baseLocale="en-GB">
      <button onClick={() => setLocale('ja-JP')}>Switch locale</button>
      <Ways context="cookie-consent">
        <LoadingStatus />
        <T>Privacy settings</T>
      </Ways>
    </Ways>
  );
};

const PageWideAtomicTransitionApp = () => {
  const [locale, setLocale] = useState('fr-FR');

  return (
    <Ways apiKey="test-api-key" locale={locale} baseLocale="en-GB">
      <button onClick={() => setLocale('ja-JP')}>Switch locale</button>
      <Ways context="header">
        <T>Hello</T>
      </Ways>
      <Ways context="footer">
        <T>Goodbye</T>
      </Ways>
    </Ways>
  );
};

const getBodyText = () => document.body.textContent || '';

describe('useTranslationLoading', () => {
  beforeEach(() => {
    window.__18WAYS_IN_MEMORY_TRANSLATIONS__ = {
      'en-GB': {
        'key-1': {
          '["Hello","key-1"]': ['Hello'],
        },
      },
      'fr-FR': {
        'key-1': {
          '["Hello","key-1"]': ['Bonjour'],
          '["Hello","Goodbye","key-1"]': ['Bonjour'],
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

  it('keeps the previous locale visible while the next locale is still loading', async () => {
    const deferred = createDeferred<any>();

    vi.mocked(fetchTranslations).mockReturnValue(deferred.promise);

    render(<PreviousLocaleFallbackApp />);

    expect(screen.getByText('Bonjour')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Switch locale'));

    await waitFor(() => {
      expect(screen.getByText('Bonjour')).toBeInTheDocument();
    });

    expect(screen.queryByText('Hello')).not.toBeInTheDocument();

    await act(async () => {
      deferred.resolve({
        data: [
          {
            locale: 'ja-JP',
            key: 'key-1',
            textsHash: '["Hello","key-1"]',
            translation: ['こんにちは'],
          },
        ],
        errors: [],
      });
      await deferred.promise;
      await clearQueueForTests();
    });

    await waitFor(() => {
      expect(screen.getByText('こんにちは')).toBeInTheDocument();
    });
  });

  it('falls back per string from previous locale to base text while the next locale is loading', async () => {
    const deferred = createDeferred<any>();

    vi.mocked(fetchTranslations).mockReturnValue(deferred.promise);

    render(<PreviousLocalePartialFallbackApp />);

    expect(getBodyText()).toContain('Bonjour');
    expect(getBodyText()).toContain('Goodbye');

    fireEvent.click(screen.getByText('Switch locale'));

    await waitFor(() => {
      expect(getBodyText()).toContain('Bonjour');
      expect(getBodyText()).toContain('Goodbye');
    });

    expect(getBodyText()).not.toContain('Hello');
  });

  it('does not create a pending seed when switching to a locale that is already cached for the context', async () => {
    window.__18WAYS_IN_MEMORY_TRANSLATIONS__ = {
      ...(window.__18WAYS_IN_MEMORY_TRANSLATIONS__ || {}),
      'ja-JP': {
        'cookie-consent': {
          '["Privacy settings","cookie-consent"]': ['プライバシー設定'],
        },
      },
    };

    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [],
      errors: [],
    });

    render(<CachedLocaleReturnApp />);

    fireEvent.click(screen.getByText('Switch locale'));

    await waitFor(() => {
      expect(screen.getByText('プライバシー設定')).toBeInTheDocument();
    });

    expect(screen.getByTestId('translation-loading')).toHaveTextContent('idle');
    expect(vi.mocked(fetchSeed)).not.toHaveBeenCalled();
  });

  it('holds the previous locale across the page until every pending context for the next locale settles', async () => {
    const deferred = createDeferred<any>();

    window.__18WAYS_IN_MEMORY_TRANSLATIONS__ = {
      ...(window.__18WAYS_IN_MEMORY_TRANSLATIONS__ || {}),
      'fr-FR': {
        header: {
          '["Hello","header"]': ['Bonjour'],
        },
        footer: {
          '["Goodbye","footer"]': ['Au revoir'],
        },
      },
      'ja-JP': {
        header: {
          '["Hello","header"]': ['こんにちは'],
        },
      },
    };

    vi.mocked(fetchTranslations).mockReturnValue(deferred.promise);

    render(<PageWideAtomicTransitionApp />);

    expect(getBodyText()).toContain('Bonjour');
    expect(getBodyText()).toContain('Au revoir');

    fireEvent.click(screen.getByText('Switch locale'));

    await waitFor(() => {
      expect(fetchTranslations).toHaveBeenCalledTimes(1);
    });

    expect(getBodyText()).toContain('Bonjour');
    expect(getBodyText()).toContain('Au revoir');
    expect(getBodyText()).not.toContain('こんにちは');

    await act(async () => {
      deferred.resolve({
        data: [
          {
            locale: 'ja-JP',
            key: 'footer',
            textsHash: '["Goodbye","footer"]',
            translation: ['さようなら'],
          },
        ],
        errors: [],
      });
      await deferred.promise;
      await clearQueueForTests();
    });

    await waitFor(() => {
      expect(getBodyText()).toContain('こんにちは');
      expect(getBodyText()).toContain('さようなら');
    });
  });
});
