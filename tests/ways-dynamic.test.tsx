import React, { useState } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, screen, act } from '@testing-library/react';
import { T } from '../index';
import { fetchTranslations } from '@18ways/core/common';
import { renderWithWays, clearWaysState } from './test-helpers';
import { clearQueueForTests } from '../testing';

vi.mock('@18ways/core/common', async () => {
  const actual = await vi.importActual('@18ways/core/common');
  return {
    ...actual,
    init: vi.fn(),
    fetchTranslations: vi.fn(),
    fetchSeed: vi.fn(),
    generateHashId: vi.fn((x) => JSON.stringify(x)),
  };
});

const ShowOnClick = ({ children }: { children: JSX.Element }) => {
  const [show, setShow] = useState(false);

  return (
    <div>
      <button data-testid="button" onClick={() => setShow(true)}>
        Click Me
      </button>

      {show && children}
    </div>
  );
};

describe('WaysRoot - Dynamic Translation Logic', () => {
  beforeEach(() => {
    clearWaysState();
  });

  it('should dynamically translate new content not initially in the DOM', async () => {
    vi.mocked(fetchTranslations).mockImplementation(async (toTranslate) => {
      if (toTranslate[0].textsHash === '["Hello","key-1"]') {
        return {
          data: [
            {
              key: 'key-1',
              textsHash: '["Hello","key-1"]',
              locale: 'en-GB',
              translation: ['oh hai'],
            },
          ],
          errors: [],
        };
      }

      if (toTranslate[0].textsHash === '["Goodbye","key-1"]') {
        return {
          data: [
            {
              key: 'key-1',
              textsHash: '["Goodbye","key-1"]',
              locale: 'en-GB',
              translation: ['kthxbai'],
            },
          ],
          errors: [],
        };
      }

      throw new Error('Unexpected textsHash');
    });

    renderWithWays(
      <>
        <T>Hello</T>
        <ShowOnClick>
          <T>Goodbye</T>
        </ShowOnClick>
      </>,
      {
        contextKey: 'key-1',
        defaultLocale: 'en-GB',
      }
    );

    await act(async () => {
      await clearQueueForTests();
    });
    expect(screen.getByText('oh hai')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId('button'));
      await clearQueueForTests();
    });
    expect(screen.getByText('kthxbai')).toBeInTheDocument();

    // Check that "Goodbye" was added to the window translations
    expect(window.__18WAYS_IN_MEMORY_TRANSLATIONS__).toMatchObject({
      'en-GB': {
        'key-1': {
          '["Hello","key-1"]': ['oh hai'],
          '["Goodbye","key-1"]': ['kthxbai'],
        },
      },
    });
  });
});
