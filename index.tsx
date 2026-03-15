'use client';

import React, {
  type DependencyList,
  useRef,
  useState,
  useEffect,
  useContext,
  useCallback,
  useMemo,
  useSyncExternalStore,
  createContext,
  Suspense,
  ReactNode,
  ReactElement,
} from 'react';
import { XMLParser } from 'fast-xml-parser';
import {
  Translations,
  type Language,
  getInMemoryTranslations,
  type _RequestInitDecorator,
  fetchAcceptedLocales,
  resetServerInMemoryTranslations,
  fetchSeed,
  generateHashId,
  type TranslationContextInput,
  type TranslationContextInputObject,
  type TranslationContextValue,
} from '@18ways/core/common';
import { InjectTranslations } from './inject';
import { formatWaysParser } from '@18ways/core/parsers/ways-parser';
import { TranslationStore, type TranslationStoreSnapshot } from '@18ways/core/translation-store';
import { registerQueueClearFn } from './testing';
import { registerRuntimeResetFn } from './testing';
import { readAcceptedLocalesFromWindow } from '@18ways/core/client-accepted-locales';
import { decryptTranslationValues } from '@18ways/core/crypto';
import {
  InternalLanguageSwitcher,
  type LanguageSwitcherClassNameOverrides,
  type LanguageSwitcherProps,
  type LanguageSwitcherStyleOverrides,
} from './language-switcher';
import { deepMerged } from '@18ways/core/object-utils';
import { canonicalizeLocale, localeToFlagEmoji } from '@18ways/core/i18n-shared';
import { create18waysEngine, type WaysEngine } from '@18ways/core/engine';

export { fetchAcceptedLocales, fetchEnabledLanguages, resolveOrigin } from '@18ways/core/common';
export type { Language, Translations } from '@18ways/core/common';

export type MessageFormatterFn = (params: {
  text: string;
  vars: Record<string, any>;
  locale: string;
}) => string;

export type MessageFormatter = 'none' | 'waysParser' | MessageFormatterFn;
type ResolvedMessageFormatter = 'none' | 'waysParser' | MessageFormatterFn;

const parsePositiveInt = (rawValue: string | undefined, fallback: number): number => {
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
};

const DEFAULT_SERVER_INITIAL_TRANSLATION_TIMEOUT_MS = parsePositiveInt(
  process.env.NEXT_PUBLIC_18WAYS_INITIAL_TRANSLATION_TIMEOUT_MS ||
    process.env['18WAYS_INITIAL_TRANSLATION_TIMEOUT_MS'],
  3000
);
const CONTEXT_TRANSLATION_GC_DELAY_MS = 5 * 60 * 1000;

const uniq = <T,>(values: T[]): T[] => Array.from(new Set(values));

const canonicalizeLocaleCodes = (localeCodes: string[]): string[] =>
  uniq(localeCodes.map((locale) => canonicalizeLocale(locale)).filter(Boolean));

const localeCodeListsEqual = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((locale, index) => locale === right[index]);

type AcceptedLocalesServerResolution =
  | {
      status: 'pending';
      promise: Promise<void>;
    }
  | {
      status: 'resolved';
      locales: string[];
    };

const acceptedLocalesServerResolutionsSingleton = new Map<
  string,
  AcceptedLocalesServerResolution
>();
const acceptedLocalesFunctionIdsSingleton = new WeakMap<object, number>();
let acceptedLocalesFunctionIdCounter = 0;

const getAcceptedLocalesFunctionId = (value: object | undefined): number => {
  if (!value) {
    return 0;
  }

  const existingId = acceptedLocalesFunctionIdsSingleton.get(value);
  if (existingId) {
    return existingId;
  }

  acceptedLocalesFunctionIdCounter += 1;
  acceptedLocalesFunctionIdsSingleton.set(value, acceptedLocalesFunctionIdCounter);
  return acceptedLocalesFunctionIdCounter;
};

const buildAcceptedLocalesServerResolutionKey = (input: {
  apiKey: string;
  _apiUrl?: string;
  requestOrigin?: string;
  cacheTtl?: number;
  defaultLocale: string;
  fetcher?: typeof fetch;
  requestInitDecorator?: _RequestInitDecorator;
}): string =>
  JSON.stringify({
    apiKey: input.apiKey,
    _apiUrl: input._apiUrl || '',
    requestOrigin: input.requestOrigin || '',
    cacheTtl: typeof input.cacheTtl === 'number' ? input.cacheTtl : null,
    defaultLocale: input.defaultLocale,
    fetcherId: getAcceptedLocalesFunctionId(input.fetcher),
    requestInitDecoratorId: getAcceptedLocalesFunctionId(input.requestInitDecorator),
  });

let transitionFallbackLocaleSingleton: string | null = null;
const mountedContextCountsSingleton = new Map<string, number>();
const contextGcTimeoutsSingleton = new Map<string, number>();

const readTransitionFallbackLocale = (): string | null => transitionFallbackLocaleSingleton;

const writeTransitionFallbackLocale = (locale: string | null): void => {
  transitionFallbackLocaleSingleton = locale || null;
};

const cancelContextGc = (contextKey: string): void => {
  if (typeof window === 'undefined' || !contextKey) {
    return;
  }

  const timeoutId = contextGcTimeoutsSingleton.get(contextKey);
  if (!timeoutId) {
    return;
  }

  clearTimeout(timeoutId);
  contextGcTimeoutsSingleton.delete(contextKey);
};

const buildLanguagesFromLocaleCodes = (localeCodes: string[]): Language[] =>
  localeCodes.map((code) => ({
    code,
    name: code,
    nativeName: code,
    flag: localeToFlagEmoji(code),
  }));

interface TranslateTextParams {
  baseLocale?: string;
  targetLocale: string;
  texts: string[];
}

interface ContextualTranslateTextParams extends TranslateTextParams {
  key: string;
  textsHash: string;
  contextFingerprint?: string;
  contextMetadata?: TranslationContextValue;
  syncOnly?: boolean;
}

type SeedPromiseLookup = (contextKey: string, targetLocale: string) => Promise<void> | null;
type SeedPromiseEnsure = (contextKey: string, targetLocale: string) => Promise<void> | null;

interface ContextType {
  store: TranslationStore;
  contextKey: string;
  contextMetadata: TranslationContextValue;
  queueTranslation: (entry: ContextualTranslateTextParams) => boolean;
  getFallbackLocale: () => string;
  getPendingSeedPromise: SeedPromiseLookup;
  hasPendingClientLocaleTransition: boolean;
  baseLocale?: string;
  targetLocale: string;
  components?: ComponentsMap;
  messageFormatter: ResolvedMessageFormatter;
}

const Context = createContext<ContextType | undefined>(undefined);
const SuspenseFallbackContext = createContext<boolean>(false);

const WaysContextPathContext = createContext<string>('root');
const DEFAULT_CONTEXT_VALUE: TranslationContextValue = {
  name: '',
  label: '',
  treePath: '',
  filePath: '',
};
const WaysContextMetadataContext = createContext<TranslationContextValue>(DEFAULT_CONTEXT_VALUE);

