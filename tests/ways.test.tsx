import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { Ways } from '../index';
import { fetchConfig, fetchSeed, init } from '@18ways/core/common';
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
    init: vi.fn(),
    fetchSeed: vi.fn().mockResolvedValue({ data: {}, errors: [] }),
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

  it('does not call seed when root context is missing', () => {
    render(
      <Ways apiKey="test-api-key" locale="en-GB" baseLocale="en-GB">
        <div>Test App</div>
      </Ways>
    );

    expect(vi.mocked(fetchSeed)).not.toHaveBeenCalled();
  });

  it('does not call seed on client render for nested contexts when locale differs', () => {
    render(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-GB">
        <Ways context="key-1">
          <div>Test App</div>
        </Ways>
      </Ways>
    );

    expect(vi.mocked(fetchSeed)).not.toHaveBeenCalled();
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
      expect(fetchConfig).toHaveBeenCalledWith({
        apiKey: 'test-api-key',
        apiUrl: undefined,
        origin: undefined,
        fetcher: undefined,
        cacheTtlSeconds: undefined,
        _requestInitDecorator: undefined,
      });
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
