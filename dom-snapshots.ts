import {
  subscribeRuntimeNetworkEvents,
  type RuntimeNetworkEvent,
  type SnapshotTranslationEntry,
  type _RequestInitDecorator,
} from '@18ways/core/common';
import { flushSync } from 'react-dom';
import { registerRuntimeResetFn } from './testing';

const DOM_SNAPSHOT_REFRESH_MS = 30 * 24 * 60 * 60 * 1000;
const DOM_SETTLE_DELAY_MS = 120;
const POISON_CHAR = '\u2063';

interface DomSnapshotRuntimeOptions {
  apiKey: string;
  apiUrl?: string;
  requestOrigin?: string;
  requestInitDecorator?: _RequestInitDecorator;
  getTargetLocale: () => string;
  getBaseLocale: () => string;
}

interface RuntimeTranslationIdentity {
  locale: string;
  key: string;
  textHash: string;
  contextFingerprint?: string | null;
}

interface RuntimeTranslationEntry extends SnapshotTranslationEntry {
  locale: string;
}

interface RenderedTranslationRecord {
  sourceTexts: string[];
  translatedTexts: string[];
  visibleTexts: Set<string>;
}

interface CapturePayload {
  snapshot: unknown;
  translationSelectorMap: Record<string, string[]>;
  pageUrl: string;
  pagePathTemplate: string;
  viewport: { width: number; height: number } | null;
  capturedAt: string;
}

const normalizeApiBase = (apiUrl?: string): string => {
  const base = (apiUrl || 'https://internal.18ways.com/api').replace(/\/$/, '');
  if (base.endsWith('/api')) {
    return base;
  }
  return `${base}/api`;
};

const toSnapshotUploadUrl = (apiUrl?: string): string =>
  `${normalizeApiBase(apiUrl)}/dom-snapshots/upload`;

const unique = <T>(values: T[]): T[] => Array.from(new Set(values));

const normalizeContextFingerprint = (value?: string | null): string =>
  typeof value === 'string' ? value.trim() : '';

const buildTranslationIdentityKey = (identity: RuntimeTranslationIdentity): string =>
  JSON.stringify([
    identity.locale.trim(),
    identity.key.trim(),
    identity.textHash.trim(),
    normalizeContextFingerprint(identity.contextFingerprint),
  ]);

const arraysEqual = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const renderedTranslationsByIdentity = new Map<string, RenderedTranslationRecord>();
const temporaryOverridesByIdentity = new Map<string, string[]>();
const overrideListeners = new Set<() => void>();
let overrideVersion = 0;

const emitOverrideChange = (): void => {
  overrideVersion += 1;
  overrideListeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      console.error('[18ways] DOM snapshot override listener failed:', error);
    }
  });
};

export const subscribeDomSnapshotOverrideVersion = (listener: () => void): (() => void) => {
  overrideListeners.add(listener);
  return () => {
    overrideListeners.delete(listener);
  };
};

export const getDomSnapshotOverrideVersion = (): number => overrideVersion;

export const getDomSnapshotTranslationOverride = (
  identity: RuntimeTranslationIdentity
): string[] | null => {
  const override = temporaryOverridesByIdentity.get(buildTranslationIdentityKey(identity));
  return override ? [...override] : null;
};

export const recordDomSnapshotRenderedTranslation = (
  params: RuntimeTranslationIdentity & {
    sourceTexts: string[];
    translatedTexts: string[];
    visibleTexts: string[];
  }
): void => {
  if (typeof window === 'undefined') {
    return;
  }

  const identityKey = buildTranslationIdentityKey(params);
  const existing = renderedTranslationsByIdentity.get(identityKey);
  const nextVisibleTexts = new Set<string>(existing?.visibleTexts || []);
  params.visibleTexts.forEach((text) => {
    if (typeof text === 'string' && text.trim()) {
      nextVisibleTexts.add(text);
    }
  });

  if (
    existing &&
    arraysEqual(existing.sourceTexts, params.sourceTexts) &&
    arraysEqual(existing.translatedTexts, params.translatedTexts) &&
    nextVisibleTexts.size === existing.visibleTexts.size
  ) {
    return;
  }

  renderedTranslationsByIdentity.set(identityKey, {
    sourceTexts: [...params.sourceTexts],
    translatedTexts: [...params.translatedTexts],
    visibleTexts: nextVisibleTexts,
  });
};