const buildContextPath = (parent: string, current: string): string => {
  const joined = parent === 'root' ? current : `${parent}.${current}`;
  return joined.startsWith('root.') ? joined.slice(5) : joined;
};

const cleanContextPart = (value: string | undefined | null): string => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
};

const normalizeContextInput = (context: TranslationContextInput): TranslationContextValue => {
  if (typeof context === 'string') {
    const name = cleanContextPart(context);
    return {
      name,
      label: '',
      treePath: '',
      filePath: '',
    };
  }

  const contextObject = context as TranslationContextInputObject;
  const name = cleanContextPart(contextObject.name);
  const label = cleanContextPart(contextObject.label || contextObject.description);
  const treePath = cleanContextPart(contextObject.treePath);
  const filePath = cleanContextPart(contextObject.filePath);

  return {
    name,
    label,
    treePath,
    filePath,
  };
};

const mergeContextValues = (
  parentContext: TranslationContextValue,
  childContext: TranslationContextValue
): TranslationContextValue => {
  const name = [parentContext.name, childContext.name].filter(Boolean).join('.');
  const label = [parentContext.label, childContext.label].filter(Boolean).join('\n\n');
  const treePath = [parentContext.treePath, childContext.treePath].filter(Boolean).join(' > ');
  const filePath = childContext.filePath || parentContext.filePath || '';

  return {
    name,
    label,
    treePath,
    filePath,
  };
};

const warnedInitialRenderTimeouts = new Set<string>();
const warnedSuspenseFallbacks = new Set<string>();
const seedLookupKey = (contextKey: string, targetLocale: string): string =>
  `${contextKey}::${targetLocale}`;

const hasCachedSeedForContext = (contextKey: string, targetLocale: string): boolean => {
  if (!contextKey || !targetLocale) {
    return false;
  }

  const inMemoryTranslations = getInMemoryTranslations();
  const localeTranslations = inMemoryTranslations[targetLocale];
  return Boolean(
    localeTranslations &&
    typeof localeTranslations === 'object' &&
    !Array.isArray(localeTranslations) &&
    contextKey in localeTranslations
  );
};

export interface WaysRootProps {
  apiKey: string;
  locale?: string;
  children: ReactNode;
  baseLocale?: string;
  cacheTtl?: number;
  messageFormatter?: MessageFormatter;
  fetcher?: typeof fetch;
  /** @internal Adapter-only API URL override. */
  _apiUrl?: string;
  /** @internal Adapter-only fetch init hook. */
  _requestInitDecorator?: _RequestInitDecorator;
  serverInitialTranslationTimeoutMs?: number;
  // Used on SSR to forward the page origin to server-side API calls.
  requestOrigin?: string;
  // Used on SSR to inject accepted locales into window during hydration.
  acceptedLocales?: string[];
  context?: TranslationContextInput;
}

export interface WaysScopeProps {
  context: TranslationContextInput;
  children: ReactNode;
  locale?: string;
  baseLocale?: string;
  components?: ComponentsMap;
}

export type WaysProps = WaysRootProps | WaysScopeProps;

const isRootWaysProps = (props: WaysProps): props is WaysRootProps => 'apiKey' in props;

const isScopeWaysProps = (props: WaysProps): props is WaysScopeProps =>
  'context' in props && !('apiKey' in props);

const seedContextTranslationsBatch = async (
  contextKeys: string[],
  targetLocale: string
): Promise<void> => {
  if (typeof window !== 'undefined') {
    if (!window.__18WAYS_IN_MEMORY_TRANSLATIONS__) {
      window.__18WAYS_IN_MEMORY_TRANSLATIONS__ = {};
    }
  }

  if (!contextKeys.length) {
    return;
  }

  const seedResult = await fetchSeed(contextKeys, targetLocale);
  if (!seedResult?.data || typeof seedResult.data !== 'object' || Array.isArray(seedResult.data)) {
    return;
  }

  const inMemoryTranslations = getInMemoryTranslations();
  const existingForLocale = (inMemoryTranslations[targetLocale] as Translations) || {};
  inMemoryTranslations[targetLocale] = deepMerged(existingForLocale, seedResult.data);
};

interface InitialRenderBlockerProps {
  shouldBlockInitialRender: boolean;
  store: TranslationStore;
  contextKey: string;
  pendingSeedPromise: Promise<void> | null;
  initialRenderPromiseRef: React.MutableRefObject<Promise<void> | null>;
  hasCompletedInitialRenderBlockRef: React.MutableRefObject<boolean>;
  serverInitialTranslationTimeoutMs: number;
}

const InitialRenderBlocker: React.FC<InitialRenderBlockerProps> = ({
  shouldBlockInitialRender,
  store,
  contextKey,
  pendingSeedPromise,
  initialRenderPromiseRef,
  hasCompletedInitialRenderBlockRef,
  serverInitialTranslationTimeoutMs,
}) => {
  if (hasCompletedInitialRenderBlockRef.current) {
    return null;
  }

  if (!shouldBlockInitialRender) {
    hasCompletedInitialRenderBlockRef.current = true;
    return null;
  }

  const hasPendingStoreWork =
    store.hasPendingRequestsForKey(contextKey) || store.hasInFlightRequestsForKey(contextKey);
  const hasPendingSeed = Boolean(pendingSeedPromise);

  if (!hasPendingStoreWork && !hasPendingSeed) {
    hasCompletedInitialRenderBlockRef.current = true;
    return null;
  }

  if (!initialRenderPromiseRef.current) {
    const ensurePromise =
      pendingSeedPromise || Promise.resolve().then(() => store.waitForIdleForKey(contextKey));
    const waitStartedAt = Date.now();
    let didTimeout = false;
    const runtime = typeof window === 'undefined' ? 'server' : 'client';
    const timeoutKey = `${runtime}:${contextKey}`;
    const timeoutActive = !hasPendingSeed;

    const blockingPromise =
      typeof window === 'undefined'
        ? !timeoutActive
          ? ensurePromise
          : Promise.race([
              ensurePromise,
              new Promise<void>((resolve) => {
                setTimeout(() => {
                  didTimeout = true;
                  resolve();
                }, serverInitialTranslationTimeoutMs);
              }),
            ])
        : ensurePromise;

    initialRenderPromiseRef.current = blockingPromise.finally(() => {
      if (didTimeout && !warnedInitialRenderTimeouts.has(timeoutKey)) {
        warnedInitialRenderTimeouts.add(timeoutKey);
        const elapsedMs = Date.now() - waitStartedAt;
        console.warn(
          `[18ways] Initial render blocker timed out after ${serverInitialTranslationTimeoutMs}ms`,
          {
            contextKey,
            hasPending: store.hasPendingRequestsForKey(contextKey),
            hasInFlight: store.hasInFlightRequestsForKey(contextKey),
            elapsedMs,
          }
        );
      }
      hasCompletedInitialRenderBlockRef.current = true;
      initialRenderPromiseRef.current = null;
    });
  }

  const pendingPromise = initialRenderPromiseRef.current;
  if (pendingPromise) {
    throw pendingPromise;
  }

  hasCompletedInitialRenderBlockRef.current = true;
  return null;
};

