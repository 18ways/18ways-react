import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Ways } from '../index';
import { fetchSeed, init } from '@18ways/core/common';

vi.mock('@18ways/core/common', async () => {
  const actual = await vi.importActual('@18ways/core/common');
  return {
    ...actual,
    init: vi.fn(),
    fetchSeed: vi.fn().mockResolvedValue({ data: {}, errors: [] }),
  };
});

describe('WaysRoot - Seed call behavior', () => {
  beforeEach(() => {
    delete window.__18WAYS_IN_MEMORY_TRANSLATIONS__;
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
});
