import React, { type ReactElement, type ReactNode } from 'react';
import {
  serializeRichTextToMarkup,
  type RichTextNode,
  type RichTextValue,
} from '@18ways/core/rich-text';

type ComponentsMap = Record<string, string | React.ComponentType<any>>;

export type RichTextSlotRenderers = Record<string, React.ComponentType<{ children?: ReactNode }>>;

export type ExtractedTranslationMessage =
  | {
      kind: 'plain';
      texts: string[];
    }
  | {
      kind: 'rich';
      markup: string;
      value: RichTextValue;
      slotRenderers: RichTextSlotRenderers;
    };

const BUILTIN_SLOT_ALIASES: Record<string, string> = {
  a: 'link',
  b: 'bold',
  br: 'br',
  strong: 'bold',
  em: 'italic',
  i: 'italic',
  code: 'code',
  mark: 'mark',
  small: 'small',
  sub: 'sub',
  sup: 'sup',
};

const VOID_INTRINSIC_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const createRendererFromElement = (
  element: ReactElement<any>
): React.ComponentType<{ children?: ReactNode }> => {
  const originalProps = { ...(element.props as Record<string, unknown>) };
  delete originalProps.children;

  if (typeof element.type === 'string' && VOID_INTRINSIC_ELEMENTS.has(element.type)) {
    return () => React.createElement(element.type as React.ElementType, originalProps);
  }

  return ({ children }: { children?: ReactNode }) =>
    React.createElement(element.type as React.ElementType, originalProps, children);
};

export const extractTranslationMessage = (
  node: ReactNode,
  components: ComponentsMap = {}
): ExtractedTranslationMessage => {
  const slotRenderers: RichTextSlotRenderers = {};
  const slotCounts = new Map<string, number>();
  let anonymousSlotCount = 0;
  let hasRichContent = false;

  const resolveSlotBaseName = (element: ReactElement<any>): string | null => {
    if (typeof element.type === 'string') {
      if (BUILTIN_SLOT_ALIASES[element.type]) {
        return BUILTIN_SLOT_ALIASES[element.type];
      }

      if (components[element.type]) {
        return element.type;
      }
    }

    for (const [name, component] of Object.entries(components)) {
      if (component === element.type) {
        return name;
      }
    }

    return null;
  };

  const allocateSlotName = (baseName: string | null): string => {
    if (!baseName) {
      anonymousSlotCount += 1;
      return `slot${anonymousSlotCount}`;
    }

    const count = slotCounts.get(baseName) || 0;
    slotCounts.set(baseName, count + 1);
    return count === 0 ? baseName : `${baseName}${count + 1}`;
  };

  const visit = (value: ReactNode): RichTextNode[] => {
    if (typeof value === 'string' || typeof value === 'number') {
      return [
        {
          type: 'text',
          value: value.toString(),
        },
      ];
    }

    if (Array.isArray(value)) {
      return value.flatMap(visit);
    }

    if (!React.isValidElement(value)) {
      return [];
    }

    if (value.type === React.Fragment) {
      return visit((value.props as { children?: ReactNode }).children);
    }

    hasRichContent = true;
    const slotName = allocateSlotName(resolveSlotBaseName(value));
    slotRenderers[slotName] = createRendererFromElement(value);

    return [
      {
        type: 'slot',
        name: slotName,
        children: visit((value.props as { children?: ReactNode }).children),
      },
    ];
  };

  const nodes = visit(node);
  if (!hasRichContent) {
    const fullText = nodes
      .filter((child): child is Extract<RichTextNode, { type: 'text' }> => child.type === 'text')
      .map((child) => child.value)
      .join('');

    return {
      kind: 'plain',
      texts: [fullText],
    };
  }

  return {
    kind: 'rich',
    markup: serializeRichTextToMarkup(nodes),
    value: {
      kind: 'rich',
      nodes,
    },
    slotRenderers,
  };
};

export const renderRichTextValue = (params: {
  value: RichTextValue;
  slotRenderers: RichTextSlotRenderers;
  renderText: (text: string) => ReactNode;
}): ReactNode => {
  const visit = (nodes: RichTextNode[]): ReactNode[] =>
    nodes.map((node, index) => {
      if (node.type === 'text') {
        return (
          <React.Fragment key={`text-${index}`}>{params.renderText(node.value)}</React.Fragment>
        );
      }

      const SlotRenderer = params.slotRenderers[node.name];
      const children = visit(node.children);

      if (!SlotRenderer) {
        return (
          <React.Fragment key={`slot-missing-${node.name}-${index}`}>{children}</React.Fragment>
        );
      }

      return <SlotRenderer key={`slot-${node.name}-${index}`}>{children}</SlotRenderer>;
    });

  const rendered = visit(params.value.nodes);
  return rendered.length === 1 ? rendered[0] : <>{rendered}</>;
};
