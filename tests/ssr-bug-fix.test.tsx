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
    window.__18WAYS_TRANSLATION_FALLBACK_CONFIG__ = {
      default: 'source',
      overrides: [],
    };

    (global.fetch as any).mockImplementation(async (input: string) => {
      if (input.includes('/config')) {
        return {
          ok: true,
          json: async () => ({
            languages: [
              { code: 'en-US', name: 'English (US)' },
              { code: 'ja-JP', name: 'Japanese' },
            ],
            total: 2,
            translationFallback: {
              default: 'source',
              overrides: [],
            },
          }),
        };
      }

      return {
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
      };
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

    const translateCall = (global.fetch as any).mock.calls.find((call: [string, RequestInit]) =>
      call[0].includes('/translate')
    );
    expect(translateCall).toBeTruthy();

    // Verify the correct locale was requested
    const requestBody = JSON.parse((translateCall as [string, RequestInit])[1].body as string);
    expect(requestBody.payload[0].targetLocale).toBe('ja-JP');
    expect(requestBody.payload[0].baseLocale).toBe('en-US');
  });

  it('queues only a sync-only fetch when targetLocale equals baseLocale', async () => {
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

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    const translateCall = (global.fetch as any).mock.calls.find((call: [string, RequestInit]) =>
      call[0].includes('/translate')
    );
    expect(translateCall).toBeTruthy();

    const requestBody = JSON.parse((translateCall as [string, RequestInit])[1].body as string);
    expect(requestBody.payload[0].targetLocale).toBe('en-US');
    expect(requestBody.payload[0].baseLocale).toBe('en-US');
    expect(requestBody.payload[0].syncOnly).toBe(true);
  });
});
