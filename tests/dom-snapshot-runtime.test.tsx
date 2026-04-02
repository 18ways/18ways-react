import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Ways, T } from '../index';
import { clearQueueForTests, resetTestRuntimeState } from '../testing';

vi.mock('rrweb-snapshot', () => ({
  snapshot: vi.fn(() => ({
    text: document.body.textContent,
  })),
}));

vi.mock('@18ways/core/common', async () => {
  const actual = await vi.importActual<typeof import('@18ways/core/common')>('@18ways/core/common');
  return {
    ...actual,
    fetchAcceptedLocales: vi.fn(async (fallbackLocale?: string) => [
      fallbackLocale || 'en-US',
      'es-ES',
    ]),
    fetchConfig: vi.fn(async () => ({
      languages: [
        { code: 'en-US', name: 'English' },
        { code: 'es-ES', name: 'Spanish' },
      ],
      total: 2,
      translationFallback: { default: 'source', overrides: [] },
    })),
    fetchSeed: vi.fn(async () => ({ data: {}, errors: [] })),
    generateHashId: vi.fn((value) => JSON.stringify(value)),
  };
});

const originalFetch = global.fetch;
const TRANSLATION_ID = 'group-1';
const CONTEXT_FINGERPRINT = JSON.stringify({
  name: 'test-key',
  label: '',
  treePath: '',
  filePath: '',
});

const DynamicGreeting = () => {
  const [name, setName] = useState('Alice');

  return (
    <>
      <button type="button" onClick={() => setName('Bob')}>
        Update name
      </button>
      <span data-testid="greeting">
        <T vars={{ name }}>{'Hello {name}'}</T>
      </span>
    </>
  );
};

const renderSnapshotRuntime = () =>
  render(
    <Ways
      apiKey="test-api-key"
      locale="es-ES"
      baseLocale="en-US"
      acceptedLocales={['en-US', 'es-ES']}
      _apiUrl="https://example.test/api"
    >
      <Ways context="test-key">
        <DynamicGreeting />
      </Ways>
    </Ways>
  );

