import React, { useState } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { Ways, T, useCurrentLocale, useSetCurrentLocale } from '../index';
import { fetchSeed, fetchTranslations } from '@18ways/core/common';

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

const LocaleTestApp = () => {
  const [locale, setLocale] = useState('en-GB');

  return (
    <Ways apiKey="test-api-key" locale={locale} baseLocale="en-GB">
      <button onClick={() => setLocale('es-ES')}>Switch locale</button>
      <Ways context="key-1">
        <T>Hello</T>
      </Ways>
    </Ways>
  );
};

const ManualLocaleControl = () => {
  const locale = useCurrentLocale();
  const setLocale = useSetCurrentLocale();

  return (
    <>
      <span data-testid="current-locale">{locale}</span>
      <button onClick={() => setLocale('es-ES')}>Set locale manually</button>
    </>
  );
};

describe('WaysRoot - Locale Changes', () => {
  beforeEach(() => {
    window.__18WAYS_IN_MEMORY_TRANSLATIONS__ = {
      'en-GB': {
        'key-1': {
          '["Hello","key-1"]': 'Hello',
        },
      },
    };
    sessionStorage.clear();
    vi.clearAllMocks();
    vi.mocked(fetchSeed).mockResolvedValue({ data: {} });
  });

  it('should switch locale and update translations', async () => {
    vi.mocked(fetchTranslations).mockImplementation(async (entries) => ({
      data: entries.map((entry) => ({
        locale: entry.targetLocale,
        key: entry.key,
        textHash: entry.textHash,
        contextFingerprint: entry.contextFingerprint ?? null,
        translationId: 'group-1',
        translation: entry.targetLocale === 'es-ES' ? 'Hola' : 'Hello',
      })),
      errors: [],
    }));

    render(<LocaleTestApp />);

    expect(screen.getByText('Hello')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Switch locale'));

    await waitFor(() => {
      expect(screen.getByText('Hola')).toBeInTheDocument();
    });

    expect(vi.mocked(fetchSeed)).toHaveBeenCalledWith(['key-1'], 'es-ES');
    const seedOrder = vi.mocked(fetchSeed).mock.invocationCallOrder[0];
    const switchTranslateOrder = vi
      .mocked(fetchTranslations)
      .mock.calls.findIndex((calls) =>
        calls[0]?.some((entry) => entry.targetLocale === 'es-ES' && entry.baseLocale !== 'es-ES')
      );

    expect(switchTranslateOrder).toBeGreaterThanOrEqual(0);
    expect(seedOrder).toBeLessThan(
      vi.mocked(fetchTranslations).mock.invocationCallOrder[switchTranslateOrder]
    );
  });

  it('updates nested contexts when locale prop changes without remounting', async () => {
    vi.mocked(fetchTranslations).mockResolvedValue({
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

    const PersistentChild = () => {
      const mountId = React.useRef(`mount-${Math.random().toString(36).slice(2)}`);
      return <div data-testid="mount-id">{mountId.current}</div>;
    };

    const { rerender } = render(
      <Ways apiKey="test-api-key" locale="en-GB" baseLocale="en-GB">
        <Ways context="key-1">
          <PersistentChild />
          <T>Hello</T>
        </Ways>
      </Ways>
    );

    expect(screen.getByText('Hello')).toBeInTheDocument();
    const initialMountId = screen.getByTestId('mount-id').textContent;

    rerender(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-GB">
        <Ways context="key-1">
          <PersistentChild />
          <T>Hello</T>
        </Ways>
      </Ways>
    );

    await waitFor(() => {
      expect(screen.getByText('Hola')).toBeInTheDocument();
    });

    expect(screen.getByTestId('mount-id').textContent).toBe(initialMountId);
  });

  it('allows manual locale updates without being reset by the initial locale prop', async () => {
    render(
      <Ways apiKey="test-api-key" locale="en-GB" baseLocale="en-GB">
        <ManualLocaleControl />
      </Ways>
    );

    expect(screen.getByTestId('current-locale').textContent).toBe('en-GB');

    fireEvent.click(screen.getByText('Set locale manually'));

    await waitFor(() => {
      expect(screen.getByTestId('current-locale').textContent).toBe('es-ES');
    });
  });
});
