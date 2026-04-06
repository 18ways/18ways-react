import React, { startTransition, useState } from 'react';
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
    fetchKnown: vi.fn().mockResolvedValue({ data: [], errors: [] }),
    fetchKnownContext: vi.fn().mockResolvedValue({ data: [], errors: [] }),
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

const setWindowTranslationStore = (
  translations: Record<string, Record<string, Record<string, string>>>,
  acceptedLocales: string[] = []
) => {
  window.__18WAYS_TRANSLATION_STORE__ = {
    translations,
    config: {
      acceptedLocales,
      translationFallback: { default: 'source', overrides: [] },
    },
  };
};

const getWindowTranslations = (): Record<string, Record<string, Record<string, string>>> =>
  (window.__18WAYS_TRANSLATION_STORE__?.translations as Record<
    string,
    Record<string, Record<string, string>>
  >) || {};

const LoadingStatus = () => {
  const isLoading = useTranslationLoading();
  return <div data-testid="translation-loading">{isLoading ? 'loading' : 'idle'}</div>;
};

const getVisibleTranslationLoading = () => {
  const visible = screen
    .getAllByTestId('translation-loading')
    .find((element) => (element as HTMLElement).style.display !== 'none');

  if (!visible) {
    throw new Error('Could not find a visible translation-loading element');
  }

  return visible;
};

const getVisibleStableScopeChild = () => {
  const visible = screen
    .getAllByTestId('stable-scope-child')
    .find((element) => (element as HTMLElement).style.display !== 'none');

  if (!visible) {
    throw new Error('Could not find a visible stable-scope-child element');
  }

  return visible;
};

const LocaleLoadingApp = () => {
  const [locale, setLocale] = useState('en-GB');

  return (
    <Ways apiKey="test-api-key" locale={locale} baseLocale="en-GB">
      <React.Suspense fallback={null}>
        <button
          onClick={() => {
            startTransition(() => {
              setLocale('es-ES');
            });
          }}
        >
          Switch locale
        </button>
        <Ways context="key-1">
          <LoadingStatus />
          <T>Hello</T>
        </Ways>
      </React.Suspense>
    </Ways>
  );
};

const KeyScopedLoadingApp = () => {
  const [locale, setLocale] = useState('en-GB');

  return (
    <Ways apiKey="test-api-key" locale={locale} baseLocale="en-GB">
      <React.Suspense fallback={null}>
        <button
          onClick={() => {
            startTransition(() => {
              setLocale('es-ES');
            });
          }}
        >
          Switch locale
        </button>
        <Ways context="switcher">
          <LoadingStatus />
        </Ways>
        <Ways context="content">
          <T>Hello</T>
        </Ways>
      </React.Suspense>
    </Ways>
  );
};

const PreviousLocaleFallbackApp = () => {
  const [locale, setLocale] = useState('fr-FR');

  return (
    <Ways apiKey="test-api-key" locale={locale} baseLocale="en-GB">
      <React.Suspense fallback={null}>
        <button
          onClick={() => {
            startTransition(() => {
              setLocale('ja-JP');
            });
          }}
        >
          Switch locale
        </button>
        <Ways context="key-1">
          <T>Hello</T>
        </Ways>
      </React.Suspense>
    </Ways>
  );
};

const RootPreviousLocaleFallbackApp = () => {
  const [locale, setLocale] = useState('fr-FR');

  return (
    <Ways apiKey="test-api-key" locale={locale} baseLocale="en-GB">
      <button
        onClick={() => {
          startTransition(() => {
            setLocale('ja-JP');
          });
        }}
      >
        Switch locale
      </button>
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
      <React.Suspense fallback={null}>
        <button
          onClick={() => {
            startTransition(() => {
              setLocale('ja-JP');
            });
          }}
        >
          Switch locale
        </button>
        <Ways context="key-1">
          <>
            <T>Hello</T>
            <T>Goodbye</T>
          </>
        </Ways>
      </React.Suspense>
    </Ways>
  );
};

const CachedLocaleReturnApp = () => {
  const [locale, setLocale] = useState('fr-FR');

  return (
    <Ways apiKey="test-api-key" locale={locale} baseLocale="en-GB">
      <React.Suspense fallback={null}>
        <button
          onClick={() => {
            startTransition(() => {
              setLocale('ja-JP');
            });
          }}
        >
          Switch locale
        </button>
        <Ways context="cookie-consent">
          <LoadingStatus />
          <T>Privacy settings</T>
        </Ways>
      </React.Suspense>
    </Ways>
  );
};

