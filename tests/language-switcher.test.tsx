import React, { useState } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { Ways, T, LanguageSwitcher } from '../index';
import { fetchConfig, fetchSeed, fetchTranslations } from '@18ways/core/common';
import { internalT } from '@18ways/core/internal-i18n';
import { clearQueueForTests } from '../testing';

const CHANGE_SETTLE_TIMEOUT_MS = 1000;

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

const clearQueueWithFakeTimers = async () => {
  await act(async () => {
    const clearPromise = clearQueueForTests();
    for (let pass = 0; pass < 6; pass += 1) {
      await vi.advanceTimersByTimeAsync(1);
    }
    await clearPromise;
  });
};

const advanceChangeTimers = async (ms = CHANGE_SETTLE_TIMEOUT_MS + 1) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const flushMicrotasks = async (passes = 4) => {
  await act(async () => {
    for (let pass = 0; pass < passes; pass += 1) {
      await Promise.resolve();
    }
  });
};

const AppWithLanguageSwitcher = ({
  rootPersistLocaleCookie,
}: {
  rootPersistLocaleCookie?: boolean;
}) => {
  const [locale, setLocale] = useState('en-GB');

  return (
    <Ways
      apiKey="test-api-key"
      locale={locale}
      baseLocale="en-GB"
      persistLocaleCookie={rootPersistLocaleCookie}
    >
      <Ways context="key-1">
        <LanguageSwitcher currentLocale={locale} onLocaleChange={setLocale} />
        <div data-testid="translated-text">
          <T>Hello</T>
        </div>
      </Ways>
    </Ways>
  );
};

const AppWithCrossContextLanguageSwitcher = () => {
  const [locale, setLocale] = useState('en-GB');

  return (
    <Ways apiKey="test-api-key" locale={locale} baseLocale="en-GB">
      <Ways context="switcher">
        <LanguageSwitcher currentLocale={locale} onLocaleChange={setLocale} />
      </Ways>
      <Ways context="content">
        <div data-testid="translated-text">
          <T>Hello</T>
        </div>
      </Ways>
    </Ways>
  );
};

const AppWithDownwardLanguageSwitcher = () => {
  const [locale, setLocale] = useState('en-GB');

  return (
    <Ways apiKey="test-api-key" locale={locale} baseLocale="en-GB">
      <Ways context="key-1">
        <LanguageSwitcher direction="down" currentLocale={locale} onLocaleChange={setLocale} />
      </Ways>
    </Ways>
  );
};

const AppWithTailwindStyleApi = () => {
  const [locale, setLocale] = useState('en-GB');

  return (
    <Ways apiKey="test-api-key" locale={locale} baseLocale="en-GB">
      <Ways context="key-1">
        <LanguageSwitcher
          unstyled
          classNames={{
            button: 'tw-trigger',
            menu: 'tw-menu',
            label: 'tw-label',
          }}
          currentLocale={locale}
          onLocaleChange={setLocale}
        />
      </Ways>
    </Ways>
  );
};

const AppWithSuggestedLanguageSwitcher = ({
  acceptedLocales = ['en-GB', 'en-US', 'fr-FR', 'fr-CA', 'de-DE', 'es-ES'],
  preferredLocales,
  initialLocale = 'en-GB',
}: {
  acceptedLocales?: string[];
  preferredLocales?: string[];
  initialLocale?: string;
}) => {
  const [locale, setLocale] = useState(initialLocale);

  return (
    <Ways
      apiKey="test-api-key"
      locale={locale}
      baseLocale="en-GB"
      acceptedLocales={acceptedLocales}
    >
      <Ways context="key-1">
        <LanguageSwitcher
          currentLocale={locale}
          onLocaleChange={setLocale}
          preferredLocales={preferredLocales}
        />
      </Ways>
    </Ways>
  );
};

const getTriggerButton = (): HTMLButtonElement => {
  const button = document.querySelector('button[aria-haspopup="listbox"]');
  if (!button) {
    throw new Error('LanguageSwitcher trigger button not found');
  }
  return button as HTMLButtonElement;
};