const SuspenseFallback: React.FC<{
  contextKey: string;
  children: ReactNode;
}> = ({ contextKey, children }) => {
  const runtime = typeof window === 'undefined' ? 'server' : 'client';
  const fallbackKey = `${runtime}:${contextKey}`;
  if (!warnedSuspenseFallbacks.has(fallbackKey)) {
    warnedSuspenseFallbacks.add(fallbackKey);
    console.warn('[18ways] Suspense fallback rendered while waiting for translations', {
      contextKey,
      runtime,
    });
  }
  return (
    <SuspenseFallbackContext.Provider value={true}>{children}</SuspenseFallbackContext.Provider>
  );
};

type WaysRootContextType = {
  engine: WaysEngine | null;
  targetLocale: string;
  transitionFallbackLocale: string | null;
  defaultLocale: string;
  baseLocale?: string;
  acceptedLocales: string[];
  messageFormatter: ResolvedMessageFormatter;
  serverInitialTranslationTimeoutMs: number;
  setTargetLocale: (targetLocale: string) => void;
  getPendingSeedPromise: SeedPromiseLookup;
  ensureSeedPromise: SeedPromiseEnsure;
  completedTranslations: Translations;
  setCompletedTranslations: (keyPath: string[], translation: string[]) => void;
  store: TranslationStore;
};

const emptyStore = new TranslationStore({
  translations: {},
  fetchTranslations: async () => ({ data: [], errors: [] }),
});

if (process.env.NODE_ENV === 'test') {
  registerRuntimeResetFn(() => {
    transitionFallbackLocaleSingleton = null;
    mountedContextCountsSingleton.clear();
    acceptedLocalesServerResolutionsSingleton.clear();
    contextGcTimeoutsSingleton.forEach((timeoutId) => {
      clearTimeout(timeoutId);
    });
    contextGcTimeoutsSingleton.clear();
  });
}

const WaysRootContext = createContext<WaysRootContextType>({
  engine: null,
  targetLocale: 'en-GB',
  transitionFallbackLocale: null,
  defaultLocale: 'en-GB',
  baseLocale: undefined,
  acceptedLocales: [],
  messageFormatter: 'waysParser',
  serverInitialTranslationTimeoutMs: DEFAULT_SERVER_INITIAL_TRANSLATION_TIMEOUT_MS,
  setTargetLocale: () => {
    throw new Error('The root component has not been initialised');
  },
  getPendingSeedPromise: () => null,
  ensureSeedPromise: () => null,
  completedTranslations: {},
  setCompletedTranslations: () => {
    throw new Error('The root component has not been initialised');
  },
  store: emptyStore,
});