const commitTemporaryOverrides = (overrides: Map<string, string[]>): void => {
  flushSync(() => {
    temporaryOverridesByIdentity.clear();
    overrides.forEach((texts, identityKey) => {
      temporaryOverridesByIdentity.set(identityKey, [...texts]);
    });
    emitOverrideChange();
  });
};

const clearTemporaryOverrides = (): void => {
  if (!temporaryOverridesByIdentity.size) {
    return;
  }

  flushSync(() => {
    temporaryOverridesByIdentity.clear();
    emitOverrideChange();
  });
};

export const setDomSnapshotTranslationOverridesForTesting = (
  overrides: Array<
    RuntimeTranslationIdentity & {
      translatedTexts: string[];
    }
  >
): void => {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('This function is only available in test environments');
  }

  const nextOverrides = new Map<string, string[]>();
  overrides.forEach((entry) => {
    nextOverrides.set(buildTranslationIdentityKey(entry), [...entry.translatedTexts]);
  });

  commitTemporaryOverrides(nextOverrides);
};

export const clearDomSnapshotTranslationOverridesForTesting = (): void => {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('This function is only available in test environments');
  }

  clearTemporaryOverrides();
};

const simpleCssEscape = (value: string): string =>
  value.replace(/([\\"'#.:\[\](),>+~*^$|=\s])/g, '\\$1');

const buildSelector = (element: Element): string => {
  const parts: string[] = [];
  let current: Element | null = element;

  while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
    if (current.id) {
      parts.unshift(`#${simpleCssEscape(current.id)}`);
      break;
    }

    const tag = current.tagName.toLowerCase();
    const testId = current.getAttribute('data-testid');
    if (testId) {
      parts.unshift(`${tag}[data-testid="${simpleCssEscape(testId)}"]`);
    } else {
      const classNames = Array.from(current.classList).slice(0, 2);
      const classSuffix = classNames.length
        ? classNames.map((className) => `.${simpleCssEscape(className)}`).join('')
        : '';
      const parent = current.parentElement;
      const siblings = parent
        ? Array.from(parent.children).filter((child) => child.tagName === current!.tagName)
        : [];
      const index = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : '';
      parts.unshift(`${tag}${classSuffix}${index}`);
    }

    current = current.parentElement;
  }

  return parts.join(' > ');
};

const collectTextNodes = (): Array<{ node: Text; text: string }> => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.textContent || '';
      if (!text.trim()) {
        return NodeFilter.FILTER_REJECT;
      }
      if (!(node.parentElement instanceof HTMLElement)) {
        return NodeFilter.FILTER_REJECT;
      }
      if (node.parentElement.closest('[data-18ways-ignore="true"]')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes: Array<{ node: Text; text: string }> = [];
  let current = walker.nextNode();
  while (current) {
    const textNode = current as Text;
    nodes.push({ node: textNode, text: textNode.textContent || '' });
    current = walker.nextNode();
  }

  return nodes;
};

const loadSnapshot = async (): Promise<unknown> => {
  const mod = await import('rrweb-snapshot');
  if (typeof mod.snapshot === 'function') {
    return mod.snapshot(document);
  }
  throw new Error('rrweb-snapshot snapshot() is unavailable');
};

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const currentPathTemplate = (): string => {
  const path = window.location.pathname || '/';
  return path.replace(/\/[0-9]+/g, '/:id').replace(/\/[0-9a-f]{8,}/gi, '/:slug');
};

const normalizeVisibleText = (value: string): string => value.trim();

const countPoisonChars = (value: string): number => {
  if (!value) {
    return 0;
  }

  return (value.match(new RegExp(POISON_CHAR, 'g')) || []).length;
};

const stripPoisonChars = (value: string): string => value.replace(new RegExp(POISON_CHAR, 'g'), '');

class DomSnapshotRuntime {
  private options: DomSnapshotRuntimeOptions;
  private translationEntriesById = new Map<string, RuntimeTranslationEntry>();
  private translationIdsToCapture = new Set<string>();
  private lastCapturedByTranslationId = new Map<string, number>();
  private unsubscribeNetwork: (() => void) | null = null;
  private mutationObserver: MutationObserver | null = null;
  private captureTimer: number | null = null;
  private captureInFlight = false;
  private ignoreMutations = false;

  constructor(options: DomSnapshotRuntimeOptions) {
    this.options = options;
  }

  start = (): void => {
    this.unsubscribeNetwork = subscribeRuntimeNetworkEvents(this.onNetworkEvent);
    if (typeof MutationObserver === 'function') {
      this.mutationObserver = new MutationObserver(() => {
        if (this.ignoreMutations || !this.translationIdsToCapture.size) {
          return;
        }
        this.scheduleCapture();
      });
      this.mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }
  };

  stop = (): void => {
    this.unsubscribeNetwork?.();
    this.unsubscribeNetwork = null;

    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }

    if (this.captureTimer !== null) {
      clearTimeout(this.captureTimer);
      this.captureTimer = null;
    }

    this.ignoreMutations = false;
    clearTemporaryOverrides();
  };

  private onNetworkEvent = (event: RuntimeNetworkEvent): void => {
    const now = Date.now();

    if (event.type === 'seed') {
      event.result.translationEntries?.forEach((entry) => {
        this.translationEntriesById.set(entry.translationId, {
          ...entry,
          locale: event.targetLocale,
        });
      });
      (event.result.snapshotRequestTranslationIds || []).forEach((translationId) => {
        if (!translationId) return;
        this.translationIdsToCapture.add(translationId);
      });
    }

    if (event.type === 'translate') {
      event.result.data.forEach((entry) => {
        if (!entry.translationId) {
          return;
        }
        const contextFingerprint = entry.contextFingerprint || undefined;
        this.translationEntriesById.set(entry.translationId, {
          translationId: entry.translationId,
          key: entry.key,
          textHash: entry.textHash,
          contextFingerprint,
          locale: entry.locale,
        });
      });
      (event.result.snapshotRequestTranslationIds || []).forEach((translationId) => {
        if (!translationId) return;
        this.translationIdsToCapture.add(translationId);
      });
    }

    this.translationEntriesById.forEach((_, translationId) => {
      const last = this.lastCapturedByTranslationId.get(translationId);
      if (!last || now - last > DOM_SNAPSHOT_REFRESH_MS) {
        this.translationIdsToCapture.add(translationId);
      }
    });

    if (this.translationIdsToCapture.size) {
      this.scheduleCapture();
    }
  };

  private scheduleCapture = (): void => {
    if (this.captureTimer !== null) {
      clearTimeout(this.captureTimer);
    }

    this.captureTimer = window.setTimeout(() => {
      this.captureTimer = null;
      void this.captureAndUpload();
    }, DOM_SETTLE_DELAY_MS);
  };

  private assignPoisonLengths = (
    duplicateBuckets: Array<readonly [string, string[]]>
  ): Map<string, number> => {
    const neighborsByTranslationId = new Map<string, Set<string>>();

    duplicateBuckets.forEach(([, translationIds]) => {
      translationIds.forEach((translationId) => {
        const neighbors = neighborsByTranslationId.get(translationId) || new Set<string>();
        translationIds.forEach((otherTranslationId) => {
          if (otherTranslationId !== translationId) {
            neighbors.add(otherTranslationId);
          }
        });
        neighborsByTranslationId.set(translationId, neighbors);
      });
    });

    const poisonLengthByTranslationId = new Map<string, number>();
    Array.from(neighborsByTranslationId.entries())
      .sort(
        ([leftId, leftNeighbors], [rightId, rightNeighbors]) =>
          rightNeighbors.size - leftNeighbors.size || leftId.localeCompare(rightId)
      )
      .forEach(([translationId, neighbors]) => {
        const usedLengths = new Set<number>();
        neighbors.forEach((neighborId) => {
          const assignedLength = poisonLengthByTranslationId.get(neighborId);
          if (assignedLength) {
            usedLengths.add(assignedLength);
          }
        });

        let nextLength = 1;
        while (usedLengths.has(nextLength)) {
          nextLength += 1;
        }

        poisonLengthByTranslationId.set(translationId, nextLength);
      });

    return poisonLengthByTranslationId;
  };

  private withTemporaryOverrides = async <T>(
    overrides: Map<string, string[]>,
    callback: () => Promise<T>
  ): Promise<T> => {
    if (!overrides.size) {
      return callback();
    }

    this.ignoreMutations = true;
    commitTemporaryOverrides(overrides);
    await wait(0);

    try {
      return await callback();
    } finally {
      clearTemporaryOverrides();
      await wait(0);
      this.ignoreMutations = false;
    }
  };

  private buildSelectorMap = async (): Promise<Record<string, string[]>> => {
    const translationEntries = Array.from(this.translationEntriesById.values()).filter((entry) =>
      this.translationIdsToCapture.has(entry.translationId)
    );
    const nodes = collectTextNodes();
    const selectorsByTranslationId = new Map<string, Set<string>>();
    const translationIdsByVisibleText = new Map<string, Set<string>>();
    const renderedRecordsByTranslationId = new Map<
      string,
      {
        identityKey: string;
        translatedTexts: string[];
      }
    >();

    translationEntries.forEach((entry) => {
      const identityKey = buildTranslationIdentityKey({
        locale: entry.locale,
        key: entry.key,
        textHash: entry.textHash,
        contextFingerprint: entry.contextFingerprint,
      });
      const record = renderedTranslationsByIdentity.get(identityKey);
      if (!record || !record.translatedTexts.length) {
        return;
      }

      const visibleTexts = unique(
        Array.from(record.visibleTexts).map(normalizeVisibleText).filter(Boolean)
      );
      if (!visibleTexts.length) {
        return;
      }

      renderedRecordsByTranslationId.set(entry.translationId, {
        identityKey,
        translatedTexts: [...record.translatedTexts],
      });

      visibleTexts.forEach((visibleText) => {
        const translationIds = translationIdsByVisibleText.get(visibleText) || new Set<string>();
        translationIds.add(entry.translationId);
        translationIdsByVisibleText.set(visibleText, translationIds);
      });
    });

    const directTextToNodeSelectors = new Map<string, string[]>();
    nodes.forEach(({ node, text }) => {
      const normalized = normalizeVisibleText(text);
      if (!normalized) {
        return;
      }

      const selector = buildSelector(node.parentElement || document.body);
      const selectors = directTextToNodeSelectors.get(normalized) || [];
      selectors.push(selector);
      directTextToNodeSelectors.set(normalized, unique(selectors));
    });

    translationIdsByVisibleText.forEach((translationIds, visibleText) => {
      if (translationIds.size !== 1) {
        return;
      }

      const selectors = directTextToNodeSelectors.get(visibleText) || [];
      if (!selectors.length) {
        return;
      }

      const translationId = Array.from(translationIds)[0];
      const currentSelectors = selectorsByTranslationId.get(translationId) || new Set<string>();
      selectors.forEach((selector) => currentSelectors.add(selector));
      selectorsByTranslationId.set(translationId, currentSelectors);
    });

    const duplicateBuckets = Array.from(translationIdsByVisibleText.entries())
      .map(([visibleText, translationIds]) => [visibleText, Array.from(translationIds)] as const)
      .filter(([, translationIds]) => translationIds.length > 1);

    if (duplicateBuckets.length) {
      const poisonLengthByTranslationId = this.assignPoisonLengths(duplicateBuckets);
      const temporaryOverrides = new Map<string, string[]>();
      const duplicateLookupByText = new Map<string, Map<number, string>>();

      duplicateBuckets.forEach(([visibleText, translationIds]) => {
        const poisonLookup = new Map<number, string>();

        translationIds.forEach((translationId) => {
          const renderedRecord = renderedRecordsByTranslationId.get(translationId);
          const poisonLength = poisonLengthByTranslationId.get(translationId);
          if (!renderedRecord || !poisonLength) {
            return;
          }

          temporaryOverrides.set(
            renderedRecord.identityKey,
            renderedRecord.translatedTexts.map((text) =>
              text ? `${text}${POISON_CHAR.repeat(poisonLength)}` : text
            )
          );
          poisonLookup.set(poisonLength, translationId);
        });

        if (poisonLookup.size) {
          duplicateLookupByText.set(visibleText, poisonLookup);
        }
      });

      await this.withTemporaryOverrides(temporaryOverrides, async () => {
        const poisonedNodes = collectTextNodes();
        poisonedNodes.forEach(({ node, text }) => {
          const poisonLength = countPoisonChars(text);
          if (!poisonLength) {
            return;
          }

          const cleanedText = normalizeVisibleText(stripPoisonChars(text));
          if (!cleanedText) {
            return;
          }

          const translationId = duplicateLookupByText.get(cleanedText)?.get(poisonLength);
          if (!translationId) {
            return;
          }

          const selector = buildSelector(node.parentElement || document.body);
          const currentSelectors = selectorsByTranslationId.get(translationId) || new Set<string>();
          currentSelectors.add(selector);
          selectorsByTranslationId.set(translationId, currentSelectors);
        });
      });
    }

    return Object.fromEntries(
      Array.from(selectorsByTranslationId.entries())
        .map(([translationId, selectors]) => [translationId, unique(Array.from(selectors))])
        .filter(([, selectors]) => selectors.length > 0)
    );
  };

  private captureAndUpload = async (): Promise<void> => {
    if (this.captureInFlight || !this.translationIdsToCapture.size) {
      return;
    }

    this.captureInFlight = true;
    try {
      const translationSelectorMap = await this.buildSelectorMap();
      if (!Object.keys(translationSelectorMap).length) {
        return;
      }

      const snapshot = await loadSnapshot();
      const payload: CapturePayload = {
        snapshot,
        translationSelectorMap,
        pageUrl: window.location.href,
        pagePathTemplate: currentPathTemplate(),
        viewport:
          Number.isFinite(window.innerWidth) && Number.isFinite(window.innerHeight)
            ? { width: Math.round(window.innerWidth), height: Math.round(window.innerHeight) }
            : null,
        capturedAt: new Date().toISOString(),
      };

      const endpoint = toSnapshotUploadUrl(this.options.apiUrl);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-api-key': this.options.apiKey,
      };
      if (this.options.requestOrigin) {
        headers.origin = this.options.requestOrigin;
      }

      const requestInit: RequestInit = {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      };
      const finalRequestInit = this.options.requestInitDecorator
        ? this.options.requestInitDecorator({
            url: endpoint,
            method: 'POST',
            requestInit: requestInit as RequestInit & Record<string, unknown>,
            cacheTtlSeconds: 0,
          })
        : (requestInit as RequestInit & Record<string, unknown>);

      const response = await fetch(endpoint, finalRequestInit as RequestInit);
      if (!response.ok) {
        throw new Error(`Snapshot upload failed (${response.status})`);
      }

      const now = Date.now();
      Object.keys(translationSelectorMap).forEach((translationId) => {
        this.lastCapturedByTranslationId.set(translationId, now);
        this.translationIdsToCapture.delete(translationId);
      });
    } catch (error) {
      console.error('[18ways] Failed to capture/upload DOM snapshot:', error);
    } finally {
      this.captureInFlight = false;
    }
  };
}

let domSnapshotRuntime: DomSnapshotRuntime | null = null;

if (process.env.NODE_ENV === 'test') {
  registerRuntimeResetFn(() => {
    domSnapshotRuntime?.stop();
    domSnapshotRuntime = null;
    renderedTranslationsByIdentity.clear();
    temporaryOverridesByIdentity.clear();
    overrideListeners.clear();
    overrideVersion = 0;
  });
}

export const startDomSnapshotRuntime = (options: DomSnapshotRuntimeOptions): (() => void) => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }

  domSnapshotRuntime?.stop();
  domSnapshotRuntime = new DomSnapshotRuntime(options);
  domSnapshotRuntime.start();

  return () => {
    domSnapshotRuntime?.stop();
    if (domSnapshotRuntime) {
      domSnapshotRuntime = null;
    }
  };
};