const getSectionOptionTexts = (sectionLabel: string): string[] => {
  const sectionHeader = screen.getByText(sectionLabel);
  const section = sectionHeader.parentElement;
  if (!section) {
    throw new Error(`Section not found for label: ${sectionLabel}`);
  }

  return Array.from(section.querySelectorAll('[role="option"]')).map(
    (option) => option.textContent || ''
  );
};

describe('LanguageSwitcher', () => {
  beforeEach(() => {
    vi.useRealTimers();
    document.cookie = '18ways_locale=; Max-Age=0; Path=/';
    window.__18WAYS_ACCEPTED_LOCALES__ = ['en-GB', 'es-ES'];
    window.__18WAYS_TRANSLATION_FALLBACK_CONFIG__ = {
      default: 'source',
      overrides: [],
    };
    window.__18WAYS_IN_MEMORY_TRANSLATIONS__ = {
      'en-GB': {
        'key-1': {
          '["Hello","key-1"]': 'Hello',
        },
        content: {
          '["Hello","content"]': 'Hello',
        },
      },
    };

    vi.clearAllMocks();
    vi.mocked(fetchSeed).mockResolvedValue({ data: {} });
  });

  it('updates locale, persists cookie, shows spinner immediately, and re-enables after fetch', async () => {
    const deferred = createDeferred<any>();
    vi.mocked(fetchTranslations).mockReturnValue(deferred.promise);
    vi.useFakeTimers();

    try {
      render(<AppWithLanguageSwitcher />);
      expect(fetchConfig).not.toHaveBeenCalled();

      fireEvent.click(getTriggerButton());
      fireEvent.click(screen.getByRole('option', { name: /Spanish/i }));

      expect(getTriggerButton()).toBeDisabled();
      expect(document.cookie).toContain('18ways_locale=es-ES');
      expect(screen.getAllByText(internalT('es-ES', 'changingLanguage')).length).toBeGreaterThan(0);

      await flushMicrotasks();
      expect(fetchTranslations).toHaveBeenCalledTimes(1);

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
      });
      await clearQueueWithFakeTimers();
      await advanceChangeTimers();

      expect(screen.getByTestId('translated-text')).toHaveTextContent('Hola');
      expect(getTriggerButton()).not.toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders locale flags from supported locales data', async () => {
    vi.mocked(fetchTranslations).mockResolvedValue({ data: [], errors: [] });

    render(<AppWithLanguageSwitcher />);

    fireEvent.click(getTriggerButton());

    expect((await screen.findAllByText('🇬🇧')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('🇪🇸').length).toBeGreaterThan(0);
  });

  it('renders the demo Caesar locale with the synthetic name and flag', async () => {
    vi.mocked(fetchTranslations).mockResolvedValue({ data: [], errors: [] });
    window.__18WAYS_ACCEPTED_LOCALES__ = ['en-GB', 'en-GB-x-caesar'];

    render(<AppWithLanguageSwitcher />);

    fireEvent.click(getTriggerButton());

    expect(await screen.findByRole('option', { name: /Caesar Shift/i })).toBeInTheDocument();
    expect(screen.getAllByText('🔄').length).toBeGreaterThan(0);
  });

  it('inherits locale cookie persistence from the root Ways runtime', async () => {
    vi.mocked(fetchTranslations).mockResolvedValue({ data: [], errors: [] });
    document.cookie = '18ways_locale=; Max-Age=0; Path=/';

    render(<AppWithLanguageSwitcher rootPersistLocaleCookie={false} />);

    await act(async () => {
      fireEvent.click(getTriggerButton());
    });

    const spanishOption = await screen.findByRole('option', { name: /Spanish/i });

    await act(async () => {
      fireEvent.click(spanishOption);
      await clearQueueForTests();
    });

    expect(document.cookie).not.toContain('18ways_locale=es-ES');
  });

  it('recovers if translation loading never settles', async () => {
    // Keep this in sync with CHANGE_HARD_TIMEOUT_MS in language-switcher.tsx.
    const CHANGE_HARD_TIMEOUT_MS = 10000;

    const deferred = createDeferred<any>();
    vi.mocked(fetchTranslations).mockReturnValue(deferred.promise);

    render(<AppWithLanguageSwitcher />);

    vi.useFakeTimers();
    try {
      fireEvent.click(getTriggerButton());
      fireEvent.click(screen.getByRole('option', { name: /Spanish/i }));

      expect(getTriggerButton()).toBeDisabled();

      await act(async () => {
        vi.advanceTimersByTime(CHANGE_HARD_TIMEOUT_MS + 1);
        await Promise.resolve();
      });

      expect(getTriggerButton()).not.toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps spinner active while translations are loading in other contexts', async () => {
    const deferred = createDeferred<any>();
    vi.mocked(fetchTranslations).mockReturnValue(deferred.promise);
    vi.useFakeTimers();

    try {
      render(<AppWithCrossContextLanguageSwitcher />);

      fireEvent.click(getTriggerButton());
      fireEvent.click(screen.getByRole('option', { name: /Spanish/i }));

      expect(getTriggerButton()).toBeDisabled();

      await flushMicrotasks();
      expect(fetchTranslations).toHaveBeenCalledTimes(1);

      await advanceChangeTimers(400);
      expect(getTriggerButton()).toBeDisabled();

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
      });
      await clearQueueWithFakeTimers();
      await advanceChangeTimers();

      expect(screen.getByTestId('translated-text')).toHaveTextContent('Hola');
      expect(getTriggerButton()).not.toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('supports opening the menu downward', async () => {
    render(<AppWithDownwardLanguageSwitcher />);

    fireEvent.click(getTriggerButton());

    const listbox = await screen.findByRole('listbox');
    const menu = listbox.parentElement?.parentElement as HTMLDivElement | null;

    expect(menu).not.toBeNull();
    expect(menu?.style.top).toBe('calc(100% + 8px)');
    expect(menu?.style.bottom).toBe('auto');
  });

  it('supports classNames and unstyled mode for utility CSS consumers', async () => {
    render(<AppWithTailwindStyleApi />);

    const trigger = getTriggerButton();
    expect(trigger.className).toContain('tw-trigger');
    expect(trigger.style.padding).toBe('');

    fireEvent.click(trigger);

    const listbox = await screen.findByRole('listbox');
    const menu = listbox.parentElement?.parentElement as HTMLDivElement | null;

    expect(menu?.className).toContain('tw-menu');
    expect(trigger.querySelector('.tw-label')).not.toBeNull();
  });

  it('groups suggested locales from preferred locales and alphabetizes the remaining locales', async () => {
    render(<AppWithSuggestedLanguageSwitcher preferredLocales={['en', 'fr-FR']} />);

    fireEvent.click(getTriggerButton());

    expect(await screen.findByText(internalT('en-GB', 'suggestedLanguages'))).toBeInTheDocument();
    expect(screen.getByText(internalT('en-GB', 'allLanguages'))).toBeInTheDocument();

    const suggestedOptionTexts = getSectionOptionTexts(internalT('en-GB', 'suggestedLanguages'));
    const allOptionTexts = getSectionOptionTexts(internalT('en-GB', 'allLanguages'));

    expect(suggestedOptionTexts).toHaveLength(4);
    expect(suggestedOptionTexts[0]).toContain('British English');
    expect(suggestedOptionTexts[1]).toContain('American English');
    expect(suggestedOptionTexts[2]).toContain('French (France)');
    expect(suggestedOptionTexts[3]).toContain('Canadian French');

    expect(allOptionTexts).toHaveLength(5);
    expect(allOptionTexts[0]).toContain('American English');
    expect(allOptionTexts[1]).toContain('Canadian French');
    expect(allOptionTexts[2]).toContain('European Spanish');
    expect(allOptionTexts[3]).toContain('French (France)');
    expect(allOptionTexts[4]).toContain('German');
  });

  it('prioritizes the active locale ahead of browser preference suggestions', async () => {
    render(<AppWithSuggestedLanguageSwitcher initialLocale="fr-FR" preferredLocales={['en-GB']} />);

    await act(async () => {
      await clearQueueForTests();
    });

    fireEvent.click(getTriggerButton());

    const suggestedOptionTexts = getSectionOptionTexts(internalT('fr-FR', 'suggestedLanguages'));

    expect(suggestedOptionTexts[0]).toContain('français (France)');
    expect(suggestedOptionTexts[1]).toContain('français canadien');
    expect(suggestedOptionTexts[2]).toContain('anglais britannique');
    expect(suggestedOptionTexts[3]).toContain('anglais américain');
  });

  it('filters the locale list with fuzzy search when enough locales are available', async () => {
    render(<AppWithSuggestedLanguageSwitcher preferredLocales={['en']} />);

    fireEvent.click(getTriggerButton());

    const searchInput = await screen.findByLabelText(
      internalT('en-GB', 'searchAvailableLanguages')
    );
    fireEvent.change(searchInput, { target: { value: 'canada' } });

    const optionTexts = screen.getAllByRole('option').map((option) => option.textContent || '');

    expect(screen.queryByText(internalT('en-GB', 'suggestedLanguages'))).not.toBeInTheDocument();
    expect(optionTexts).toHaveLength(1);
    expect(optionTexts[0]).toContain('Canadian French');
  });

  it('routes typing from the trigger into the language search and lets Enter pick the top result', async () => {
    vi.useFakeTimers();
    try {
      render(<AppWithSuggestedLanguageSwitcher preferredLocales={['en']} />);

      const trigger = getTriggerButton();
      trigger.focus();

      fireEvent.keyDown(trigger, { key: 'c' });

      const searchInput = screen.getByLabelText(internalT('en-GB', 'searchAvailableLanguages'));
      expect(searchInput).toHaveFocus();
      expect(searchInput).toHaveValue('c');

      fireEvent.change(searchInput, { target: { value: 'canada' } });
      fireEvent.keyDown(searchInput, { key: 'Enter' });
      await flushMicrotasks();
      await advanceChangeTimers();

      expect(getTriggerButton()).toHaveTextContent(/français/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('routes typing from the listbox into the search input', async () => {
    render(<AppWithSuggestedLanguageSwitcher preferredLocales={['en']} />);

    fireEvent.click(getTriggerButton());

    const listbox = await screen.findByRole('listbox');
    listbox.focus();
    fireEvent.keyDown(listbox, { key: 'c' });

    const searchInput = await screen.findByLabelText(
      internalT('en-GB', 'searchAvailableLanguages')
    );
    expect(searchInput).toHaveFocus();
    expect(searchInput).toHaveValue('c');
  });

  it('drops search and suggested grouping when four or fewer locales are available', async () => {
    render(
      <AppWithSuggestedLanguageSwitcher
        acceptedLocales={['en-GB', 'en-US', 'fr-FR', 'fr-CA']}
        preferredLocales={['en', 'fr-FR']}
      />
    );

    fireEvent.click(getTriggerButton());

    expect(
      screen.queryByLabelText(internalT('en-GB', 'searchAvailableLanguages'))
    ).not.toBeInTheDocument();
    expect(screen.queryByText(internalT('en-GB', 'suggestedLanguages'))).not.toBeInTheDocument();
    expect(screen.queryByText(internalT('en-GB', 'allLanguages'))).not.toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(4);
  });

  it('translates the selector chrome using internal locale strings', async () => {
    render(
      <AppWithSuggestedLanguageSwitcher
        initialLocale="fr-FR"
        preferredLocales={['fr-FR']}
        acceptedLocales={['fr-FR', 'fr-CA', 'en-GB', 'en-US', 'de-DE', 'es-ES']}
      />
    );

    await act(async () => {
      await clearQueueForTests();
    });

    fireEvent.click(getTriggerButton());

    expect(await screen.findByText(internalT('fr-FR', 'suggestedLanguages'))).toBeInTheDocument();
    expect(screen.getByText(internalT('fr-FR', 'allLanguages'))).toBeInTheDocument();
    expect(screen.getByLabelText(internalT('fr-FR', 'searchAvailableLanguages'))).toHaveAttribute(
      'placeholder',
      internalT('fr-FR', 'searchLanguagesPlaceholder')
    );
  });
});