const WaysRoot: React.FC<{
  children: ReactNode;
  engine: WaysEngine;
  apiKey: string;
  locale?: string;
  defaultLocale: string;
  baseLocale?: string;
  cacheTtl?: number;
  fetcher?: typeof fetch;
  _apiUrl?: string;
  requestOrigin?: string;
  requestInitDecorator?: _RequestInitDecorator;
  acceptedLocales?: string[];
  messageFormatter?: MessageFormatter;
  serverInitialTranslationTimeoutMs?: number;
  rootContextKey?: string;
}> = ({
  children,
  engine,
  apiKey,
  locale,
  defaultLocale,
  baseLocale,
  cacheTtl,
  fetcher,
  _apiUrl,
  requestOrigin,
  requestInitDecorator,
  acceptedLocales = [],
  messageFormatter = 'waysParser',
  serverInitialTranslationTimeoutMs = DEFAULT_SERVER_INITIAL_TRANSLATION_TIMEOUT_MS,
  rootContextKey,
}) => {
  const normalizedAcceptedLocalesFromProps = useMemo(
    () => canonicalizeLocaleCodes(acceptedLocales),
    [acceptedLocales]
  );
  const [runtimeAcceptedLocales, setRuntimeAcceptedLocales] = useState<string[]>([]);
  const acceptedLocalesFromWindow = readAcceptedLocalesFromWindow();
  const acceptedLocalesFromWindowKey = acceptedLocalesFromWindow.join(',');
  const acceptedLocalesServerResolutionKey =
    normalizedAcceptedLocalesFromProps.length === 0 && apiKey
      ? buildAcceptedLocalesServerResolutionKey({
          apiKey,
          _apiUrl,
          requestOrigin,
          cacheTtl,
          defaultLocale,
          fetcher,
          requestInitDecorator,
        })
      : null;
  const acceptedLocalesServerResolution = acceptedLocalesServerResolutionKey
    ? acceptedLocalesServerResolutionsSingleton.get(acceptedLocalesServerResolutionKey)
    : undefined;

  if (
    typeof window === 'undefined' &&
    normalizedAcceptedLocalesFromProps.length === 0 &&
    acceptedLocalesFromWindow.length === 0 &&
    acceptedLocalesServerResolutionKey
  ) {
    if (!acceptedLocalesServerResolution) {
      const acceptedLocalesPromise = fetchAcceptedLocales(defaultLocale, {
        apiKey,
        apiUrl: _apiUrl,
        origin: requestOrigin,
        fetcher,
        cacheTtlSeconds: cacheTtl,
        _requestInitDecorator: requestInitDecorator,
      }).then((fetchedLocales) => {
        acceptedLocalesServerResolutionsSingleton.set(acceptedLocalesServerResolutionKey, {
          status: 'resolved',
          locales: canonicalizeLocaleCodes(fetchedLocales),
        });
      });
      acceptedLocalesServerResolutionsSingleton.set(acceptedLocalesServerResolutionKey, {
        status: 'pending',
        promise: acceptedLocalesPromise,
      });
      throw acceptedLocalesPromise;
    }

    if (acceptedLocalesServerResolution.status === 'pending') {
      throw acceptedLocalesServerResolution.promise;
    }
  }
  useEffect(() => {
    if (normalizedAcceptedLocalesFromProps.length > 0) {
      return;
    }

    if (acceptedLocalesFromWindow.length > 0) {
      setRuntimeAcceptedLocales((previousLocales) =>
        localeCodeListsEqual(previousLocales, acceptedLocalesFromWindow)
          ? previousLocales
          : acceptedLocalesFromWindow
      );
      return;
    }

    let cancelled = false;

    void fetchAcceptedLocales(defaultLocale, {
      apiKey,
      apiUrl: _apiUrl,
      origin: requestOrigin,
      fetcher,
      cacheTtlSeconds: cacheTtl,
      _requestInitDecorator: requestInitDecorator,
    })
      .then((fetchedLocales) => {
        if (cancelled) {
          return;
        }

        const normalizedFetchedLocales = canonicalizeLocaleCodes(fetchedLocales);
        if (!normalizedFetchedLocales.length) {
          return;
        }

        setRuntimeAcceptedLocales((previousLocales) =>
          localeCodeListsEqual(previousLocales, normalizedFetchedLocales)
            ? previousLocales
            : normalizedFetchedLocales
        );
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('[18ways] Failed to fetch accepted locales:', error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    apiKey,
    _apiUrl,
    acceptedLocalesFromWindowKey,
    cacheTtl,
    defaultLocale,
    fetcher,
    normalizedAcceptedLocalesFromProps,
    requestInitDecorator,
    requestOrigin,
  ]);

  const fallbackLocale = canonicalizeLocale(defaultLocale);
  const acceptedLocalesFromServer =
    acceptedLocalesServerResolution?.status === 'resolved'
      ? acceptedLocalesServerResolution.locales
      : [];
  const fallbackAcceptedLocales = fallbackLocale ? [fallbackLocale] : [];
  const normalizedAcceptedLocales = uniq([
    ...normalizedAcceptedLocalesFromProps,
    ...acceptedLocalesFromWindow,
    ...acceptedLocalesFromServer,
    ...runtimeAcceptedLocales,
    ...fallbackAcceptedLocales,
  ]);
  const hasResolvedAcceptedLocales =
    normalizedAcceptedLocalesFromProps.length > 0 ||
    acceptedLocalesFromWindow.length > 0 ||
    acceptedLocalesFromServer.length > 0 ||
    runtimeAcceptedLocales.length > 0;

  if (typeof window !== 'undefined') {
    if (!window.__18WAYS_IN_MEMORY_TRANSLATIONS__) {
      window.__18WAYS_IN_MEMORY_TRANSLATIONS__ = {};
    }
  }
  if (
    typeof window !== 'undefined' &&
    hasResolvedAcceptedLocales &&
    normalizedAcceptedLocales.length > 0
  ) {
    window.__18WAYS_ACCEPTED_LOCALES__ = normalizedAcceptedLocales;
  }

  const store = engine.getStore();
  const serverIdlePromiseRef = useRef<Promise<void> | null>(null);
  const pendingSeedPromisesRef = useRef<Map<string, Promise<void>>>(new Map());
  const pendingSeedResolversRef = useRef<Map<string, () => void>>(new Map());
  const seededContextsRef = useRef<Set<string>>(new Set());
  const queuedSeedContextsByLocaleRef = useRef<Map<string, Set<string>>>(new Map());
  const isSeedFlushScheduledRef = useRef(false);
  const previousTargetLocaleRef = useRef(defaultLocale);

  const [targetLocale, setTargetLocale] = useState(defaultLocale);
  const [transitionFallbackLocale, setTransitionFallbackLocale] = useState<string | null>(() => {
    const fallbackLocale = readTransitionFallbackLocale();
    return fallbackLocale && fallbackLocale !== defaultLocale ? fallbackLocale : null;
  });
  const [seedResolutionVersion, setSeedResolutionVersion] = useState(0);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = targetLocale;
    }
  }, [targetLocale]);

  useEffect(() => {
    engine.setLocale(targetLocale);
  }, [engine, targetLocale]);

  useEffect(() => {
    if (!locale) {
      return;
    }

    setTargetLocale((previousLocale) => (previousLocale === locale ? previousLocale : locale));
  }, [locale]);

  const snapshot = useSyncExternalStore(
    store.subscribeToTranslations,
    store.getTranslationsSnapshot,
    store.getTranslationsSnapshot
  );
  const loadingSnapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
  const completedTranslations =
    typeof window === 'undefined'
      ? store.getTranslationsSnapshot().translations
      : snapshot.translations;

  const setCompletedTranslations = useCallback(
    (keyPath: string[], translation: string[]) => {
      store.setCompletedTranslation(keyPath, translation);
    },
    [store]
  );

  const getPendingSeedPromise = useCallback<SeedPromiseLookup>((contextKey, targetLocale) => {
    return pendingSeedPromisesRef.current.get(seedLookupKey(contextKey, targetLocale)) || null;
  }, []);

  const resolveSeedPromiseFor = useCallback((contextKey: string, targetLocale: string) => {
    const key = seedLookupKey(contextKey, targetLocale);
    const resolve = pendingSeedResolversRef.current.get(key);
    if (resolve) {
      resolve();
      pendingSeedResolversRef.current.delete(key);
    }
    pendingSeedPromisesRef.current.delete(key);
  }, []);

  const flushQueuedSeedBatches = useCallback(async () => {
    const batches = Array.from(queuedSeedContextsByLocaleRef.current.entries()).map(
      ([locale, contextKeys]) => [locale, Array.from(contextKeys)] as const
    );
    queuedSeedContextsByLocaleRef.current.clear();

    await Promise.all(
      batches.map(async ([locale, contextKeys]) => {
        try {
          await seedContextTranslationsBatch(contextKeys, locale);
        } catch (error) {
          console.error('[18ways] Failed to seed initial context translations:', error);
        } finally {
          contextKeys.forEach((contextKey) => {
            resolveSeedPromiseFor(contextKey, locale);
          });
          if (typeof window !== 'undefined') {
            setSeedResolutionVersion((version) => version + 1);
          }
        }
      })
    );
  }, [resolveSeedPromiseFor]);

  const waitForPendingSeedWork = useCallback(async () => {
    while (true) {
      if (isSeedFlushScheduledRef.current) {
        isSeedFlushScheduledRef.current = false;
        await flushQueuedSeedBatches();
        continue;
      }

      const pending = Array.from(pendingSeedPromisesRef.current.values());
      if (!pending.length) {
        return;
      }

      await Promise.all(pending);
    }
  }, [flushQueuedSeedBatches]);

  const ensureSeedPromise = useCallback<SeedPromiseEnsure>(
    (contextKey, targetLocale) => {
      if (!contextKey || !targetLocale) {
        return null;
      }

      const key = seedLookupKey(contextKey, targetLocale);
      const existing = pendingSeedPromisesRef.current.get(key);
      if (existing) {
        return existing;
      }

      if (seededContextsRef.current.has(key)) {
        return null;
      }

      if (hasCachedSeedForContext(contextKey, targetLocale)) {
        seededContextsRef.current.add(key);
        return null;
      }

      seededContextsRef.current.add(key);
      const seedPromise = new Promise<void>((resolve) => {
        pendingSeedResolversRef.current.set(key, resolve);
      });
      pendingSeedPromisesRef.current.set(key, seedPromise);

      let queuedContextsForLocale = queuedSeedContextsByLocaleRef.current.get(targetLocale);
      if (!queuedContextsForLocale) {
        queuedContextsForLocale = new Set<string>();
        queuedSeedContextsByLocaleRef.current.set(targetLocale, queuedContextsForLocale);
      }
      queuedContextsForLocale.add(contextKey);

      if (!isSeedFlushScheduledRef.current) {
        isSeedFlushScheduledRef.current = true;
        queueMicrotask(() => {
          isSeedFlushScheduledRef.current = false;
          void flushQueuedSeedBatches();
        });
      }

      return seedPromise;
    },
    [flushQueuedSeedBatches]
  );

  if (typeof window === 'undefined' && rootContextKey) {
    void ensureSeedPromise(rootContextKey, defaultLocale);
  }

  const hasPendingSeedWork = useCallback(
    () => pendingSeedPromisesRef.current.size > 0 || isSeedFlushScheduledRef.current,
    []
  );
  const effectiveTransitionFallbackLocale = transitionFallbackLocale;

  useEffect(() => {
    if (previousTargetLocaleRef.current !== targetLocale) {
      const previousLocale = previousTargetLocaleRef.current;
      previousTargetLocaleRef.current = targetLocale;
      setTransitionFallbackLocale(previousLocale);
      writeTransitionFallbackLocale(previousLocale);
    }
  }, [targetLocale]);

  useEffect(() => {
    const hasLiveTransitionWork =
      store.hasPendingRequests() ||
      store.hasInFlightRequests() ||
      pendingSeedPromisesRef.current.size > 0 ||
      isSeedFlushScheduledRef.current;
    if (hasLiveTransitionWork) {
      return;
    }

    if (transitionFallbackLocale !== null) {
      setTransitionFallbackLocale(null);
    }
    writeTransitionFallbackLocale(targetLocale);
  }, [
    loadingSnapshot.hasInFlight,
    loadingSnapshot.hasPending,
    seedResolutionVersion,
    store,
    targetLocale,
    transitionFallbackLocale,
  ]);

  return (
    <WaysRootContext.Provider
      value={{
        engine,
        targetLocale,
        transitionFallbackLocale: effectiveTransitionFallbackLocale,
        setTargetLocale,
        defaultLocale,
        baseLocale,
        acceptedLocales: normalizedAcceptedLocales,
        messageFormatter,
        serverInitialTranslationTimeoutMs,
        getPendingSeedPromise,
        ensureSeedPromise,
        completedTranslations,
        setCompletedTranslations,
        store,
      }}
    >
      {children}
      <InjectTranslations
        acceptedLocales={normalizedAcceptedLocales}
        store={store}
        idlePromiseRef={serverIdlePromiseRef}
        translations={completedTranslations}
        hasPendingSeedWork={hasPendingSeedWork}
        waitForPendingSeedWork={waitForPendingSeedWork}
      />
    </WaysRootContext.Provider>
  );
};

