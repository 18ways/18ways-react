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
    fetchConfig: vi.fn(async () => ({
      languages: [],
      total: 0,
      translationFallback: { default: 'source', overrides: [] },
    })),
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

const RepeatedSeededLocaleSwitchApp = () => {
  const [locale, setLocale] = useState('fr-FR');

  return (
    <Ways apiKey="test-api-key" locale={locale} baseLocale="en-GB">
      <button onClick={() => setLocale('ja-JP')}>Switch to ja</button>
      <button onClick={() => setLocale('es-ES')}>Switch to es</button>
      <button onClick={() => setLocale('fr-FR')}>Switch to fr</button>
      <Ways context="key-1">
        <T>Hello</T>
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

const StableScopeChild = ({ lifecycle }: { lifecycle: { mounts: number; unmounts: number } }) => {
  const mountId = React.useRef(`mount-${Math.random().toString(36).slice(2)}`);

  React.useEffect(() => {
    lifecycle.mounts += 1;

    return () => {
      lifecycle.unmounts += 1;
    };
  }, [lifecycle]);

  return <div data-testid="stable-scope-child">{mountId.current}</div>;
};

const StableScopeDuringLocaleChangeApp = ({
  lifecycle,
}: {
  lifecycle: { mounts: number; unmounts: number };
}) => {
  const [locale, setLocale] = useState('fr-FR');

  return (
    <Ways apiKey="test-api-key" locale={locale} baseLocale="en-GB">
      <button onClick={() => setLocale('ja-JP')}>Switch locale</button>
      <Ways context="key-1">
        <StableScopeChild lifecycle={lifecycle} />
        <T>Hello</T>
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
          '["Hello","key-1"]': 'Hello',
        },
      },
      'fr-FR': {
        'key-1': {
          '["Hello","key-1"]': 'Bonjour',
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
            textHash: '["Hello","key-1"]',
            translation: 'Hola',
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
            textHash: '["Hello","key-1"]',
            translation: 'こんにちは',
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
          '["Privacy settings","cookie-consent"]': 'プライバシー設定',
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

  it('updates correctly across repeated client locale changes when translations come from seed data', async () => {
    vi.mocked(fetchSeed).mockImplementation(async (_contextKeys, locale) => {
      if (locale === 'ja-JP') {
        return {
          data: {
            'key-1': {
              '["Hello","key-1"]': 'こんにちは',
            },
          },
        };
      }

      if (locale === 'es-ES') {
        return {
          data: {
            'key-1': {
              '["Hello","key-1"]': 'Hola',
            },
          },
        };
      }

      return { data: {} };
    });
    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [],
      errors: [],
    });

    render(<RepeatedSeededLocaleSwitchApp />);

    expect(screen.getByText('Bonjour')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Switch to ja'));
    await waitFor(() => {
      expect(screen.getByText('こんにちは')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Switch to es'));
    await waitFor(() => {
      expect(screen.getByText('Hola')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Switch to fr'));
    await waitFor(() => {
      expect(screen.getByText('Bonjour')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Switch to ja'));
    await waitFor(() => {
      expect(screen.getByText('こんにちは')).toBeInTheDocument();
    });

    expect(vi.mocked(fetchTranslations)).not.toHaveBeenCalled();
  });

  it('holds the previous locale across the page until every pending context for the next locale settles', async () => {
    const deferred = createDeferred<any>();

    window.__18WAYS_IN_MEMORY_TRANSLATIONS__ = {
      ...(window.__18WAYS_IN_MEMORY_TRANSLATIONS__ || {}),
      'fr-FR': {
        header: {
          '["Hello","header"]': 'Bonjour',
        },
        footer: {
          '["Goodbye","footer"]': 'Au revoir',
        },
      },
      'ja-JP': {
        header: {
          '["Hello","header"]': 'こんにちは',
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
            textHash: '["Goodbye","footer"]',
            translation: 'さようなら',
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

  it('keeps an already mounted Ways scope mounted while locale seed work is pending', async () => {
    const seedDeferred = createDeferred<any>();
    const translationDeferred = createDeferred<any>();
    const lifecycle = { mounts: 0, unmounts: 0 };

    vi.mocked(fetchSeed).mockReturnValue(seedDeferred.promise);
    vi.mocked(fetchTranslations).mockReturnValue(translationDeferred.promise);

    render(<StableScopeDuringLocaleChangeApp lifecycle={lifecycle} />);

    expect(screen.getByText('Bonjour')).toBeInTheDocument();
    expect(lifecycle).toEqual({ mounts: 1, unmounts: 0 });

    const initialMarker = screen.getByTestId('stable-scope-child');
    const initialMountId = initialMarker.textContent;

    fireEvent.click(screen.getByText('Switch locale'));

    await waitFor(() => {
      expect(fetchSeed).toHaveBeenCalledWith(['key-1'], 'ja-JP');
    });

    expect(screen.getByText('Bonjour')).toBeInTheDocument();
    expect(screen.getByTestId('stable-scope-child')).toBe(initialMarker);
    expect(screen.getByTestId('stable-scope-child').textContent).toBe(initialMountId);
    expect(lifecycle).toEqual({ mounts: 1, unmounts: 0 });

    await act(async () => {
      seedDeferred.resolve({
        data: {},
      });
      await seedDeferred.promise;
    });

    await waitFor(() => {
      expect(fetchTranslations).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByText('Bonjour')).toBeInTheDocument();
    expect(screen.getByTestId('stable-scope-child')).toBe(initialMarker);
    expect(screen.getByTestId('stable-scope-child').textContent).toBe(initialMountId);
    expect(lifecycle).toEqual({ mounts: 1, unmounts: 0 });

    await act(async () => {
      translationDeferred.resolve({
        data: [
          {
            locale: 'ja-JP',
            key: 'key-1',
            textHash: '["Hello","key-1"]',
            translation: 'こんにちは',
          },
        ],
        errors: [],
      });
      await translationDeferred.promise;
      await clearQueueForTests();
    });

    await waitFor(() => {
      expect(screen.getByText('こんにちは')).toBeInTheDocument();
    });

    expect(screen.getByTestId('stable-scope-child')).toBe(initialMarker);
    expect(screen.getByTestId('stable-scope-child').textContent).toBe(initialMountId);
    expect(lifecycle).toEqual({ mounts: 1, unmounts: 0 });
  });
});