const RepeatedSeededLocaleSwitchApp = () => {
  const [locale, setLocale] = useState('fr-FR');

  return (
    <Ways apiKey="test-api-key" locale={locale} baseLocale="en-GB">
      <React.Suspense fallback={null}>
        <button
          onClick={() => {
            startTransition(() => {
              setLocale('ja-JP');
            });
          }}
        >
          Switch to ja
        </button>
        <button
          onClick={() => {
            startTransition(() => {
              setLocale('es-ES');
            });
          }}
        >
          Switch to es
        </button>
        <button
          onClick={() => {
            startTransition(() => {
              setLocale('fr-FR');
            });
          }}
        >
          Switch to fr
        </button>
        <Ways context="key-1">
          <T>Hello</T>
        </Ways>
      </React.Suspense>
    </Ways>
  );
};

const PageWideAtomicTransitionApp = () => {
  const [locale, setLocale] = useState('fr-FR');

  return (
    <Ways apiKey="test-api-key" locale={locale} baseLocale="en-GB">
      <React.Suspense fallback={null}>
        <button
          onClick={() => {
            startTransition(() => {
              setLocale('ja-JP');
            });
          }}
        >
          Switch locale
        </button>
        <Ways context="header">
          <T>Hello</T>
        </Ways>
        <Ways context="footer">
          <T>Goodbye</T>
        </Ways>
      </React.Suspense>
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
      <React.Suspense fallback={null}>
        <button
          onClick={() => {
            startTransition(() => {
              setLocale('ja-JP');
            });
          }}
        >
          Switch locale
        </button>
        <Ways context="key-1">
          <StableScopeChild lifecycle={lifecycle} />
          <T>Hello</T>
        </Ways>
      </React.Suspense>
    </Ways>
  );
};

const RootStableScopeDuringLocaleChangeApp = ({
  lifecycle,
}: {
  lifecycle: { mounts: number; unmounts: number };
}) => {
  const [locale, setLocale] = useState('fr-FR');

  return (
    <Ways apiKey="test-api-key" locale={locale} baseLocale="en-GB">
      <button
        onClick={() => {
          startTransition(() => {
            setLocale('ja-JP');
          });
        }}
      >
        Switch locale
      </button>
      <Ways context="key-1">
        <StableScopeChild lifecycle={lifecycle} />
        <T>Hello</T>
      </Ways>
    </Ways>
  );
};

const NavigationTransitionApp = () => {
  const [page, setPage] = useState<'home' | 'about'>('home');

  return (
    <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-GB">
      <button
        onClick={() => {
          startTransition(() => {
            setPage('about');
          });
        }}
      >
        Navigate
      </button>
      {page === 'home' ? (
        <Ways context="home">
          <T>Home</T>
        </Ways>
      ) : (
        <Ways context="about">
          <T>About</T>
        </Ways>
      )}
    </Ways>
  );
};

const TimeoutResetNavigationTransitionApp = () => {
  const [page, setPage] = useState<'home' | 'about' | 'pricing'>('home');

  return (
    <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-GB" suspenseTimeoutMs={25}>
      <button
        onClick={() => {
          startTransition(() => {
            setPage('about');
          });
        }}
      >
        Go to about
      </button>
      <button
        onClick={() => {
          startTransition(() => {
            setPage('pricing');
          });
        }}
      >
        Go to pricing
      </button>
      {page === 'home' ? (
        <Ways context="home">
          <T>Home</T>
        </Ways>
      ) : page === 'about' ? (
        <Ways context="about">
          <T>About</T>
        </Ways>
      ) : (
        <Ways context="pricing">
          <T>Pricing</T>
        </Ways>
      )}
    </Ways>
  );
};

const getBodyText = () => document.body.textContent || '';