interface WaysProviderProps {
  children: ReactNode;
  contextKey: string;
  contextMetadata: TranslationContextValue;
  baseLocale?: string;
  targetLocale?: string;
  components?: ComponentsMap;
}

const WaysProvider: React.FC<WaysProviderProps> = ({
  children,
  contextKey,
  contextMetadata,
  baseLocale: pBaseLocale,
  targetLocale: pTargetLocale,
  components,
}) => {
  const {
    targetLocale: cTargetLocale,
    baseLocale: cBaseLocale,
    transitionFallbackLocale: rootTransitionFallbackLocale,
    messageFormatter,
    serverInitialTranslationTimeoutMs,
    store,
    getPendingSeedPromise,
    ensureSeedPromise,
  } = useContext(WaysRootContext);

  const targetLocale = pTargetLocale || cTargetLocale;
  const baseLocale = pBaseLocale || cBaseLocale;
  const initialRenderPromiseRef = useRef<Promise<void> | null>(null);
  const hasCompletedInitialRenderBlockRef = useRef<boolean>(false);

  const previousTargetLocaleRef = useRef(targetLocale);
  const fallbackLocaleRef = useRef(targetLocale);

  const shouldBlockInitialRender = Boolean(
    baseLocale && targetLocale && baseLocale !== targetLocale
  );
  const hasLocaleChanged = previousTargetLocaleRef.current !== targetLocale;
  const shouldEnsureSeedPromise =
    shouldBlockInitialRender &&
    contextKey !== 'root' &&
    (typeof window === 'undefined' || hasLocaleChanged);
  const hasPendingClientLocaleTransition =
    typeof window !== 'undefined' &&
    (hasLocaleChanged ||
      Boolean(rootTransitionFallbackLocale && rootTransitionFallbackLocale !== targetLocale));
  const ensuredSeedPromise = shouldEnsureSeedPromise
    ? ensureSeedPromise(contextKey, targetLocale)
    : null;
  const pendingSeedPromise = ensuredSeedPromise || getPendingSeedPromise(contextKey, targetLocale);

  useEffect(() => {
    if (!baseLocale && typeof console !== 'undefined' && console.warn) {
      console.warn(
        '[18ways] Missing baseLocale in WaysProvider. This may result in unnecessary translation charges. ' +
          'Set baseLocale to your source language to avoid charges for same-language lookups.'
      );
    }
  }, [baseLocale]);

  useEffect(() => {
    if (previousTargetLocaleRef.current !== targetLocale) {
      fallbackLocaleRef.current = previousTargetLocaleRef.current;
      previousTargetLocaleRef.current = targetLocale;
    }
  }, [targetLocale]);

  const queueTranslation = useCallback(
    (entry: ContextualTranslateTextParams) => {
      return store.enqueue(entry);
    },
    [store]
  );

  useEffect(() => {
    if (process.env.NODE_ENV !== 'test') {
      return;
    }

    const clearQueue = async () => {
      await store.waitForIdle();
    };

    return registerQueueClearFn(clearQueue);
  }, [store]);

  useEffect(() => {
    if (typeof window === 'undefined' || !contextKey) {
      return;
    }

    mountedContextCountsSingleton.set(
      contextKey,
      (mountedContextCountsSingleton.get(contextKey) || 0) + 1
    );
    cancelContextGc(contextKey);

    return () => {
      const currentCount = mountedContextCountsSingleton.get(contextKey) || 0;
      if (currentCount <= 1) {
        mountedContextCountsSingleton.delete(contextKey);
        contextGcTimeoutsSingleton.set(
          contextKey,
          Number(
            window.setTimeout(() => {
              contextGcTimeoutsSingleton.delete(contextKey);
              if ((mountedContextCountsSingleton.get(contextKey) || 0) > 0) {
                return;
              }
              store.deleteContextTranslations(contextKey);
            }, CONTEXT_TRANSLATION_GC_DELAY_MS)
          )
        );
        return;
      }

      mountedContextCountsSingleton.set(contextKey, currentCount - 1);
    };
  }, [contextKey, store]);

  const getFallbackLocale = useCallback(() => {
    if (previousTargetLocaleRef.current !== targetLocale) {
      return previousTargetLocaleRef.current;
    }
    if (rootTransitionFallbackLocale && rootTransitionFallbackLocale !== targetLocale) {
      return rootTransitionFallbackLocale;
    }
    const globalTransitionFallbackLocale = readTransitionFallbackLocale();
    if (globalTransitionFallbackLocale && globalTransitionFallbackLocale !== targetLocale) {
      return globalTransitionFallbackLocale;
    }
    return fallbackLocaleRef.current;
  }, [rootTransitionFallbackLocale, targetLocale]);

  return (
    <>
      <Context.Provider
        value={{
          store,
          contextKey,
          contextMetadata,
          queueTranslation,
          getFallbackLocale,
          getPendingSeedPromise,
          hasPendingClientLocaleTransition,
          baseLocale,
          targetLocale,
          components,
          messageFormatter,
        }}
      >
        <Suspense
          fallback={<SuspenseFallback contextKey={contextKey}>{children}</SuspenseFallback>}
        >
          {children}
          <InitialRenderBlocker
            shouldBlockInitialRender={shouldBlockInitialRender}
            store={store}
            contextKey={contextKey}
            pendingSeedPromise={pendingSeedPromise}
            initialRenderPromiseRef={initialRenderPromiseRef}
            hasCompletedInitialRenderBlockRef={hasCompletedInitialRenderBlockRef}
            serverInitialTranslationTimeoutMs={serverInitialTranslationTimeoutMs}
          />
        </Suspense>
      </Context.Provider>
    </>
  );
};

