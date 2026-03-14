import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { Ways, T } from '../index';

// Mock the fetch function
global.fetch = vi.fn();

describe('SSR Bug Fix Test', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();
    window.__18WAYS_ACCEPTED_LOCALES__ = ['en-US', 'ja-JP'];

    // Mock successful translation response
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            locale: 'ja-JP',
            key: 'test',
            textsHash: 'hash123',
            translation: ['こんにちは世界'],
          },
        ],
        errors: [],
      }),
    });
  });

  it('should trigger translation fetch when initial targetLocale differs from baseLocale', async () => {
    const TestComponent = () => {
      return (
        <Ways apiKey="test-key" locale="ja-JP" baseLocale="ja-JP">
          <Ways context="test" baseLocale="en-US">
            <div data-testid="content">
              <T>hello.world</T>
            </div>
          </Ways>
        </Ways>
      );
    };

    const { getByTestId } = render(<TestComponent />);

    // Check that fetch was called to get translations
    await waitFor(
      () => {
        expect(global.fetch).toHaveBeenCalled();
      },
      { timeout: 3000 }
    );

    // Verify the fetch was to the translate endpoint
    const fetchCall = (global.fetch as any).mock.calls[0];
    expect(fetchCall[0]).toContain('/translate');

    // Verify the correct locale was requested
    const requestBody = JSON.parse(fetchCall[1].body);
    expect(requestBody.payload[0].targetLocale).toBe('ja-JP');
    expect(requestBody.payload[0].baseLocale).toBe('en-US');
  });

  it('should NOT trigger translation fetch when targetLocale equals baseLocale', async () => {
    const TestComponent = () => {
      return (
        <Ways apiKey="test-key" locale="en-US" baseLocale="en-US">
          <Ways context="test" baseLocale="en-US">
            <div data-testid="content">
              <T>hello.world</T>
            </div>
          </Ways>
        </Ways>
      );
    };

    render(<TestComponent />);

    // Wait a bit to ensure effect has time to run
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Should NOT have triggered a translation fetch since locale is the same
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
