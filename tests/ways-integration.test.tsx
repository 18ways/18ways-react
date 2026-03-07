import React, { useState } from 'react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { Ways, T, useT, Translations } from '../index';
import { fetchTranslations, fetchSeed } from '@18ways/core/common';
import { clearQueueForTests } from '../testing';

vi.mock('@18ways/core/common', async () => {
  const actual = await vi.importActual('@18ways/core/common');
  return {
    ...actual,
    fetchTranslations: vi.fn(),
    fetchSeed: vi.fn(),
    generateHashId: vi.fn((x) => JSON.stringify(x)),
  };
});

const CompleteApp = () => {
  const [page, setPage] = useState('home');
  const t = useT();

  const Link = ({ href, children }: any) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        setPage(href.slice(1));
      }}
    >
      {children}
    </a>
  );

  return (
    <div>
      <header>
        <Ways context="header">
          <nav>
            <T>Navigation</T>
          </nav>
        </Ways>
      </header>

      <main>
        {page === 'home' && (
          <Ways context="home" components={{ link: Link }}>
            <h1>
              <T>Welcome Home</T>
            </h1>
            <p>
              <T vars={{ user: 'John' }}>{'Hello {user}'}</T>
            </p>
            <T>
              Go to <Link href="/about">About</Link> page
            </T>
          </Ways>
        )}

        {page === 'about' && (
          <Ways context="about" components={{ link: Link }}>
            <h1>
              <T>About Us</T>
            </h1>
            <p>{t('Learn more about our company')}</p>
            <T>
              Back to <Link href="/home">Home</Link>
            </T>
          </Ways>
        )}
      </main>

      <footer>
        <Ways context="footer">
          <T>© 2024 Company</T>
        </Ways>
      </footer>
    </div>
  );
};

describe('WaysRoot - Full Integration', () => {
  beforeEach(() => {
    delete window.__18WAYS_IN_MEMORY_TRANSLATIONS__;
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
          textsHash: '["Persistent Text","test"]',
          translation: ['Texto Persistente'],
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