export const Ways: React.FC<WaysProps> = (props) => {
  const hasApiKey = 'apiKey' in props;
  const hasContext = 'context' in props;

  if (!hasApiKey && !hasContext) {
    throw new Error(
      '[18ways] Must provide either apiKey (root mode) or context (scope mode) prop.'
    );
  }

  if (isRootWaysProps(props)) {
    const {
      apiKey,
      locale,
      children,
      baseLocale,
      cacheTtl,
      messageFormatter,
      fetcher,
      _apiUrl,
      _requestInitDecorator,
      serverInitialTranslationTimeoutMs,
      requestOrigin,
      acceptedLocales,
      context,
    } = props;

    const defaultLocale = locale || baseLocale || 'en-GB';
    const shouldResetServerCache = process.env.NODE_ENV === 'test';
    const hasResetServerCacheRef = useRef(false);
    if (
      typeof window === 'undefined' &&
      !hasResetServerCacheRef.current &&
      shouldResetServerCache
    ) {
      resetServerInMemoryTranslations();
      hasResetServerCacheRef.current = true;
    }

    const normalizedRootContext = context ? normalizeContextInput(context) : DEFAULT_CONTEXT_VALUE;
    if (context && !normalizedRootContext.name) {
      throw new Error('[18ways] Root context requires a non-empty name');
    }
    const rootContextKey = normalizedRootContext.name;
    const contextPath = rootContextKey || 'root';
    const engineRef = useRef<WaysEngine | null>(null);
    if (!engineRef.current) {
      engineRef.current = create18waysEngine({
        apiKey,
        apiUrl: _apiUrl,
        fetcher,
        cacheTtlSeconds: cacheTtl,
        origin: requestOrigin,
        _requestInitDecorator,
        baseLocale: baseLocale || defaultLocale,
        locale: locale || defaultLocale,
        context: contextPath,
        initialTranslations: getInMemoryTranslations(),
      });
    }
    const engine = engineRef.current as WaysEngine;

    return (
      <WaysContextMetadataContext.Provider value={normalizedRootContext}>
        <WaysContextPathContext.Provider value={contextPath}>
          <WaysRoot
            engine={engine}
            apiKey={apiKey}
            locale={locale}
            defaultLocale={defaultLocale}
            baseLocale={baseLocale}
            cacheTtl={cacheTtl}
            fetcher={fetcher}
            _apiUrl={_apiUrl}
            requestOrigin={requestOrigin}
            requestInitDecorator={_requestInitDecorator}
            acceptedLocales={acceptedLocales}
            messageFormatter={messageFormatter}
            serverInitialTranslationTimeoutMs={serverInitialTranslationTimeoutMs}
            rootContextKey={rootContextKey || undefined}
          >
            <WaysProvider
              contextKey={contextPath}
              contextMetadata={normalizedRootContext}
              baseLocale={baseLocale}
            >
              {children}
            </WaysProvider>
          </WaysRoot>
        </WaysContextPathContext.Provider>
      </WaysContextMetadataContext.Provider>
    );
  }

  if (isScopeWaysProps(props)) {
    const { context, children, locale, baseLocale, components } = props;
    const parentContextPath = useContext(WaysContextPathContext);
    const parentContextMetadata = useContext(WaysContextMetadataContext);
    const rootContext = useContext(WaysRootContext);

    const normalizedContext = normalizeContextInput(context);
    if (!normalizedContext.name) {
      throw new Error('[18ways] Scope context requires a non-empty name');
    }
    const mergedContextMetadata = mergeContextValues(parentContextMetadata, normalizedContext);
    const contextPath = buildContextPath(parentContextPath, normalizedContext.name);
    const targetLocale = locale || rootContext.targetLocale;
    const effectiveBaseLocale = baseLocale || rootContext.baseLocale;

    return (
      <WaysContextMetadataContext.Provider value={mergedContextMetadata}>
        <WaysContextPathContext.Provider value={contextPath}>
          <WaysProvider
            contextKey={contextPath}
            contextMetadata={mergedContextMetadata}
            targetLocale={targetLocale}
            baseLocale={effectiveBaseLocale}
            components={components}
          >
            {children}
          </WaysProvider>
        </WaysContextPathContext.Provider>
      </WaysContextMetadataContext.Provider>
    );
  }

  return null;
};

type ComponentsMap = Record<string, string | React.ComponentType<any>>;

interface UseTParams {
  baseLocale?: string;
  targetLocale?: string;
  suspend?: boolean;
}

type UseTranslatedMemoFactory<T> = (t: TFunction) => T;

const applyComponentsToText = (
  components: ComponentsMap = {},
  text: string
): typeof components extends undefined ? string : ReactNode => {
  const componentKeys = Object.keys(components);
  const isValidXml = /</.test(text) && />/.test(text);
  if (!isValidXml || !componentKeys.length) {
    return text;
  }

  let parsedXml: any;
  try {
    const parser = new XMLParser({
      ignoreAttributes: true,
      alwaysCreateTextNode: true,
      preserveOrder: true,
      trimValues: false,
    });
    parsedXml = parser.parse(`<root>${text}</root>`)[0].root;
  } catch (e) {
    console.error('Failed to parse XML', e);
    return text;
  }

  const applyAcrossXmlArray = (xmlArray: any[]): ReactNode => {
    const output: ReactNode[] = [''];

    const addToOutput = (xmlNode: any) => {
      const textVal = xmlNode['#text'];
      if (textVal) {
        const lastOutput = output[output.length - 1];
        if (typeof lastOutput === 'string') {
          output[output.length - 1] = lastOutput + textVal;
        } else {
          output.push(textVal);
        }
        return;
      }

      const nodeKeys = Object.keys(xmlNode);
      if (nodeKeys.length !== 1) {
        throw new Error(`Invalid XML node ${JSON.stringify(xmlNode)}`);
      }
      const nodeKey = nodeKeys[0];
      const Component = components[nodeKey];
      if (Component) {
        output.push(
          <Component key={output.length}>{applyAcrossXmlArray(xmlNode[nodeKey])}</Component>
        );
      } else {
        addToOutput(`<${nodeKey}>`);
        addToOutput(applyAcrossXmlArray(xmlNode[nodeKey]));
        addToOutput(`</${nodeKey}>`);
      }
    };

    xmlArray.forEach(addToOutput);

    return output.length === 1 ? (
      output[0]
    ) : (
      <>
        {output.map((part, index) => (
          <React.Fragment key={index}>{part}</React.Fragment>
        ))}
      </>
    );
  };

  return applyAcrossXmlArray(parsedXml);
};

