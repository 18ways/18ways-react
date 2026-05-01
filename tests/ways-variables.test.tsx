import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { Ways, T } from '../index';
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
    fetchSeed: vi.fn(),
    fetchTranslations: vi.fn(),
    generateHashId: vi.fn((x) => JSON.stringify(x)),
  };
});

describe('WaysRoot - Variable Substitution', () => {
  beforeEach(() => {
    delete window.__18WAYS_TRANSLATION_STORE__;
    vi.clearAllMocks();
    vi.mocked(fetchSeed).mockResolvedValue({ data: {} });
  });

  it('should handle multiple variables', async () => {
    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [
        {
          locale: 'es-ES',
          key: 'test-key',
          textHash: '["{greeting} {name}, you have {count} messages","test-key"]',
          translation: '{greeting} {name}, tienes {count} mensajes',
        },
      ],
      errors: [],
    });

    const vars = { greeting: 'Hello', name: 'Alice', count: 5 };

    render(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-US">
        <Ways context="test-key">
          <T vars={vars}>{'{greeting} {name}, you have {count} messages'}</T>
        </Ways>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    await waitFor(() => {
      expect(screen.getByText('Hello Alice, tienes 5 mensajes')).toBeInTheDocument();
    });
  });

  it.each([
    ['undefined variables', { name: undefined }, 'Hola {name}'],
    ['missing vars prop', undefined, 'Hola {name}'],
  ])('should preserve placeholders for %s', async (_caseName, vars, expectedText) => {
    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [
        {
          locale: 'es-ES',
          key: 'test-key',
          textHash: '["Hello {name}","test-key"]',
          translation: 'Hola {name}',
        },
      ],
      errors: [],
    });

    render(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-US">
        <Ways context="test-key">
          <T vars={vars}>{'Hello {name}'}</T>
        </Ways>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    await waitFor(() => {
      expect(screen.getByText(expectedText)).toBeInTheDocument();
    });
  });

  it.each([
    ['null', { value: null }, 'Value is {value}', 'El valor es {value}', 'El valor es null'],
    [
      'number',
      { count: 42 },
      'You have {count} items',
      'Tienes {count} artículos',
      'Tienes 42 artículos',
    ],
    ['boolean', { active: true }, 'Status: {active}', 'Estado: {active}', 'Estado: true'],
    [
      'array',
      { items: ['apple', 'banana', 'orange'] },
      'Items: {items}',
      'Artículos: {items}',
      'Artículos: apple,banana,orange',
    ],
  ])('should stringify %s variables', async (_caseName, vars, sourceText, translatedText, expectedText) => {
    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [
        {
          locale: 'es-ES',
          key: 'test-key',
          textHash: JSON.stringify([sourceText, 'test-key']),
          translation: translatedText,
        },
      ],
      errors: [],
    });

    render(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-US">
        <Ways context="test-key">
          <T vars={vars}>{sourceText}</T>
        </Ways>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    await waitFor(() => {
      expect(screen.getByText(expectedText)).toBeInTheDocument();
    });
  });
});
