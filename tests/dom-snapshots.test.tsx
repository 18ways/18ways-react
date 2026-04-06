import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Ways, T } from '../index';
import { fetchTranslations } from '@18ways/core/common';
import {
  clearDomSnapshotTranslationOverridesForTesting,
  setDomSnapshotTranslationOverridesForTesting,
} from '../dom-snapshots';
import { resetTestRuntimeState } from '../testing';

const POISON_CHAR = '\u2063';

vi.mock('@18ways/core/common', async () => {
  const actual = await vi.importActual('@18ways/core/common');
  return {
    ...actual,
    fetchAcceptedLocales: vi.fn(async (fallbackLocale?: string) => [fallbackLocale || 'en-GB']),
    fetchKnown: vi.fn().mockResolvedValue({ data: [], errors: [] }),
    fetchKnownContext: vi.fn().mockResolvedValue({ data: [], errors: [] }),
    fetchTranslations: vi.fn(),
    generateHashId: vi.fn((value) => JSON.stringify(value)),
  };
});

describe('DOM snapshot translation infection', () => {
  beforeEach(() => {
    resetTestRuntimeState();
    delete window.__18WAYS_TRANSLATION_STORE__;
    vi.clearAllMocks();
    vi.mocked(fetchTranslations).mockResolvedValue({ data: [], errors: [] });
  });

  it('infects and restores only the targeted translation identity', () => {
    window.__18WAYS_TRANSLATION_STORE__ = {
      translations: {
        'es-ES': {
          'cta.primary': {
            '["Open","cta.primary"]': 'Abrir',
          },
          'cta.secondary': {
            '["Open","cta.secondary"]': 'Abrir',
          },
        },
      },
      config: {
        acceptedLocales: [],
        translationFallback: {
          default: 'source',
          overrides: [],
        },
      },
    };

    render(
      <Ways
        apiKey="test-api-key"
        locale="es-ES"
        baseLocale="en-US"
        acceptedLocales={['en-US', 'es-ES']}
      >
        <Ways context="cta.primary">
          <span data-testid="primary">
            <T>Open</T>
          </span>
        </Ways>
        <Ways context="cta.secondary">
          <span data-testid="secondary">
            <T>Open</T>
          </span>
        </Ways>
      </Ways>
    );

    expect(screen.getByTestId('primary').textContent).toBe('Abrir');
    expect(screen.getByTestId('secondary').textContent).toBe('Abrir');

    act(() => {
      setDomSnapshotTranslationOverridesForTesting([
        {
          locale: 'es-ES',
          key: 'cta.primary',
          textHash: '["Open","cta.primary"]',
          contextFingerprint: JSON.stringify({
            name: 'cta.primary',
            label: '',
            treePath: '',
            filePath: '',
          }),
          translatedTexts: [`Abrir${POISON_CHAR}`],
        },
      ]);
    });

    expect(screen.getByTestId('primary').textContent).toBe(`Abrir${POISON_CHAR}`);
    expect(screen.getByTestId('secondary').textContent).toBe('Abrir');

    act(() => {
      clearDomSnapshotTranslationOverridesForTesting();
    });

    expect(screen.getByTestId('primary').textContent).toBe('Abrir');
    expect(screen.getByTestId('secondary').textContent).toBe('Abrir');
  });
});