const formatWithMessageFormatter = (
  formatter: ResolvedMessageFormatter,
  vars: Record<string, any> = {},
  text: string,
  locale: string
): string => {
  if (formatter === 'none') {
    return text;
  }
  if (formatter === 'waysParser') {
    return formatWaysParser(vars, text, locale);
  }
  try {
    const formatted = formatter({
      text,
      vars,
      locale,
    });
    if (typeof formatted !== 'string') {
      console.error('[18ways] messageFormatter must return a string');
      return text;
    }
    return formatted;
  } catch (error) {
    console.error('[18ways] messageFormatter failed:', error);
    return text;
  }
};

type TOptions = {
  vars?: Record<string, any>;
  components?: ComponentsMap | boolean | undefined;
  context?: TranslationContextInput;
};

interface TFunction {
  (children: string, options?: Omit<TOptions, 'components'>): string;
  <X extends ReactNode>(
    children: X,
    options: TOptions & { components: ComponentsMap | boolean }
  ): ReactNode;
  <X extends ReactNode>(children: X, options?: TOptions): ReactNode;
}

const noopUnsubscribe = () => {};
const noopSubscribe = () => noopUnsubscribe;
const EMPTY_STORE_SNAPSHOT = {
  version: 0,
  translations: {},
};
const getEmptyStoreSnapshot = () => EMPTY_STORE_SNAPSHOT;
const EMPTY_LOADING_SNAPSHOT: TranslationStoreSnapshot = {
  version: 0,
  translations: {},
  hasPending: false,
  hasInFlight: false,
};
const getEmptyLoadingSnapshot = () => EMPTY_LOADING_SNAPSHOT;

export const useT = ({
  baseLocale: tBaseLocale,
  targetLocale: tTargetLocale,
  suspend = true,
}: UseTParams = {}) => {
  const context = useContext(Context);
  const rootContext = useContext(WaysRootContext);
  const isRenderingSuspenseFallback = useContext(SuspenseFallbackContext);
  const missingTranslationSuspensePromisesRef = useRef<Map<string, Promise<void>>>(new Map());
  const storeSnapshot = useSyncExternalStore(
    context?.store ? context.store.subscribeToTranslations : noopSubscribe,
    context?.store ? context.store.getTranslationsSnapshot : getEmptyStoreSnapshot,
    context?.store ? context.store.getTranslationsSnapshot : getEmptyStoreSnapshot
  );

  const t = useCallback<TFunction>(
    ((
      children: ReactNode | string,
      { vars, components: tComponents, context: localContext }: TOptions = {}
    ): string | ReactNode => {
      const {
        store,
        contextKey,
        contextMetadata,
        queueTranslation,
        getFallbackLocale,
        getPendingSeedPromise,
        hasPendingClientLocaleTransition,
        baseLocale: cBaseLocale,
        targetLocale: cTargetLocale,
        components: cComponents,
        messageFormatter,
      } = context || {};

      const baseLocale = tBaseLocale || cBaseLocale;
      const targetLocale = tTargetLocale || cTargetLocale;
      const components = tComponents
        ? {
            ...cComponents,
            ...(typeof tComponents === 'object' ? tComponents : {}),
          }
        : {};

      if (!targetLocale) {
        throw new Error('targetLocale is required');
      }

      const getRecursiveText = (node: ReactNode | string): string[] => {
        if (typeof node === 'string' || typeof node === 'number') {
          return [node.toString()];
        }

        if (Array.isArray(node)) {
          return node.flatMap(getRecursiveText);
        }

        if (React.isValidElement(node) && node.props && (node.props as any).children) {
          return React.Children.map(
            (node.props as any).children,
            getRecursiveText
          )?.flat() as string[];
        }

        return [];
      };

      const texts = getRecursiveText(children);

      const translatedTexts = (() => {
        if (
          !store ||
          !contextKey ||
          !queueTranslation ||
          !getFallbackLocale ||
          !getPendingSeedPromise
        ) {
          return texts;
        }

        if (baseLocale && targetLocale && baseLocale === targetLocale) {
          return texts;
        }

        const baseContextMetadata: TranslationContextValue = contextMetadata || {
          name: contextKey,
          label: '',
          treePath: '',
          filePath: '',
        };
        const localContextMetadata = localContext ? normalizeContextInput(localContext) : null;
        const finalContextMetadata = localContextMetadata
          ? mergeContextValues(baseContextMetadata, localContextMetadata)
          : baseContextMetadata;
        const effectiveContextKey = finalContextMetadata.name || contextKey;
        const contextFingerprint = generateHashId(finalContextMetadata);
        const textsHash = generateHashId([...texts, effectiveContextKey]);
        const decryptCachedTranslation = (
          encryptedTexts: string[],
          localeToDecrypt: string
        ): string[] | null => {
          try {
            return decryptTranslationValues({
              encryptedTexts,
              sourceTexts: texts,
              locale: localeToDecrypt,
              key: effectiveContextKey,
              textsHash,
            });
          } catch (error) {
            console.error('[18ways] Failed to decrypt cached translation payload:', error);
            return null;
          }
        };

        const pendingSeedPromise = getPendingSeedPromise(effectiveContextKey, targetLocale);
        const fallbackLocale = getFallbackLocale();
        const getFallbackTranslation = (): string[] | null => {
          if (!fallbackLocale || fallbackLocale === targetLocale) {
            return null;
          }

          const fallbackVal =
            store.getTranslation(fallbackLocale, effectiveContextKey, textsHash) ||
            (
              (getInMemoryTranslations()[fallbackLocale] as Record<string, unknown> | undefined)?.[
                effectiveContextKey
              ] as Record<string, unknown> | undefined
            )?.[textsHash];
          if (!fallbackVal) {
            return null;
          }

          const decryptedFallback = decryptCachedTranslation(
            fallbackVal as string[],
            fallbackLocale
          );
          if (!decryptedFallback) {
            return null;
          }

          // Prefer previous-locale text when available, but preserve source/base text
          // for any slots the previous locale does not yet cover.
          return texts.map((text, index) => decryptedFallback[index] || text);
        };

        const fallbackTranslation = getFallbackTranslation();
        const shouldHoldTargetLocaleDisplay = (): boolean => {
          if (typeof window === 'undefined' || !fallbackLocale || fallbackLocale === targetLocale) {
            return false;
          }

          const hasContextSpecificPendingWork = Boolean(
            pendingSeedPromise ||
            store.hasPendingRequestsForKey(effectiveContextKey) ||
            store.hasInFlightRequestsForKey(effectiveContextKey)
          );
          if (hasContextSpecificPendingWork) {
            return true;
          }

          if (!hasPendingClientLocaleTransition) {
            return false;
          }

          return Boolean(store.hasPendingRequests() || store.hasInFlightRequests());
        };

        if (!shouldHoldTargetLocaleDisplay()) {
          const cachedVal = store.getTranslation(targetLocale, effectiveContextKey, textsHash);
          if (cachedVal) {
            const decrypted = decryptCachedTranslation(cachedVal, targetLocale);
            if (decrypted) {
              if (typeof window !== 'undefined') {
                queueTranslation({
                  key: effectiveContextKey,
                  textsHash,
                  baseLocale,
                  targetLocale,
                  texts,
                  contextFingerprint,
                  contextMetadata: finalContextMetadata,
                  syncOnly: true,
                });
              }
              return decrypted;
            }
          }
        }

        if (pendingSeedPromise) {
          if (!suspend && typeof window !== 'undefined') {
            return fallbackTranslation || texts;
          }
          if (shouldHoldTargetLocaleDisplay()) {
            return fallbackTranslation || texts;
          }
          if (isRenderingSuspenseFallback) {
            // On the server, keep suspending until seed resolves so we do not
            // stream source-language fallback content.
            if (typeof window === 'undefined') {
              throw pendingSeedPromise;
            }
            return fallbackTranslation || texts;
          }

          throw pendingSeedPromise;
        }

        queueTranslation({
          key: effectiveContextKey,
          textsHash,
          baseLocale,
          targetLocale,
          texts,
          contextFingerprint,
          contextMetadata: finalContextMetadata,
        });

        if (shouldHoldTargetLocaleDisplay()) {
          return fallbackTranslation || texts;
        }

        if (fallbackTranslation) {
          return fallbackTranslation;
        }

        const shouldSuspendForMissingTranslation =
          suspend &&
          Boolean(baseLocale && targetLocale && baseLocale !== targetLocale) &&
          (store.hasPendingRequestsForKey(effectiveContextKey) ||
            store.hasInFlightRequestsForKey(effectiveContextKey)) &&
          (!isRenderingSuspenseFallback || typeof window === 'undefined');

        if (shouldSuspendForMissingTranslation) {
          const suspenseKey = `${effectiveContextKey}:${targetLocale}`;
          let pendingPromise = missingTranslationSuspensePromisesRef.current.get(suspenseKey);
          if (!pendingPromise) {
            pendingPromise = Promise.resolve()
              .then(() => store.waitForIdleForKey(effectiveContextKey))
              .finally(() => {
                missingTranslationSuspensePromisesRef.current.delete(suspenseKey);
              });
            missingTranslationSuspensePromisesRef.current.set(suspenseKey, pendingPromise);
          }
          throw pendingPromise;
        }
        return texts;
      })();

      const textMap = Object.fromEntries(
        texts.map((text, index) => [text, translatedTexts[index]])
      );

      const applyRecursiveTextMap = (node: ReactNode | string, i?: number): string | ReactNode => {
        if (typeof node === 'string' || typeof node === 'number') {
          const textWithVars = formatWithMessageFormatter(
            messageFormatter || 'waysParser',
            vars,
            (textMap[node] || node).toString(),
            targetLocale
          );
          return applyComponentsToText(components, textWithVars);
        }

        if (Array.isArray(node)) {
          return node.map(applyRecursiveTextMap);
        }

        if (React.isValidElement(node) && node.props && (node.props as any).children) {
          return React.cloneElement(node as ReactElement<any>, {
            key: node.key || i || 0,
            children: applyRecursiveTextMap((node.props as any).children),
          });
        }

        return node;
      };

      return applyRecursiveTextMap(children);
    }) as TFunction,
    [context, isRenderingSuspenseFallback, storeSnapshot.version, tBaseLocale, tTargetLocale]
  );

  return t;
};

