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
    fetchSeed: vi.fn(),
    fetchTranslations: vi.fn(),
    generateHashId: vi.fn((x) => JSON.stringify(x)),
  };
});

const expectSingleTranslationRequest = (expectedText: string) => {
  expect(vi.mocked(fetchTranslations)).toHaveBeenCalledWith([
    expect.objectContaining({
      text: expectedText,
    }),
  ]);
};

const normalizeHtml = (html: string): string => html.replace(/\s+/g, ' ').trim();

const RichTestWrapper = ({ children, context }: { children: React.ReactNode; context: string }) => (
  <Ways apiKey="test-api-key" locale="es-ES" baseLocale="en-US">
    <Ways context={context}>
      <div data-testid="output">{children}</div>
    </Ways>
  </Ways>
);

const Pill = ({
  children,
  className = 'pill',
}: {
  children?: React.ReactNode;
  className?: string;
}) => (
  <span className={className} data-kind="pill">
    {children}
  </span>
);

describe('WaysRoot - Rich Text', () => {
  beforeEach(() => {
    delete window.__18WAYS_IN_MEMORY_TRANSLATIONS__;
    vi.clearAllMocks();
    vi.mocked(fetchSeed).mockResolvedValue({ data: {} });
  });

  it('serializes JSX-rich content as a single markup string and renders translated output', async () => {
    const sourceText = 'If you want to <link>click here</link> then you will see more';
    const translatedText = 'Si quieres <link>hacer clic aquí</link> verás más';

    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [
        {
          locale: 'es-ES',
          key: 'rich-key',
          textHash: JSON.stringify([sourceText, 'rich-key']),
          translation: translatedText,
        },
      ],
      errors: [],
    });

    render(
      <RichTestWrapper context="rich-key">
        <T>
          If you want to <a href="/docs">click here</a> then you will see more
        </T>
      </RichTestWrapper>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    const output = await screen.findByTestId('output');

    expect(output.textContent).toBe('Si quieres hacer clic aquí verás más');
    expect(normalizeHtml(output.innerHTML)).toBe(
      'Si quieres <a href="/docs">hacer clic aquí</a> verás más'
    );
    expectSingleTranslationRequest(sourceText);
  });

  it('escapes literal angle brackets inside rich source text', async () => {
    const sourceText = '2 &lt; 3 and <link>learn more</link>';

    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [
        {
          locale: 'es-ES',
          key: 'escaped-rich-key',
          textHash: JSON.stringify([sourceText, 'escaped-rich-key']),
          translation: sourceText,
        },
      ],
      errors: [],
    });

    render(
      <RichTestWrapper context="escaped-rich-key">
        <T>
          2 {'<'} 3 and <a href="/docs">learn more</a>
        </T>
      </RichTestWrapper>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    const output = await screen.findByTestId('output');

    expect(output.textContent).toBe('2 < 3 and learn more');
    expect(normalizeHtml(output.innerHTML)).toBe('2 &lt; 3 and <a href="/docs">learn more</a>');
    expectSingleTranslationRequest(sourceText);
  });

  it('renders void intrinsic elements without passing children back into React', async () => {
    const sourceText = 'Line one.<br />Line two.';
    const translatedText = 'Linea dos.<br />Linea uno.';

    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [
        {
          locale: 'es-ES',
          key: 'void-element-slot',
          textHash: JSON.stringify([sourceText, 'void-element-slot']),
          translation: translatedText,
        },
      ],
      errors: [],
    });

    render(
      <RichTestWrapper context="void-element-slot">
        <T>
          Line one.
          <br />
          Line two.
        </T>
      </RichTestWrapper>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    const output = await screen.findByTestId('output');

    expect(output.textContent).toBe('Linea dos.Linea uno.');
    expect(normalizeHtml(output.innerHTML)).toBe('Linea dos.<br>Linea uno.');
    expectSingleTranslationRequest(sourceText);
  });

  it('serializes empty non-void elements as self-closing placeholders', async () => {
    const sourceText = 'Before<slot1 />After';
    const translatedText = 'Despues<slot1 />Antes';

    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [
        {
          locale: 'es-ES',
          key: 'empty-non-void-slot',
          textHash: JSON.stringify([sourceText, 'empty-non-void-slot']),
          translation: translatedText,
        },
      ],
      errors: [],
    });

    render(
      <RichTestWrapper context="empty-non-void-slot">
        <T>
          Before
          <p />
          After
        </T>
      </RichTestWrapper>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    const output = await screen.findByTestId('output');

    expect(output.textContent).toBe('DespuesAntes');
    expect(normalizeHtml(output.innerHTML)).toBe('Despues<p></p>Antes');
    expectSingleTranslationRequest(sourceText);
  });

  it('can completely reorder two different component slots', async () => {
    const sourceText = 'Read <link>the docs</link> or <bold>act now</bold>.';
    const translatedText = '<bold>Actua ahora</bold> o lee <link>la documentacion</link>.';

    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [
        {
          locale: 'es-ES',
          key: 'reordered-two-slots',
          textHash: JSON.stringify([sourceText, 'reordered-two-slots']),
          translation: translatedText,
        },
      ],
      errors: [],
    });

    render(
      <RichTestWrapper context="reordered-two-slots">
        <T>
          Read <a href="/docs">the docs</a> or <strong>act now</strong>.
        </T>
      </RichTestWrapper>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    const output = await screen.findByTestId('output');

    expect(output.textContent).toBe('Actua ahora o lee la documentacion.');
    expect(normalizeHtml(output.innerHTML)).toBe(
      '<strong>Actua ahora</strong> o lee <a href="/docs">la documentacion</a>.'
    );
    expectSingleTranslationRequest(sourceText);
  });

  it('renders nested slots alongside another sibling slot after reordering', async () => {
    const sourceText = '<bold><link>Open</link></bold> and <slot1>New badge</slot1>';
    const translatedText = '<slot1>Insignia nueva</slot1>: <bold><link>Abrir</link></bold>';

    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [
        {
          locale: 'es-ES',
          key: 'nested-and-sibling-slots',
          textHash: JSON.stringify([sourceText, 'nested-and-sibling-slots']),
          translation: translatedText,
        },
      ],
      errors: [],
    });

    render(
      <RichTestWrapper context="nested-and-sibling-slots">
        <T>
          <b>
            <a href="/open">Open</a>
          </b>{' '}
          and <span className="badge">New badge</span>
        </T>
      </RichTestWrapper>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    const output = await screen.findByTestId('output');

    expect(output.textContent).toBe('Insignia nueva: Abrir');
    expect(normalizeHtml(output.innerHTML)).toBe(
      '<span class="badge">Insignia nueva</span>: <b><a href="/open">Abrir</a></b>'
    );
    expectSingleTranslationRequest(sourceText);
  });

  it('supports custom React components when an alias is provided', async () => {
    const sourceText = '<pill>New</pill> <link>launch notes</link>';
    const translatedText = '<link>notas del lanzamiento</link> <pill>Novedad</pill>';

    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [
        {
          locale: 'es-ES',
          key: 'custom-component-slot',
          textHash: JSON.stringify([sourceText, 'custom-component-slot']),
          translation: translatedText,
        },
      ],
      errors: [],
    });

    render(
      <RichTestWrapper context="custom-component-slot">
        <T components={{ pill: Pill }}>
          <Pill>New</Pill> <a href="/launch">launch notes</a>
        </T>
      </RichTestWrapper>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    const output = await screen.findByTestId('output');

    expect(output.textContent).toBe('notas del lanzamiento Novedad');
    expect(normalizeHtml(output.innerHTML)).toBe(
      '<a href="/launch">notas del lanzamiento</a> <span class="pill" data-kind="pill">Novedad</span>'
    );
    expectSingleTranslationRequest(sourceText);
  });

  it('falls back to slot names for custom React components without a components alias', async () => {
    const sourceText = '<slot1>New</slot1> <link>launch notes</link>';
    const translatedText = '<link>notas del lanzamiento</link> <slot1>Novedad</slot1>';

    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [
        {
          locale: 'es-ES',
          key: 'custom-component-without-alias',
          textHash: JSON.stringify([sourceText, 'custom-component-without-alias']),
          translation: translatedText,
        },
      ],
      errors: [],
    });

    render(
      <RichTestWrapper context="custom-component-without-alias">
        <T>
          <Pill>New</Pill> <a href="/launch">launch notes</a>
        </T>
      </RichTestWrapper>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    const output = await screen.findByTestId('output');

    expect(output.textContent).toBe('notas del lanzamiento Novedad');
    expect(normalizeHtml(output.innerHTML)).toBe(
      '<a href="/launch">notas del lanzamiento</a> <span class="pill" data-kind="pill">Novedad</span>'
    );
    expectSingleTranslationRequest(sourceText);
  });

  it('preserves distinct identities for repeated bold slots when they are reordered', async () => {
    const sourceText = '<bold>Fast</bold>, <bold2>safe</bold2>, and <bold3>simple</bold3>.';
    const translatedText = '<bold3>Sencillo</bold3>, <bold2>seguro</bold2>, y <bold>rapido</bold>.';

    vi.mocked(fetchTranslations).mockResolvedValue({
      data: [
        {
          locale: 'es-ES',
          key: 'reordered-duplicate-bold-slots',
          textHash: JSON.stringify([sourceText, 'reordered-duplicate-bold-slots']),
          translation: translatedText,
        },
      ],
      errors: [],
    });

    render(
      <RichTestWrapper context="reordered-duplicate-bold-slots">
        <T>
          <b>Fast</b>, <b>safe</b>, and <b>simple</b>.
        </T>
      </RichTestWrapper>
    );

    await act(async () => {
      await clearQueueForTests();
    });

    const output = await screen.findByTestId('output');

    expect(output.textContent).toBe('Sencillo, seguro, y rapido.');
    expect(normalizeHtml(output.innerHTML)).toBe(
      '<b>Sencillo</b>, <b>seguro</b>, y <b>rapido</b>.'
    );
    expectSingleTranslationRequest(sourceText);
  });
});
