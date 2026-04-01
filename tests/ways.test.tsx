import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { T, Ways } from '../index';
import { fetchConfig, fetchKnown, fetchSeed, fetchTranslations, init } from '@18ways/core/common';
import { resetTestRuntimeState } from '../testing';

vi.mock('@18ways/core/common', async () => {
  const actual = await vi.importActual('@18ways/core/common');
  return {
    ...actual,
    fetchConfig: vi.fn(async () => ({
      languages: [{ code: 'en-GB', name: 'English (UK)' }],
      total: 1,
      translationFallback: { default: 'source', overrides: [] },
    })),
    fetchKnown: vi.fn().mockResolvedValue({ data: [], errors: [] }),
    init: vi.fn(),
    fetchSeed: vi.fn().mockResolvedValue({ data: {}, errors: [] }),
    fetchTranslations: vi.fn().mockResolvedValue({ data: [], errors: [] }),
  };
});

describe('WaysRoot - Seed call behavior', () => {
  beforeEach(() => {
    resetTestRuntimeState();
    delete window.__18WAYS_ACCEPTED_LOCALES__;
    delete window.__18WAYS_IN_MEMORY_TRANSLATIONS__;
    delete window.__18WAYS_TRANSLATION_FALLBACK_CONFIG__;
    vi.clearAllMocks();
  });

  it('does not call seed on client render when root context is provided', () => {
    render(
      <Ways apiKey="test-api-key" locale="en-GB" baseLocale="en-GB" context="key-1">
        <div>Test App</div>
      </Ways>
    );

    expect(vi.mocked(fetchSeed)).not.toHaveBeenCalled();
  });

  it('uses known preflight for same-locale nested contexts on the client', async () => {
    vi.mocked(fetchKnown).mockImplementation(async (entries) => ({
      data: entries,
      errors: [],
    }));

    render(
      <Ways apiKey="test-api-key" locale="en-GB" baseLocale="en-GB">
        <Ways context="key-1">
          <T>Test App</T>
        </Ways>
      </Ways>
    );

    await waitFor(() => {
      expect(vi.mocked(fetchKnown)).toHaveBeenCalledTimes(1);
    });

    expect(vi.mocked(fetchSeed)).not.toHaveBeenCalled();
    expect(vi.mocked(fetchTranslations)).not.toHaveBeenCalled();
  });

  it('does not call seed when root context is missing', () => {
    render(
      <Ways apiKey="test-api-key" locale="en-GB" baseLocale="en-GB">
        <div>Test App</div>
      </Ways>
    );

    expect(vi.mocked(fetchSeed)).not.toHaveBeenCalled();
  });

  it('calls seed on client render for nested contexts when locale differs', async () => {
    render(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-GB">
        <Ways context="key-1">
          <div>Test App</div>
        </Ways>
      </Ways>
    );

    await waitFor(() => {
      expect(vi.mocked(fetchSeed)).toHaveBeenCalledWith(['key-1'], 'es-ES');
    });
  });

  it('passes cacheTtl to init when provided', () => {
    render(
      <Ways apiKey="test-api-key" locale="en-GB" baseLocale="en-GB" cacheTtl={120}>
        <div>Test App</div>
      </Ways>
    );

    expect(vi.mocked(init)).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'test-api-key',
        cacheTtlSeconds: 120,
      })
    );
  });

  it('fetches accepted locales on the client when none are provided or injected', async () => {
    vi.mocked(fetchConfig).mockResolvedValue({
      languages: [
        { code: 'en-GB', name: 'English (UK)' },
        { code: 'es-ES', name: 'Spanish' },
      ],
      total: 2,
      translationFallback: { default: 'source', overrides: [] },
    });

    render(
      <Ways apiKey="test-api-key" locale="en-GB" baseLocale="en-GB">
        <div>Test App</div>
      </Ways>
    );

    await waitFor(() => {
      expect(fetchConfig).toHaveBeenCalledWith();
      expect(window.__18WAYS_ACCEPTED_LOCALES__).toEqual(['en-GB', 'es-ES']);
    });
  });

  it('prepends the base locale when explicit accepted locales omit it', async () => {
    render(
      <Ways
        apiKey="test-api-key"
        locale="es-ES"
        baseLocale="en-US"
        acceptedLocales={['es-ES', 'ja-JP']}
      >
        <div>Test App</div>
      </Ways>
    );

    await waitFor(() => {
      expect(window.__18WAYS_ACCEPTED_LOCALES__).toEqual(['en-US', 'es-ES', 'ja-JP']);
    });
  });
});
