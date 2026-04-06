import React, { useState } from 'react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { Ways, T } from '../index';
import { fetchTranslations } from '@18ways/core/common';
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

describe('WaysRoot - Full Integration', () => {
  beforeEach(() => {
    delete window.__18WAYS_TRANSLATION_STORE__;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should handle component unmount and remount with memory persistence', async () => {
    const TestPersistence = () => {
      const [show, setShow] = useState(true);

      return (
        <div>
          <button onClick={() => setShow(!show)}>Toggle</button>
          {show && (
            <Ways context="test">
              <T>Persistent Text</T>
            </Ways>
          )}
        </div>
      );
    };

    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [
        {
          locale: 'es-ES',
          key: 'test',
          textHash: '["Persistent Text","test"]',
          translation: 'Texto Persistente',
        },
      ],
      errors: [],
    });

    render(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-US">
        <TestPersistence />
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    await waitFor(() => {
      expect(screen.getByText('Texto Persistente')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Toggle'));
    expect(screen.queryByText('Texto Persistente')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Toggle'));
    expect(screen.getByText('Texto Persistente')).toBeInTheDocument();

    expect(vi.mocked(fetchTranslations)).toHaveBeenCalledTimes(1);
  });
});
