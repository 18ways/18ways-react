import React, { useState } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { Ways, T } from '../index';
import { fetchTranslations } from '@18ways/core/common';
import { clearQueueForTests } from '../testing';

vi.mock('@18ways/core/common', async () => {
  const actual = await vi.importActual('@18ways/core/common');
  return {
    ...actual,
    fetchTranslations: vi.fn(),
    generateHashId: vi.fn((x) => JSON.stringify(x)),
  };
});

const DynamicContent = ({ count }: { count: number }) => {
  const items = Array.from({ length: count }, (_, i) => <T key={i}>Item {i}</T>);
  return <>{items}</>;
};

describe('WaysRoot - Performance and Caching', () => {
  beforeEach(() => {
    delete window.__18WAYS_IN_MEMORY_TRANSLATIONS__;
    vi.clearAllMocks();
  });

  it('should batch multiple translation requests', async () => {
    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [
        {
          locale: 'es-ES',
          key: 'test-key',
          textsHash: '["Text 1","test-key"]',
          translation: ['Texto 1'],
        },
        {
          locale: 'es-ES',
          key: 'test-key',
          textsHash: '["Text 2","test-key"]',
          translation: ['Texto 2'],
        },
        {
          locale: 'es-ES',
          key: 'test-key',
          textsHash: '["Text 3","test-key"]',
          translation: ['Texto 3'],
        },
      ],
      errors: [],
    });

    render(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-US">
        <Ways context="test-key">
          <T>Text 1</T>
          <T>Text 2</T>
          <T>Text 3</T>
        </Ways>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(vi.mocked(fetchTranslations)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchTranslations)).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ texts: ['Text 1'] }),
        expect.objectContaining({ texts: ['Text 2'] }),
        expect.objectContaining({ texts: ['Text 3'] }),
      ])
    );
  });

  it('should deduplicate identical translation requests', async () => {
    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [
        {
          locale: 'es-ES',
          key: 'test-key',
          textsHash: '["Duplicate","test-key"]',
          translation: ['Duplicado'],
        },
      ],
      errors: [],
    });

    render(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-US">
        <Ways context="test-key">
          <T>Duplicate</T>
          <T>Duplicate</T>
          <T>Duplicate</T>
        </Ways>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(vi.mocked(fetchTranslations)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchTranslations)).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ texts: ['Duplicate'] })])
    );
    expect(vi.mocked(fetchTranslations).mock.calls[0][0]).toHaveLength(1);
  });

  it('should use memory cache for already translated content', async () => {
    window.__18WAYS_IN_MEMORY_TRANSLATIONS__ = {
      'es-ES': {
        'test-key': {
          '["Cached","test-key"]': ['En caché'],
        },
      },
    };

    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [],
      errors: [],
    });

    render(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-US">
        <Ways context="test-key">
          <T>Cached</T>
        </Ways>
      </Ways>
    );

    expect(screen.getByText('En caché')).toBeInTheDocument();
    expect(vi.mocked(fetchTranslations)).not.toHaveBeenCalled();
  });

  it('should cache translations across component remounts', async () => {
    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [
        {
          locale: 'es-ES',
          key: 'test-key',
          textsHash: '["Persistent","test-key"]',
          translation: ['Persistente'],
        },
      ],
      errors: [],
    });

    const { unmount } = render(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-US">
        <Ways context="test-key">
          <T>Persistent</T>
        </Ways>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    await waitFor(() => {
      expect(screen.getByText('Persistente')).toBeInTheDocument();
    });

    unmount();

    render(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-US">
        <Ways context="test-key">
          <T>Persistent</T>
        </Ways>
      </Ways>
    );

    expect(screen.getByText('Persistente')).toBeInTheDocument();
    expect(vi.mocked(fetchTranslations)).toHaveBeenCalledTimes(1);
  });
});
