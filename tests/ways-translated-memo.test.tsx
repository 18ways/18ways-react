import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { Ways, useTranslatedMemo } from '../index';
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

const MemoConsumer = ({ suffix }: { suffix: string }) => {
  const config = useTranslatedMemo(
    (t) => ({
      title: t('Hello'),
      suffix,
    }),
    [suffix]
  );

  return <div data-testid="memo-value">{`${config.title}${config.suffix}`}</div>;
};

const NonSuspendingMemoConsumer = ({ suffix }: { suffix: string }) => {
  const config = useTranslatedMemo(
    (t) => ({
      title: t('Hello'),
      suffix,
    }),
    [suffix],
    { suspend: false }
  );

  return <div data-testid="non-suspending-memo-value">{`${config.title}${config.suffix}`}</div>;
};

describe('useTranslatedMemo', () => {
  beforeEach(() => {
    delete window.__18WAYS_TRANSLATION_STORE__;
    vi.clearAllMocks();
    vi.mocked(fetchSeed).mockResolvedValue({ data: {} });
  });

  it('recomputes memoized values when translations load and when caller deps change', async () => {
    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [
        {
          locale: 'es-ES',
          key: 'memo',
          textHash: '["Hello","memo"]',
          translation: 'Hola',
        },
      ],
      errors: [],
    });

    const { rerender } = render(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-GB">
        <Ways context="memo">
          <MemoConsumer suffix="!" />
        </Ways>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    await waitFor(() => {
      expect(screen.getByTestId('memo-value').textContent).toBe('Hola!');
    });

    rerender(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-GB">
        <Ways context="memo">
          <MemoConsumer suffix="?" />
        </Ways>
      </Ways>
    );

    await waitFor(() => {
      expect(screen.getByTestId('memo-value').textContent).toBe('Hola?');
    });

    expect(vi.mocked(fetchTranslations)).toHaveBeenCalledTimes(1);
  });

  it('can compute translated memo values without suspending while translations are pending', async () => {
    const deferred = (() => {
      let resolve!: (value: any) => void;
      const promise = new Promise<any>((res) => {
        resolve = res;
      });
      return { promise, resolve };
    })();

    vi.mocked(fetchTranslations).mockReturnValue(deferred.promise);

    render(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-GB">
        <Ways context="memo">
          <NonSuspendingMemoConsumer suffix="!" />
        </Ways>
      </Ways>
    );

    expect(screen.getByTestId('non-suspending-memo-value').textContent).toBe('Hello!');

    await act(async () => {
      deferred.resolve({
        data: [
          {
            locale: 'es-ES',
            key: 'memo',
            textHash: '["Hello","memo"]',
            translation: 'Hola',
          },
        ],
        errors: [],
      });
      await deferred.promise;
      await clearQueueForTests();
    });

    await waitFor(() => {
      expect(screen.getByTestId('non-suspending-memo-value').textContent).toBe('Hola!');
    });
  });

  it('hydrates client-mounted translated scopes from seed before falling back to translate', async () => {
    vi.mocked(fetchSeed).mockResolvedValue({
      data: {
        memo: {
          '["Hello","memo"]': 'Hola',
        },
      },
    });
    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [],
      errors: [],
    });

    render(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-GB">
        <Ways context="memo">
          <NonSuspendingMemoConsumer suffix="!" />
        </Ways>
      </Ways>
    );

    expect(screen.getByTestId('non-suspending-memo-value').textContent).toBe('Hello!');

    await waitFor(() => {
      expect(vi.mocked(fetchSeed)).toHaveBeenCalledWith(['memo'], 'es-ES', {
        origin: undefined,
      });
      expect(screen.getByTestId('non-suspending-memo-value').textContent).toBe('Hola!');
    });

    expect(vi.mocked(fetchTranslations)).not.toHaveBeenCalled();
  });
});