export const useTranslatedMemo = <T,>(
  factory: UseTranslatedMemoFactory<T>,
  deps: DependencyList,
  options: UseTParams = {}
): T => {
  const t = useT(options);
  return useMemo(() => factory(t), [t, ...deps]);
};

export const useTranslationLoading = (): boolean => {
  const context = useContext(Context);
  useSyncExternalStore(
    context?.store ? context.store.subscribe : noopSubscribe,
    context?.store ? context.store.getSnapshot : getEmptyLoadingSnapshot,
    context?.store ? context.store.getSnapshot : getEmptyLoadingSnapshot
  );

  if (!context?.store || !context.contextKey) {
    return false;
  }

  const hasPendingSeed = Boolean(
    context.targetLocale &&
    context.getPendingSeedPromise?.(context.contextKey, context.targetLocale)
  );
  const hasPending = context.store.hasPendingRequestsForKey(context.contextKey);
  const hasInFlight = context.store.hasInFlightRequestsForKey(context.contextKey);
  return hasPendingSeed || hasPending || hasInFlight;
};

export const useCurrentLocale = (): string => {
  const rootContext = useContext(WaysRootContext);
  return rootContext.targetLocale || rootContext.defaultLocale || 'en-GB';
};

export const useSetCurrentLocale = (): ((nextLocale: string) => void) => {
  const rootContext = useContext(WaysRootContext);
  return useCallback(
    (nextLocale: string) => {
      if (!nextLocale) {
        return;
      }

      rootContext.setTargetLocale(nextLocale);
    },
    [rootContext]
  );
};

export type {
  LanguageSwitcherClassNameOverrides,
  LanguageSwitcherProps,
  LanguageSwitcherStyleOverrides,
} from './language-switcher';

export const LanguageSwitcher: React.FC<LanguageSwitcherProps> = (props) => {
  const rootContext = useContext(WaysRootContext);
  const rootLoadingSnapshot = useSyncExternalStore(
    rootContext.store !== emptyStore ? rootContext.store.subscribe : noopSubscribe,
    rootContext.store !== emptyStore ? rootContext.store.getSnapshot : getEmptyLoadingSnapshot,
    rootContext.store !== emptyStore ? rootContext.store.getSnapshot : getEmptyLoadingSnapshot
  );
  const currentLocale =
    props.currentLocale || rootContext.targetLocale || rootContext.defaultLocale || 'en-GB';
  const languages = useMemo(() => {
    const localeCodes = [...rootContext.acceptedLocales];
    const currentCanonical = canonicalizeLocale(currentLocale);

    if (
      currentCanonical &&
      !localeCodes.some((localeCode) => localeCode.toLowerCase() === currentCanonical.toLowerCase())
    ) {
      localeCodes.unshift(currentCanonical);
    }

    return buildLanguagesFromLocaleCodes(localeCodes);
  }, [currentLocale, rootContext.acceptedLocales]);
  const isTranslationLoading = rootLoadingSnapshot.hasPending || rootLoadingSnapshot.hasInFlight;

  return (
    <InternalLanguageSwitcher
      {...props}
      rootLocale={rootContext.targetLocale}
      hasRootStore={rootContext.store !== emptyStore}
      isTranslationLoading={isTranslationLoading}
      onRootLocaleChange={rootContext.setTargetLocale}
      languages={languages}
    />
  );
};

export const T: <X extends ReactNode | string>(props: {
  children: X;
  vars?: Record<string, any>;
  context?: TranslationContextInput;
  baseLocale?: string;
  targetLocale?: string;
  components?: ComponentsMap;
  fixed?: boolean;
}) => typeof props.components extends undefined ? X : ReactNode = ({
  children,
  vars,
  context,
  baseLocale,
  targetLocale,
  components,
  fixed,
}) => {
  const t = useT({
    baseLocale,
    targetLocale,
  });

  if (fixed) {
    return children;
  }

  return t(children, { vars, components, context });
};
