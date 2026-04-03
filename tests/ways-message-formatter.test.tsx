import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { Ways, T } from '../index';
import { fetchSeed, fetchTranslations } from '@18ways/core/common';
import { formatWaysParser } from '@18ways/core/parsers/ways-parser';
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

describe('WaysRoot - Message Formatter', () => {
  beforeEach(() => {
    delete window.__18WAYS_IN_MEMORY_TRANSLATIONS__;
    vi.clearAllMocks();
    vi.mocked(fetchSeed).mockResolvedValue({ data: {} });
  });

  const mockDefaultTranslation = () => {
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
  };

  const mockWaysParserTranslation = (translation: string, source: string) => {
    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [
        {
          locale: 'es-ES',
          key: 'test-key',
          textHash: JSON.stringify([source, 'test-key']),
          translation,
        },
      ],
      errors: [],
    });
  };

  it('defaults to waysParser formatter', async () => {
    mockDefaultTranslation();

    render(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-US">
        <Ways context="test-key">
          <T vars={{ name: 'John' }}>{'Hello {name}'}</T>
        </Ways>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    await waitFor(() => {
      expect(screen.getByText('Hola John')).toBeInTheDocument();
    });
  });

  it('supports the "none" formatter option and skips variable interpolation', async () => {
    mockDefaultTranslation();

    render(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-US" messageFormatter="none">
        <Ways context="test-key">
          <T vars={{ name: 'John' }}>{'Hello {name}'}</T>
        </Ways>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    await waitFor(() => {
      expect(screen.getByText('Hola {name}')).toBeInTheDocument();
      expect(screen.queryByText('Hola John')).not.toBeInTheDocument();
    });
  });

  it('supports a custom formatter function from root context', async () => {
    mockDefaultTranslation();

    render(
      <Ways
        apiKey="test-api-key"
        locale="es-ES"
        baseLocale="en-US"
        messageFormatter={({ text, vars }) =>
          text.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => String(vars[key])).toUpperCase()
        }
      >
        <Ways context="test-key">
          <T vars={{ name: 'John' }}>{'Hello {name}'}</T>
        </Ways>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    await waitFor(() => {
      expect(screen.getByText('HOLA JOHN')).toBeInTheDocument();
    });
  });

  it('supports waysParser simple variables', async () => {
    const source = `
      Hello {name}
    `.trim();
    mockWaysParserTranslation(
      `
        Hola {name}
      `.trim(),
      source
    );

    render(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-US">
        <Ways context="test-key">
          <T vars={{ name: 'John' }}>{source}</T>
        </Ways>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    await waitFor(() => {
      expect(screen.getByText('Hola John')).toBeInTheDocument();
    });
  });

  it('supports waysParser plural branches', async () => {
    const source = `
      {count, plural,
        =0{No messages}
        =1{One message}
        other{{count} messages}
      }
    `.trim();
    mockWaysParserTranslation(source, source);

    render(
      <Ways apiKey="test-api-key" locale="en-US" baseLocale="en-US">
        <Ways context="test-key">
          <div data-testid="plural-output">
            <T vars={{ count: 0 }}>{source}</T>
            <T vars={{ count: 1 }}>{source}</T>
            <T vars={{ count: 3 }}>{source}</T>
          </div>
        </Ways>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    await waitFor(() => {
      const output = screen.getByTestId('plural-output');
      expect(output).toHaveTextContent('No messages');
      expect(output).toHaveTextContent('One message');
      expect(output).toHaveTextContent('3 messages');
    });
  });

  it('supports waysParser select branches', async () => {
    const source = `
      {isLoggedIn, select,
        true{Welcome {name}}
        false{Please log in}
        other{Please log in}
      }
    `.trim();
    mockWaysParserTranslation(source, source);

    render(
      <Ways apiKey="test-api-key" locale="en-US" baseLocale="en-US">
        <Ways context="test-key">
          <T vars={{ isLoggedIn: true, name: 'Alice' }}>{source}</T>
        </Ways>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    await waitFor(() => {
      expect(screen.getByText('Welcome Alice')).toBeInTheDocument();
    });
  });

  it('supports waysParser date formatting', async () => {
    const source = `
      Created at: {createdAt, date, dateStyle:short}
    `.trim();
    mockWaysParserTranslation(
      `
        Fecha: {createdAt, date, dateStyle:short}
      `.trim(),
      source
    );

    render(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-US">
        <Ways context="test-key">
          <T vars={{ createdAt: new Date(2024, 0, 15) }}>{source}</T>
        </Ways>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    await waitFor(() => {
      expect(screen.getByText('Fecha: 15/1/24')).toBeInTheDocument();
    });
  });

  it('supports inline alias syntax for translated date placeholders', async () => {
    const source = `Hello today is {theDate, date, dateStyle:long}`;
    const translation = `Hola hoy es {theDate, date, dateStyle:long}`;
    const theDate = new Date(Date.UTC(2024, 0, 15));
    mockWaysParserTranslation(translation, source);

    render(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-US">
        <Ways context="test-key">
          <T>Hello today is {{ theDate, format: 'date, long' }}</T>
        </Ways>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    await waitFor(() => {
      expect(
        screen.getByText(formatWaysParser({ theDate }, translation, 'es-ES'))
      ).toBeInTheDocument();
    });
  });

  it('supports inline alias syntax for select formats with commas inside branch text', async () => {
    const source =
      '{isSignedIn, select, true{Welcome back, {name}} false{Sign in to continue} other{Sign in to continue}}';
    mockWaysParserTranslation(source, source);

    render(
      <Ways apiKey="test-api-key" locale="en-US" baseLocale="en-US">
        <Ways context="test-key">
          <T vars={{ name: 'Ada' }}>
            {{
              isSignedIn: true,
              format:
                'select, true{Welcome back, {name}} false{Sign in to continue} other{Sign in to continue}',
            }}
          </T>
        </Ways>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    await waitFor(() => {
      expect(screen.getByText('Welcome back, Ada')).toBeInTheDocument();
    });
  });

  it('skips translation fetches for runtime-only waysParser messages', async () => {
    const source = '{createdAt, date, dateStyle:short}';
    const vars = { createdAt: new Date(Date.UTC(2024, 0, 15, 12)) };

    render(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-US">
        <Ways context="test-key">
          <T vars={vars}>{source}</T>
        </Ways>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    expect(fetchTranslations).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByText(formatWaysParser(vars, source, 'es-ES'))).toBeInTheDocument();
    });
  });

  it('treats inline alias syntax as runtime-only when the rewritten message is runtime-only', async () => {
    const theDate = new Date(Date.UTC(2024, 0, 15, 12));
    const source = '{theDate, date, dateStyle:long}';

    render(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-US">
        <Ways context="test-key">
          <T>{{ theDate, format: 'date, long' }}</T>
        </Ways>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    expect(fetchTranslations).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByText(formatWaysParser({ theDate }, source, 'es-ES'))).toBeInTheDocument();
    });
  });

  it('skips translation fetches for bare date placeholders', async () => {
    const source = '{myDate}';
    const vars = { myDate: new Date(Date.UTC(2024, 0, 15, 12)) };

    render(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-US">
        <Ways context="test-key">
          <T vars={vars}>{source}</T>
        </Ways>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    expect(fetchTranslations).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByText(formatWaysParser(vars, source, 'es-ES'))).toBeInTheDocument();
    });
  });

  it('infers date formatting for bare placeholders when value is a Date', async () => {
    const source = `
      Date: {createdAt}
    `.trim();
    mockWaysParserTranslation(source, source);

    render(
      <Ways apiKey="test-api-key" locale="en-US" baseLocale="en-US">
        <Ways context="test-key">
          <T vars={{ createdAt: new Date(Date.UTC(2024, 0, 15)) }}>{source}</T>
        </Ways>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    await waitFor(() => {
      expect(screen.getByText('Date: Jan 15, 2024')).toBeInTheDocument();
    });
  });

  it('keeps waysParser placeholder when variable is missing', async () => {
    const source = `
      Hello {name}
    `.trim();
    mockWaysParserTranslation(
      `
        Hola {name}
      `.trim(),
      source
    );

    render(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-US">
        <Ways context="test-key">
          <T>{source}</T>
        </Ways>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    await waitFor(() => {
      expect(screen.getByText('Hola {name}')).toBeInTheDocument();
    });
  });

  it('uses locale-specific date formatting for waysParser date patterns', async () => {
    const source = `
      Date: {createdAt, date, dateStyle:short}
    `.trim();
    const createdAt = new Date(2024, 0, 15);
    mockWaysParserTranslation(source, source);

    const es = render(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-US">
        <Ways context="test-key">
          <T vars={{ createdAt }}>{source}</T>
        </Ways>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    await waitFor(() => {
      expect(screen.getByText('Date: 15/1/24')).toBeInTheDocument();
    });
    es.unmount();

    mockWaysParserTranslation(source, source);

    render(
      <Ways apiKey="test-api-key" locale="ja-JP" baseLocale="en-US">
        <Ways context="test-key">
          <T vars={{ createdAt }}>{source}</T>
        </Ways>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    await waitFor(() => {
      expect(screen.getByText('Date: 2024/01/15')).toBeInTheDocument();
    });
  });

  it('supports waysParser with number, currency, and datetime', async () => {
    const source = `
      Total: {amount, number, style:currency, currency:EUR} — Date: {createdAt, datetime, dateStyle:short}
    `.trim();
    mockWaysParserTranslation(source, source);

    render(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-US">
        <Ways context="test-key">
          <T vars={{ amount: 1234.5, createdAt: new Date(Date.UTC(2024, 0, 15)) }}>{source}</T>
        </Ways>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    await waitFor(() => {
      const rendered = screen.getByText((text) => text.startsWith('Total:'));
      expect(rendered.textContent).toContain('1234,50');
      expect(rendered.textContent).toContain('€');
      expect(rendered.textContent).toContain('15/1/24');
    });
  });

  it('infers locale number formatting for bare numeric placeholders', async () => {
    const source = 'Count: {count}';
    mockWaysParserTranslation(source, source);

    render(
      <Ways apiKey="test-api-key" locale="en-US" baseLocale="en-US">
        <Ways context="test-key">
          <T vars={{ count: 12345.6 }}>{source}</T>
        </Ways>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    await waitFor(() => {
      expect(screen.getByText('Count: 12,345.6')).toBeInTheDocument();
    });
  });

  it('supports waysParser percent shorthand', async () => {
    const source = 'Share: {share, percent, maximumFractionDigits:1}';
    mockWaysParserTranslation(source, source);

    render(
      <Ways apiKey="test-api-key" locale="en-US" baseLocale="en-US">
        <Ways context="test-key">
          <T vars={{ share: 0.125 }}>{source}</T>
        </Ways>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    await waitFor(() => {
      expect(screen.getByText('Share: 12.5%')).toBeInTheDocument();
    });
  });

  it('supports waysParser money formatter with cents + currency objects', async () => {
    const source = `
      Charge: {diff, money}
    `.trim();
    mockWaysParserTranslation(source, source);

    render(
      <Ways apiKey="test-api-key" locale="en-US" baseLocale="en-US">
        <Ways context="test-key">
          <T vars={{ diff: { amount: 12345, currency: 'USD' } }}>{source}</T>
        </Ways>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    await waitFor(() => {
      expect(screen.getByText('Charge: $123.45')).toBeInTheDocument();
    });
  });

  it('infers money formatting for bare placeholders when value matches money shape', async () => {
    const source = `
      Charge: {diff}
    `.trim();
    mockWaysParserTranslation(source, source);

    render(
      <Ways apiKey="test-api-key" locale="en-US" baseLocale="en-US">
        <Ways context="test-key">
          <T vars={{ diff: { amount: 12345, currency: 'USD' } }}>{source}</T>
        </Ways>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    await waitFor(() => {
      expect(screen.getByText('Charge: $123.45')).toBeInTheDocument();
    });
  });

  it('supports waysParser money formatter allowFractions option', async () => {
    const source = `
      Overage: {rate, money, allowFractions:true}
    `.trim();
    mockWaysParserTranslation(source, source);

    render(
      <Ways apiKey="test-api-key" locale="en-US" baseLocale="en-US">
        <Ways context="test-key">
          <T vars={{ rate: { amount: 3.5, currency: 'USD', divisor: 100 } }}>{source}</T>
        </Ways>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    await waitFor(() => {
      expect(screen.getByText('Overage: $0.035')).toBeInTheDocument();
    });
  });

  it('supports waysParser with relative time and list', async () => {
    const source = `
      {days, relativetime, day, numeric:auto} — {items, list, type:conjunction}
    `.trim();
    mockWaysParserTranslation(source, source);

    render(
      <Ways apiKey="test-api-key" locale="en-US" baseLocale="en-US">
        <Ways context="test-key">
          <T vars={{ days: -1, items: ['red', 'green', 'blue'] }}>{source}</T>
        </Ways>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    await waitFor(() => {
      expect(screen.getByText('yesterday — red, green, and blue')).toBeInTheDocument();
    });
  });

  it('supports waysParser with display names', async () => {
    const source = `
      Language: {languageCode, displayname, language}
    `.trim();
    mockWaysParserTranslation(source, source);

    render(
      <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-US">
        <Ways context="test-key">
          <T vars={{ languageCode: 'en' }}>{source}</T>
        </Ways>
      </Ways>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    await waitFor(() => {
      expect(screen.getByText('Language: inglés')).toBeInTheDocument();
    });
  });
});
