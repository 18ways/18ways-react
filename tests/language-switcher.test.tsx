import React, { useState } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { Ways, T, LanguageSwitcher } from '../index';
import { fetchEnabledLanguages, fetchSeed, fetchTranslations } from '@18ways/core/common';
import { internalT } from '@18ways/core/internal-i18n';
import { clearQueueForTests } from '../testing';

vi.mock('@18ways/core/common', async () => {
  const actual = await vi.importActual('@18ways/core/common');
  return {
    ...actual,
    fetchAcceptedLocales: vi.fn(async (fallbackLocale?: string) => [fallbackLocale || 'en-GB']),
    fetchEnabledLanguages: vi.fn(),
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

const getTriggerButton = (): HTMLButtonElement => {
  const button = document.querySelector('button[aria-haspopup="listbox"]');
  if (!button) {
    throw new Error('LanguageSwitcher trigger button not found');
  }
  return button as HTMLButtonElement;
};

describe('LanguageSwitcher', () => {
  beforeEach(() => {
    vi.useRealTimers();
    document.cookie = '18ways_locale=; Max-Age=0; Path=/';
    window.__18WAYS_ACCEPTED_LOCALES__ = ['en-GB', 'es-ES'];
    window.__18WAYS_IN_MEMORY_TRANSLATIONS__ = {
      'en-GB': {
        'key-1': {
          '["Hello","key-1"]': ['Hello'],
        },
        content: {
          '["Hello","content"]': ['Hello'],
        },
      },
    };

    vi.clearAllMocks();
    vi.mocked(fetchSeed).mockResolvedValue({ data: {} });
  });

  it('updates locale, persists cookie, shows spinner immediately, and re-enables after fetch', async () => {
    const deferred = createDeferred<any>();
    vi.mocked(fetchTranslations).mockReturnValue(deferred.promise);

    render(<AppWithLanguageSwitcher />);
    expect(fetchEnabledLanguages).not.toHaveBeenCalled();

    fireEvent.click(getTriggerButton());
    fireEvent.click(await screen.findByRole('option', { name: /Spanish/i }));

    expect(getTriggerButton()).toBeDisabled();
    expect(document.cookie).toContain('18ways_locale=es-ES');
    expect(screen.getAllByText(internalT('es-ES', 'changingLanguage')).length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(fetchTranslations).toHaveBeenCalledTimes(1);
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
      expect(screen.getByTestId('translated-text')).toHaveTextContent('Hola');
      expect(getTriggerButton()).not.toBeDisabled();
    });
  });

  it('renders locale flags from supported locales data', async () => {
    vi.mocked(fetchTranslations).mockResolvedValue({ data: [], errors: [] });

    render(<AppWithLanguageSwitcher />);

    fireEvent.click(getTriggerButton());

    expect((await screen.findAllByText('🇬🇧')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('🇪🇸').length).toBeGreaterThan(0);
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

    render(<AppWithCrossContextLanguageSwitcher />);

    fireEvent.click(getTriggerButton());
    fireEvent.click(await screen.findByRole('option', { name: /Spanish/i }));

    expect(getTriggerButton()).toBeDisabled();

    await waitFor(() => {
      expect(fetchTranslations).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(getTriggerButton()).toBeDisabled();

    await act(async () => {
      deferred.resolve({
        data: [
          {
            locale: 'es-ES',
            key: 'content',
            textsHash: '["Hello","content"]',
            translation: ['Hola'],
          },
        ],
        errors: [],
      });
      await deferred.promise;
      await clearQueueForTests();
    });

    await waitFor(() => {
      expect(screen.getByTestId('translated-text')).toHaveTextContent('Hola');
      expect(getTriggerButton()).not.toBeDisabled();
    });
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
});