const translationResponse = () =>
  new Response(
    JSON.stringify({
      data: [
        {
          locale: 'es-ES',
          key: 'test-key',
          textHash: '["Hello {name}","test-key"]',
          contextFingerprint: CONTEXT_FINGERPRINT,
          translationId: TRANSLATION_ID,
          translation: 'Hola {name}',
        },
      ],
      errors: [],
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

const snapshotCoverageResponse = (translationIds: string[] = [TRANSLATION_ID]) =>
  new Response(
    JSON.stringify({
      snapshotRequestTranslationIds: translationIds,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );

const advanceQueuedTimers = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const clearQueueWithFakeTimers = async () => {
  await act(async () => {
    const clearPromise = clearQueueForTests();
    for (let pass = 0; pass < 6; pass += 1) {
      await vi.advanceTimersByTimeAsync(1);
    }
    await clearPromise;
  });
};

describe('DOM snapshot runtime', () => {
  beforeEach(() => {
    resetTestRuntimeState();
    delete window.__18WAYS_ACCEPTED_LOCALES__;
    delete window.__18WAYS_IN_MEMORY_TRANSLATIONS__;
    delete window.__18WAYS_TRANSLATION_FALLBACK_CONFIG__;
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('recaptures when the DOM changes during an in-flight upload', async () => {
    const uploadBodies: Array<{
      snapshot: { text?: string };
      translationSelectorMap: Record<string, string[]>;
    }> = [];
    let resolveFirstUpload: ((response: Response) => void) | null = null;
    let firstUploadPending = true;

    global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.endsWith('/translate')) {
        return translationResponse();
      }

      if (url.endsWith('/dom-snapshots/coverage')) {
        return snapshotCoverageResponse();
      }

      if (url.endsWith('/dom-snapshots/upload')) {
        uploadBodies.push(JSON.parse(String(init?.body)));

        if (firstUploadPending) {
          firstUploadPending = false;
          return await new Promise<Response>((resolve) => {
            resolveFirstUpload = resolve;
          });
        }

        return new Response(null, { status: 200 });
      }

      throw new Error(`Unexpected fetch to ${url}`);
    }) as typeof fetch;

    renderSnapshotRuntime();

    await act(async () => {
      await clearQueueForTests();
    });

    await waitFor(() => {
      expect(screen.getByTestId('greeting')).toHaveTextContent('Hola Alice');
    });

    await waitFor(
      () => {
        expect(uploadBodies).toHaveLength(1);
      },
      { timeout: 2000 }
    );

    fireEvent.click(screen.getByRole('button', { name: 'Update name' }));

    await waitFor(() => {
      expect(screen.getByTestId('greeting')).toHaveTextContent('Hola Bob');
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    expect(resolveFirstUpload).not.toBeNull();
    resolveFirstUpload!(new Response(null, { status: 200 }));

    await waitFor(
      () => {
        expect(uploadBodies).toHaveLength(2);
      },
      { timeout: 2000 }
    );

    expect(uploadBodies[0]?.snapshot.text).toContain('Hola Alice');
    expect(uploadBodies[1]?.snapshot.text).toContain('Hola Bob');
    expect(uploadBodies[0]?.translationSelectorMap[TRANSLATION_ID]?.length).toBeGreaterThan(0);
    expect(uploadBodies[1]?.translationSelectorMap[TRANSLATION_ID]?.length).toBeGreaterThan(0);
  });

  it('stops retrying after a permanent upload failure', async () => {
    const uploadStatuses: number[] = [];
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.endsWith('/translate')) {
        return translationResponse();
      }

      if (url.endsWith('/dom-snapshots/coverage')) {
        return snapshotCoverageResponse();
      }

      if (url.endsWith('/dom-snapshots/upload')) {
        uploadStatuses.push(403);
        return new Response(null, { status: 403 });
      }

      throw new Error(`Unexpected fetch to ${url}`);
    }) as typeof fetch;

    try {
      renderSnapshotRuntime();

      await act(async () => {
        await clearQueueForTests();
      });

      await waitFor(() => {
        expect(screen.getByTestId('greeting')).toHaveTextContent('Hola Alice');
        expect(uploadStatuses).toHaveLength(1);
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
      });

      expect(uploadStatuses).toHaveLength(1);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('backs off and gives up after repeated retryable upload failures', async () => {
    const uploadStatuses: number[] = [];
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers();

    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.endsWith('/translate')) {
        return translationResponse();
      }

      if (url.endsWith('/dom-snapshots/coverage')) {
        return snapshotCoverageResponse();
      }

      if (url.endsWith('/dom-snapshots/upload')) {
        uploadStatuses.push(503);
        return new Response(null, { status: 503 });
      }

      throw new Error(`Unexpected fetch to ${url}`);
    }) as typeof fetch;

    try {
      renderSnapshotRuntime();

      await clearQueueWithFakeTimers();
      await advanceQueuedTimers(20000);

      expect(screen.getByTestId('greeting')).toHaveTextContent('Hola Alice');
      expect(uploadStatuses).toHaveLength(5);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('skips uploads when coverage says fresh snapshots already exist', async () => {
    const uploadStatuses: number[] = [];

    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.endsWith('/translate')) {
        return translationResponse();
      }

      if (url.endsWith('/dom-snapshots/coverage')) {
        return snapshotCoverageResponse([]);
      }

      if (url.endsWith('/dom-snapshots/upload')) {
        uploadStatuses.push(200);
        return new Response(null, { status: 200 });
      }

      throw new Error(`Unexpected fetch to ${url}`);
    }) as typeof fetch;

    renderSnapshotRuntime();

    await act(async () => {
      await clearQueueForTests();
    });

    await waitFor(() => {
      expect(screen.getByTestId('greeting')).toHaveTextContent('Hola Alice');
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });

    expect(uploadStatuses).toHaveLength(0);
  });

  it('does not start DOM snapshot uploads for the demo token', async () => {
    const uploadStatuses: number[] = [];

    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.endsWith('/dom-snapshots/upload')) {
        uploadStatuses.push(200);
        return new Response(null, { status: 200 });
      }

      throw new Error(`Unexpected network fetch to ${url}`);
    }) as typeof fetch;

    render(
      <Ways
        apiKey="pk_dummy_demo_token"
        locale="en-US-x-caesar"
        baseLocale="en-US"
        acceptedLocales={['en-US', 'en-US-x-caesar']}
        _apiUrl="https://example.test/api"
      >
        <Ways context="test-key">
          <span data-testid="demo-greeting">
            <T>Hello</T>
          </span>
        </Ways>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    await waitFor(() => {
      expect(screen.getByTestId('demo-greeting')).toHaveTextContent('Uryyb');
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });

    expect(uploadStatuses).toHaveLength(0);
  });
});