describe('useTranslationLoading', () => {
  beforeEach(() => {
    setWindowTranslationStore({
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
    });
    vi.clearAllMocks();
    vi.mocked(fetchSeed).mockResolvedValue({ data: {} });
  });

  it('reports loading while locale-triggered translations are in flight', async () => {
    const deferred = createDeferred<any>();

    vi.mocked(fetchTranslations).mockReturnValue(deferred.promise);

    render(<LocaleLoadingApp />);

    expect(getVisibleTranslationLoading()).toHaveTextContent('idle');
    expect(screen.getByText('Hello')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Switch locale'));

    await waitFor(() => {
      expect(getVisibleTranslationLoading()).toHaveTextContent('loading');
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
      expect(getVisibleTranslationLoading()).toHaveTextContent('idle');
    });
  });

  it('does not report unrelated context loading as local loading', async () => {
    const deferred = createDeferred<any>();

    vi.mocked(fetchTranslations).mockReturnValue(deferred.promise);

    render(<KeyScopedLoadingApp />);

    expect(getVisibleTranslationLoading()).toHaveTextContent('idle');

    fireEvent.click(screen.getByText('Switch locale'));

    // Translation work is happening for "content", but this hook is mounted under "switcher".
    await waitFor(() => {
      expect(getVisibleTranslationLoading()).toHaveTextContent('idle');
    });

    await act(async () => {
      deferred.resolve({
        data: [
          {
            locale: 'es-ES',
            key: 'content',
            textHash: '["Hello","content"]',
            translation: 'Hola',
          },
        ],
        errors: [],
      });
      await deferred.promise;
      await clearQueueForTests();
    });
  });

  it('keeps the previous page visible during client navigation until the next page translations settle', async () => {
    const deferred = createDeferred<any>();

    setWindowTranslationStore({
      ...getWindowTranslations(),
      'es-ES': {
        home: {
          '["Home","home"]': 'Inicio',
        },
      },
    });
    vi.mocked(fetchTranslations).mockReturnValue(deferred.promise);

    render(
      <React.Suspense fallback={null}>
        <NavigationTransitionApp />
      </React.Suspense>
    );

    expect(screen.getByText('Inicio')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Navigate'));

    expect(screen.getByText('Inicio')).toBeInTheDocument();
    expect(screen.queryByText('About')).not.toBeInTheDocument();

    await act(async () => {
      deferred.resolve({
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
      await deferred.promise;
      await clearQueueForTests();
    });

    await waitFor(() => {
      expect(screen.getByText('Acerca de')).toBeInTheDocument();
    });
    expect(screen.queryByText('Inicio')).not.toBeInTheDocument();
  });

  it('resets the suspense timeout window after a timed-out navigation settles', async () => {
    const aboutDeferred = createDeferred<any>();
    const pricingDeferred = createDeferred<any>();

    setWindowTranslationStore({
      ...getWindowTranslations(),
      'es-ES': {
        home: {
          '["Home","home"]': 'Inicio',
        },
      },
    });
    vi.mocked(fetchTranslations)
      .mockReturnValueOnce(aboutDeferred.promise)
      .mockReturnValueOnce(pricingDeferred.promise);

    render(
      <React.Suspense fallback={null}>
        <TimeoutResetNavigationTransitionApp />
      </React.Suspense>
    );

    expect(screen.getByText('Inicio')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Go to about'));

    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 40);
      });
    });

    expect(screen.getByText('About')).toBeInTheDocument();

    await act(async () => {
      aboutDeferred.resolve({
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
      await aboutDeferred.promise;
      await clearQueueForTests();
    });

    expect(screen.getByText('Acerca de')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Go to pricing'));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('Acerca de')).toBeInTheDocument();
    expect(screen.queryByText('Pricing')).not.toBeInTheDocument();

    await act(async () => {
      pricingDeferred.resolve({
        data: [
          {
            locale: 'es-ES',
            key: 'pricing',
            textHash: '["Pricing","pricing"]',
            translation: 'Precios',
          },
        ],
        errors: [],
      });
      await pricingDeferred.promise;
      await clearQueueForTests();
    });

    expect(screen.getByText('Precios')).toBeInTheDocument();
  });

  it('does not reveal base-locale page content after loading work has started on a suspended client navigation', async () => {
    const deferred = createDeferred<any>();

    setWindowTranslationStore({
      ...getWindowTranslations(),
      'es-ES': {
        home: {
          '["Home","home"]': 'Inicio',
        },
      },
    });
    vi.mocked(fetchTranslations).mockReturnValue(deferred.promise);

    render(
      <React.Suspense fallback={null}>
        <NavigationTransitionApp />
      </React.Suspense>
    );

    expect(screen.getByText('Inicio')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Navigate'));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('Inicio')).toBeInTheDocument();
    expect(screen.queryByText('About')).not.toBeInTheDocument();

    await act(async () => {
      deferred.resolve({
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
      await deferred.promise;
      await clearQueueForTests();
    });

    await waitFor(() => {
      expect(screen.getByText('Acerca de')).toBeInTheDocument();
    });
    expect(screen.queryByText('Inicio')).not.toBeInTheDocument();
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

  it('keeps the previous locale visible during a root-level locale transition without an explicit React suspense boundary', async () => {
    const deferred = createDeferred<any>();

    vi.mocked(fetchTranslations).mockReturnValue(deferred.promise);

    render(<RootPreviousLocaleFallbackApp />);

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

  it('falls back per string from the previous settled locale while the next locale is loading', async () => {
    const deferred = createDeferred<any>();

    vi.mocked(fetchTranslations).mockReturnValue(deferred.promise);
    setWindowTranslationStore({
      ...getWindowTranslations(),
      'fr-FR': {
        'key-1': {
          '["Hello","key-1"]': 'Bonjour',
          '["Goodbye","key-1"]': 'Au revoir',
        },
      },
    });

    render(<PreviousLocalePartialFallbackApp />);

    expect(getBodyText()).toContain('Bonjour');
    expect(getBodyText()).toContain('Au revoir');

    fireEvent.click(screen.getByText('Switch locale'));

    await waitFor(() => {
      expect(getBodyText()).toContain('Bonjour');
      expect(getBodyText()).toContain('Au revoir');
    });

    expect(getBodyText()).not.toContain('Hello');

    await act(async () => {
      deferred.resolve({
        data: [
          {
            locale: 'ja-JP',
            key: 'key-1',
            textHash: '["Hello","key-1"]',
            translation: 'こんにちは',
          },
          {
            locale: 'ja-JP',
            key: 'key-1',
            textHash: '["Goodbye","key-1"]',
            translation: 'さようなら',
          },
        ],
        errors: [],
      });
      await deferred.promise;
      await clearQueueForTests();
    });
  });

  it('does not create a pending seed when switching to a locale that is already cached for the context', async () => {
    setWindowTranslationStore({
      ...getWindowTranslations(),
      'ja-JP': {
        'cookie-consent': {
          '["Privacy settings","cookie-consent"]': 'プライバシー設定',
        },
      },
    });

    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [],
      errors: [],
    });

    render(<CachedLocaleReturnApp />);

    await waitFor(() => {
      expect(vi.mocked(fetchSeed)).toHaveBeenCalledWith(['cookie-consent'], 'fr-FR', {
        origin: undefined,
      });
    });

    vi.mocked(fetchSeed).mockClear();

    fireEvent.click(screen.getByText('Switch locale'));

    await waitFor(() => {
      expect(screen.getByText('プライバシー設定')).toBeInTheDocument();
    });

    expect(getVisibleTranslationLoading()).toHaveTextContent('idle');
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

    setWindowTranslationStore({
      ...getWindowTranslations(),
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
    });

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

  it('keeps the previous locale content visible while locale seed work is pending', async () => {
    const seedDeferred = createDeferred<any>();
    const translationDeferred = createDeferred<any>();
    const lifecycle = { mounts: 0, unmounts: 0 };

    vi.mocked(fetchSeed).mockReturnValue(seedDeferred.promise);
    vi.mocked(fetchTranslations).mockReturnValue(translationDeferred.promise);

    render(<StableScopeDuringLocaleChangeApp lifecycle={lifecycle} />);

    expect(screen.getByText('Bonjour')).toBeInTheDocument();
    expect(getVisibleStableScopeChild().textContent).toBeTruthy();

    fireEvent.click(screen.getByText('Switch locale'));

    await waitFor(() => {
      expect(fetchSeed).toHaveBeenCalledWith(['key-1'], 'ja-JP', {
        origin: undefined,
      });
    });

    expect(screen.getByText('Bonjour')).toBeInTheDocument();
    expect(getVisibleStableScopeChild().textContent).toBeTruthy();

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
    expect(getVisibleStableScopeChild().textContent).toBeTruthy();

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

    expect(getVisibleStableScopeChild().textContent).toBeTruthy();
  });

  it('keeps the already-mounted root subtree mounted while the next locale is loading', async () => {
    const deferred = createDeferred<any>();
    const lifecycle = { mounts: 0, unmounts: 0 };

    vi.mocked(fetchTranslations).mockReturnValue(deferred.promise);

    render(<RootStableScopeDuringLocaleChangeApp lifecycle={lifecycle} />);

    expect(screen.getByText('Bonjour')).toBeInTheDocument();
    expect(lifecycle).toEqual({ mounts: 1, unmounts: 0 });

    const initialMarker = screen.getByTestId('stable-scope-child');
    const initialMountId = initialMarker.textContent;

    fireEvent.click(screen.getByText('Switch locale'));

    await waitFor(() => {
      expect(screen.getByText('Bonjour')).toBeInTheDocument();
    });

    expect(screen.getByTestId('stable-scope-child')).toBe(initialMarker);
    expect(screen.getByTestId('stable-scope-child').textContent).toBe(initialMountId);
    expect(lifecycle).toEqual({ mounts: 1, unmounts: 0 });

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

    expect(screen.getByTestId('stable-scope-child')).toBe(initialMarker);
    expect(screen.getByTestId('stable-scope-child').textContent).toBe(initialMountId);
    expect(lifecycle).toEqual({ mounts: 1, unmounts: 0 });
  });
});
