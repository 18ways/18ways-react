/// <reference path="./global.d.ts" />

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
} from 'react';
import { XMLParser } from 'fast-xml-parser';
import {
  Translations,
  type Language,
  type TranslationFallbackConfig,
  getInMemoryTranslations,
  getWindowTranslationFallbackConfig,
  type _RequestInitDecorator,
  fetchConfig,
  resolveAcceptedLocales,
  resolveTranslationFallbackMode,
  resetServerInMemoryTranslations,
  fetchSeed,
  generateHashId,
  DEFAULT_TRANSLATION_FALLBACK_CONFIG,
  buildTranslationFallbackValue,
  type TranslationContextInput,
  type TranslationContextInputObject,
  type TranslationContextValue,
  getDemoLanguageInfo,
  isDemoApiKey,
} from '@18ways/core/common';
import { parseRichTextMarkupAgainstSource } from '@18ways/core/rich-text';
import { InjectTranslations } from './inject';
import { formatWaysParser, isRuntimeOnlyWaysMessage } from '@18ways/core/parsers/ways-parser';
import { TranslationStore, type TranslationStoreSnapshot } from '@18ways/core/translation-store';
import { registerQueueClearFn } from './testing';
import { registerRuntimeResetFn } from './testing';
import { isTestEnvironment } from './runtime-env';
import { readAcceptedLocalesFromWindow } from '@18ways/core/client-accepted-locales';
import { decryptTranslationValue } from '@18ways/core/crypto';
import {
  InternalLanguageSwitcher,
  type LanguageSwitcherClassNameOverrides,
  type LanguageSwitcherProps,
  type LanguageSwitcherStyleOverrides,
} from './language-switcher';
import { deepMerged } from '@18ways/core/object-utils';
import { canonicalizeLocale, localeToFlagEmoji } from '@18ways/core/i18n-shared';
import { create18waysEngine, type WaysEngine } from '@18ways/core/engine';
import { extractTranslationMessage, renderRichTextValue } from './rich-text';
import {
  getDomSnapshotOverrideVersion,
  getDomSnapshotTranslationOverride,
  recordDomSnapshotRenderedTranslation,
  startDomSnapshotRuntime,
  subscribeDomSnapshotOverrideVersion,
} from './dom-snapshots';

export { fetchAcceptedLocales, fetchConfig, resolveOrigin } from '@18ways/core/common';
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

const localeCodeListsEqual = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((locale, index) => locale === right[index]);

const translationFallbackConfigsEqual = (
  left: TranslationFallbackConfig,
  right: TranslationFallbackConfig
): boolean =>
  left.default === right.default &&
  left.overrides.length === right.overrides.length &&
  left.overrides.every(
    (entry, index) =>
      entry.locale === right.overrides[index]?.locale &&
      entry.fallback === right.overrides[index]?.fallback
  );

type RuntimeConfigServerResolution =
  | {
      status: 'pending';
      promise: Promise<void>;
    }
  | {
      status: 'resolved';
      locales: string[];
      translationFallback: TranslationFallbackConfig;
    };

const runtimeConfigServerResolutionsSingleton = new Map<string, RuntimeConfigServerResolution>();
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

const buildRuntimeConfigServerResolutionKey = (input: {
  apiKey: string;
  _apiUrl?: string;
  requestOrigin?: string;
  cacheTtl?: number;
  fetcher?: typeof fetch;
  requestInitDecorator?: _RequestInitDecorator;
}): string =>
  JSON.stringify({
    apiKey: input.apiKey,
    _apiUrl: input._apiUrl || '',
    requestOrigin: input.requestOrigin || '',
    cacheTtl: typeof input.cacheTtl === 'number' ? input.cacheTtl : null,
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
  localeCodes.map((code) => {
    const demoLanguage = getDemoLanguageInfo(code);
    if (demoLanguage) {
      return demoLanguage;
    }

    return {
      code,
      name: code,
      nativeName: code,
      flag: localeToFlagEmoji(code),
    };
  });

const logDemoModeLocaleChange = (input: {
  locale: string;
  baseLocale: string;
  previousLocale: string | null;
}): void => {
  if (typeof window === 'undefined' || typeof console === 'undefined') {
    return;
  }

  const { locale, baseLocale, previousLocale } = input;
  const demoLanguage = getDemoLanguageInfo(locale);
  const localeLabel = demoLanguage?.name || locale;
  const header = previousLocale
    ? `18ways Demo Mode: language change detected`
    : `18ways Demo Mode: language detected`;

  console.group(
    '%c%s',
    'background:#111827;color:#f9fafb;padding:6px 10px;border-radius:6px;font-weight:800;font-size:13px;',
    header
  );
  console.log(
    '%cDemo token active',
    'background:#fde68a;color:#111827;padding:2px 6px;border-radius:4px;font-weight:800;'
  );
  console.log(
    '%cLanguage%c %s',
    'color:#6b7280;font-weight:700;',
    'color:inherit;',
    previousLocale
      ? `${previousLocale} -> ${locale} (${localeLabel})`
      : `${locale} (${localeLabel})`
  );
  console.log('%cBase locale%c %s', 'color:#6b7280;font-weight:700;', 'color:inherit;', baseLocale);
  console.log(
    '%cSign up to get a production token and translate for real!',
    'color:#b91c1c;font-weight:900;font-size:14px;'
  );
  console.log(
    '%chttps://18ways.com/dashboard',
    'background:#fca5a5;color:#111827;padding:3px 8px;border-radius:4px;font-weight:900;font-size:15px;'
  );
  console.groupEnd();
};

interface TranslateTextParams {
  baseLocale?: string;
  targetLocale: string;
  text: string;
}

interface ContextualTranslateTextParams extends TranslateTextParams {
  key: string;
  textHash: string;
  contextFingerprint?: string;
  contextMetadata?: TranslationContextValue;
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
  translationFallbackConfig: TranslationFallbackConfig;
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
  persistLocaleCookie?: boolean;
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
  persistLocaleCookie: boolean;
  acceptedLocales: string[];
  translationFallbackConfig: TranslationFallbackConfig;
  messageFormatter: ResolvedMessageFormatter;
  serverInitialTranslationTimeoutMs: number;
  setTargetLocale: (targetLocale: string) => void;
  getPendingSeedPromise: SeedPromiseLookup;
  ensureSeedPromise: SeedPromiseEnsure;
  completedTranslations: Translations;
  setCompletedTranslations: (keyPath: string[], translation: string) => void;
  store: TranslationStore;
};

const emptyStore = new TranslationStore({
  translations: {},
  fetchTranslations: async () => ({ data: [], errors: [] }),
});

if (isTestEnvironment()) {
  registerRuntimeResetFn(() => {
    transitionFallbackLocaleSingleton = null;
    mountedContextCountsSingleton.clear();
    runtimeConfigServerResolutionsSingleton.clear();
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
  persistLocaleCookie: true,
  acceptedLocales: [],
  translationFallbackConfig: DEFAULT_TRANSLATION_FALLBACK_CONFIG,
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
  persistLocaleCookie?: boolean;
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
  persistLocaleCookie = true,
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
  const resolvedBaseLocale = canonicalizeLocale(baseLocale || defaultLocale);
  const acceptedLocalesFromProps = useMemo(
    () => resolveAcceptedLocales(undefined, acceptedLocales),
    [acceptedLocales]
  );
  const [runtimeAcceptedLocales, setRuntimeAcceptedLocales] = useState<string[]>([]);
  const [runtimeTranslationFallbackConfig, setRuntimeTranslationFallbackConfig] =
    useState<TranslationFallbackConfig>(DEFAULT_TRANSLATION_FALLBACK_CONFIG);
  const acceptedLocalesFromWindow = readAcceptedLocalesFromWindow();
  const translationFallbackConfigFromWindow = getWindowTranslationFallbackConfig();
  const acceptedLocalesFromWindowKey = acceptedLocalesFromWindow.join(',');
  const translationFallbackConfigFromWindowKey = JSON.stringify(
    translationFallbackConfigFromWindow || DEFAULT_TRANSLATION_FALLBACK_CONFIG
  );
  const runtimeConfigServerResolutionKey = apiKey
    ? buildRuntimeConfigServerResolutionKey({
        apiKey,
        _apiUrl,
        requestOrigin,
        cacheTtl,
        fetcher,
        requestInitDecorator,
      })
    : null;
  const runtimeConfigServerResolution = runtimeConfigServerResolutionKey
    ? runtimeConfigServerResolutionsSingleton.get(runtimeConfigServerResolutionKey)
    : undefined;

  if (typeof window === 'undefined' && runtimeConfigServerResolutionKey) {
    if (!runtimeConfigServerResolution) {
      const runtimeConfigPromise = fetchConfig({
        apiKey,
        apiUrl: _apiUrl,
        origin: requestOrigin,
        fetcher,
        cacheTtlSeconds: cacheTtl,
        _requestInitDecorator: requestInitDecorator,
      }).then((config) => {
        runtimeConfigServerResolutionsSingleton.set(runtimeConfigServerResolutionKey, {
          status: 'resolved',
          locales: resolveAcceptedLocales(
            resolvedBaseLocale || defaultLocale,
            config.languages.map((language) => language.code)
          ),
          translationFallback: config.translationFallback,
        });
      });
      runtimeConfigServerResolutionsSingleton.set(runtimeConfigServerResolutionKey, {
        status: 'pending',
        promise: runtimeConfigPromise,
      });
      throw runtimeConfigPromise;
    }

    if (runtimeConfigServerResolution.status === 'pending') {
      throw runtimeConfigServerResolution.promise;
    }
  }

  useEffect(() => {
    if (acceptedLocalesFromWindow.length > 0) {
      setRuntimeAcceptedLocales((previousLocales) =>
        localeCodeListsEqual(previousLocales, acceptedLocalesFromWindow)
          ? previousLocales
          : acceptedLocalesFromWindow
      );
    }

    if (translationFallbackConfigFromWindow) {
      setRuntimeTranslationFallbackConfig((previousConfig) =>
        translationFallbackConfigsEqual(previousConfig, translationFallbackConfigFromWindow)
          ? previousConfig
          : translationFallbackConfigFromWindow
      );
    }

    if (acceptedLocalesFromWindow.length > 0 && translationFallbackConfigFromWindow) {
      return;
    }

    let cancelled = false;

    void fetchConfig({
      apiKey,
      apiUrl: _apiUrl,
      origin: requestOrigin,
      fetcher,
      cacheTtlSeconds: cacheTtl,
      _requestInitDecorator: requestInitDecorator,
    })
      .then((config) => {
        if (cancelled) {
          return;
        }

        const normalizedFetchedLocales = resolveAcceptedLocales(
          resolvedBaseLocale || defaultLocale,
          config.languages.map((language) => language.code)
        );
        setRuntimeAcceptedLocales((previousLocales) =>
          localeCodeListsEqual(previousLocales, normalizedFetchedLocales)
            ? previousLocales
            : normalizedFetchedLocales
        );
        setRuntimeTranslationFallbackConfig((previousConfig) =>
          translationFallbackConfigsEqual(previousConfig, config.translationFallback)
            ? previousConfig
            : config.translationFallback
        );
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('[18ways] Failed to fetch runtime config:', error);
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
    acceptedLocalesFromProps,
    requestInitDecorator,
    requestOrigin,
    resolvedBaseLocale,
    translationFallbackConfigFromWindowKey,
  ]);

  const fallbackLocale = resolvedBaseLocale || canonicalizeLocale(defaultLocale);
  const acceptedLocalesFromServer =
    runtimeConfigServerResolution?.status === 'resolved'
      ? runtimeConfigServerResolution.locales
      : [];
  const translationFallbackConfigFromServer =
    runtimeConfigServerResolution?.status === 'resolved'
      ? runtimeConfigServerResolution.translationFallback
      : DEFAULT_TRANSLATION_FALLBACK_CONFIG;
  const fallbackAcceptedLocales = fallbackLocale ? [fallbackLocale] : [];
  const normalizedAcceptedLocales =
    acceptedLocalesFromProps.length > 0
      ? resolveAcceptedLocales(resolvedBaseLocale, acceptedLocalesFromProps)
      : resolveAcceptedLocales(
          resolvedBaseLocale,
          acceptedLocalesFromWindow,
          acceptedLocalesFromServer,
          runtimeAcceptedLocales,
          fallbackAcceptedLocales
        );
  const hasResolvedAcceptedLocales =
    acceptedLocalesFromProps.length > 0 ||
    acceptedLocalesFromWindow.length > 0 ||
    acceptedLocalesFromServer.length > 0 ||
    runtimeAcceptedLocales.length > 0;
  const resolvedTranslationFallbackConfig =
    translationFallbackConfigFromWindow ||
    (runtimeConfigServerResolution?.status === 'resolved'
      ? translationFallbackConfigFromServer
      : runtimeTranslationFallbackConfig);

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
  if (typeof window !== 'undefined') {
    window.__18WAYS_TRANSLATION_FALLBACK_CONFIG__ = resolvedTranslationFallbackConfig;
  }

  const store = engine.getStore();
  const serverIdlePromiseRef = useRef<Promise<void> | null>(null);
  const pendingSeedPromisesRef = useRef<Map<string, Promise<void>>>(new Map());
  const pendingSeedResolversRef = useRef<Map<string, () => void>>(new Map());
  const seededContextsRef = useRef<Set<string>>(new Set());
  const queuedSeedContextsByLocaleRef = useRef<Map<string, Set<string>>>(new Map());
  const isSeedFlushScheduledRef = useRef(false);
  const previousTargetLocaleRef = useRef(defaultLocale);
  const previousLoggedDemoLocaleRef = useRef<string | null>(null);

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
    if (!isDemoApiKey(apiKey)) {
      return;
    }

    const previousLocale = previousLoggedDemoLocaleRef.current;
    if (previousLocale === targetLocale) {
      return;
    }

    logDemoModeLocaleChange({
      locale: targetLocale,
      baseLocale: resolvedBaseLocale || defaultLocale,
      previousLocale,
    });
    previousLoggedDemoLocaleRef.current = targetLocale;
  }, [apiKey, defaultLocale, resolvedBaseLocale, targetLocale]);

  useEffect(() => {
    return startDomSnapshotRuntime({
      apiKey,
      apiUrl: _apiUrl,
      requestOrigin,
      requestInitDecorator,
      getTargetLocale: () => targetLocale,
      getBaseLocale: () => canonicalizeLocale(baseLocale || defaultLocale),
    });
  }, [
    apiKey,
    _apiUrl,
    requestOrigin,
    requestInitDecorator,
    targetLocale,
    baseLocale,
    defaultLocale,
  ]);

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
    (keyPath: string[], translation: string) => {
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
        persistLocaleCookie,
        acceptedLocales: normalizedAcceptedLocales,
        translationFallbackConfig: resolvedTranslationFallbackConfig,
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
        translationFallbackConfig={resolvedTranslationFallbackConfig}
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
    translationFallbackConfig,
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
  const shouldEnsureSeedPromise = shouldBlockInitialRender && contextKey !== 'root';
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
    if (!isTestEnvironment()) {
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
          translationFallbackConfig,
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
      persistLocaleCookie,
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
    const shouldResetServerCache = isTestEnvironment();
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
            persistLocaleCookie={persistLocaleCookie}
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

type TInlineAliasSpec = {
  format?: string;
  [key: string]: unknown;
};

type TRenderableChild = ReactNode | TInlineAliasSpec | readonly TRenderableChild[];

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

const INLINE_ALIAS_RESERVED_KEYS = new Set(['format']);
const INLINE_ALIAS_DATE_STYLES = new Set(['short', 'medium', 'long', 'full']);

type InlineAliasDescriptor = {
  variableName: string;
  variableValue: unknown;
  format?: string;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const splitInlineAliasFormat = (value: string): string[] => {
  const segments: string[] = [];
  let current = '';
  let depth = 0;

  for (const char of value) {
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
    }

    if (char === ',' && depth === 0) {
      const trimmed = current.trim();
      if (trimmed) {
        segments.push(trimmed);
      }
      current = '';
      continue;
    }

    current += char;
  }

  const trimmed = current.trim();
  if (trimmed) {
    segments.push(trimmed);
  }

  return segments;
};

const extractInlineAliasDescriptor = (value: unknown): InlineAliasDescriptor | null => {
  if (!isPlainObject(value) || React.isValidElement(value)) {
    return null;
  }

  const rawFormat = value.format;
  if (rawFormat !== undefined && typeof rawFormat !== 'string') {
    return null;
  }

  const variableEntries = Object.entries(value).filter(
    ([key]) => !INLINE_ALIAS_RESERVED_KEYS.has(key)
  );
  if (variableEntries.length !== 1) {
    return null;
  }

  const [variableName, variableValue] = variableEntries[0];
  if (!variableName) {
    return null;
  }

  const trimmedFormat = typeof rawFormat === 'string' ? rawFormat.trim() : undefined;
  return {
    variableName,
    variableValue,
    format: trimmedFormat ? trimmedFormat : undefined,
  };
};

const buildInlineAliasPlaceholder = ({
  variableName,
  format,
}: Omit<InlineAliasDescriptor, 'variableValue'>): string => {
  if (!format) {
    return `{${variableName}}`;
  }

  const segments = splitInlineAliasFormat(format);
  if (segments.length === 0) {
    return `{${variableName}}`;
  }

  const [formatType, ...options] = segments;
  const normalizedOptions =
    (formatType === 'date' || formatType === 'datetime') &&
    options.length === 1 &&
    INLINE_ALIAS_DATE_STYLES.has(options[0])
      ? [`dateStyle:${options[0]}`]
      : options;

  return `{${[variableName, formatType, ...normalizedOptions].join(', ')}}`;
};

const mergeAliasVars = (
  left?: Record<string, any>,
  right?: Record<string, any>
): Record<string, any> | undefined => {
  if (!left && !right) {
    return undefined;
  }

  return {
    ...(left || {}),
    ...(right || {}),
  };
};

const normalizeInlineAliases = (
  value: TRenderableChild
): {
  children: ReactNode;
  vars?: Record<string, any>;
  changed: boolean;
} => {
  const aliasDescriptor = extractInlineAliasDescriptor(value);
  if (aliasDescriptor) {
    return {
      children: buildInlineAliasPlaceholder(aliasDescriptor),
      vars: {
        [aliasDescriptor.variableName]: aliasDescriptor.variableValue,
      },
      changed: true,
    };
  }

  if (Array.isArray(value)) {
    let changed = false;
    let aliasVars: Record<string, any> | undefined;

    const children = value.map((child) => {
      const normalizedChild = normalizeInlineAliases(child);
      changed = changed || normalizedChild.changed;
      aliasVars = mergeAliasVars(aliasVars, normalizedChild.vars);
      return normalizedChild.children;
    });

    return {
      children,
      vars: aliasVars,
      changed,
    };
  }

  if (React.isValidElement(value)) {
    const originalChildren = (value.props as { children?: TRenderableChild }).children;
    if (originalChildren === undefined) {
      return {
        children: value,
        vars: undefined,
        changed: false,
      };
    }

    const normalizedChildren = normalizeInlineAliases(originalChildren);
    if (!normalizedChildren.changed) {
      return {
        children: value,
        vars: normalizedChildren.vars,
        changed: false,
      };
    }

    return {
      children: React.cloneElement(value, undefined, normalizedChildren.children),
      vars: normalizedChildren.vars,
      changed: true,
    };
  }

  return {
    children: value as ReactNode,
    vars: undefined,
    changed: false,
  };
};

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
  const domSnapshotOverrideVersion = useSyncExternalStore(
    subscribeDomSnapshotOverrideVersion,
    getDomSnapshotOverrideVersion,
    getDomSnapshotOverrideVersion
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
        translationFallbackConfig,
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
      const resolvedMessageFormatter = messageFormatter || 'waysParser';

      if (!targetLocale) {
        throw new Error('targetLocale is required');
      }

      const extractedMessage = extractTranslationMessage(children, components);
      const sourceText =
        extractedMessage.kind === 'plain' ? extractedMessage.text : extractedMessage.markup;
      let domSnapshotIdentity: {
        locale: string;
        key: string;
        textHash: string;
        contextFingerprint?: string;
      } | null = null;

      const translatedText = (() => {
        if (
          extractedMessage.kind === 'plain' &&
          resolvedMessageFormatter === 'waysParser' &&
          isRuntimeOnlyWaysMessage(sourceText)
        ) {
          return sourceText;
        }

        if (
          !store ||
          !contextKey ||
          !queueTranslation ||
          !getFallbackLocale ||
          !getPendingSeedPromise
        ) {
          return sourceText;
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
        const textHash = generateHashId([sourceText, effectiveContextKey]);
        domSnapshotIdentity = {
          locale: targetLocale,
          key: effectiveContextKey,
          textHash,
          contextFingerprint,
        };
        const decryptCachedTranslation = (
          encryptedText: string,
          localeToDecrypt: string
        ): string | null => {
          try {
            return decryptTranslationValue({
              encryptedText,
              sourceText,
              locale: localeToDecrypt,
              key: effectiveContextKey,
              textHash,
            });
          } catch (error) {
            console.error('[18ways] Failed to decrypt cached translation payload:', error);
            return null;
          }
        };
        const queuedEntry: ContextualTranslateTextParams = {
          key: effectiveContextKey,
          textHash,
          baseLocale,
          targetLocale,
          text: sourceText,
          contextFingerprint,
          contextMetadata: finalContextMetadata,
        };

        if (baseLocale && targetLocale && baseLocale === targetLocale) {
          queueTranslation(queuedEntry);
          return sourceText;
        }

        const pendingSeedPromise = getPendingSeedPromise(effectiveContextKey, targetLocale);
        const fallbackLocale = getFallbackLocale();
        const noTranslationFallback = buildTranslationFallbackValue(
          resolveTranslationFallbackMode(translationFallbackConfig, targetLocale),
          sourceText,
          effectiveContextKey
        );
        const getFallbackTranslation = (): string | null => {
          if (!fallbackLocale || fallbackLocale === targetLocale) {
            return null;
          }

          const fallbackVal =
            store.getTranslation(fallbackLocale, effectiveContextKey, textHash) ||
            (
              (getInMemoryTranslations()[fallbackLocale] as Record<string, unknown> | undefined)?.[
                effectiveContextKey
              ] as Record<string, unknown> | undefined
            )?.[textHash];
          if (!fallbackVal) {
            return null;
          }

          const decryptedFallback = decryptCachedTranslation(fallbackVal as string, fallbackLocale);
          if (!decryptedFallback) {
            return null;
          }

          return decryptedFallback;
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
          const cachedVal = store.getTranslation(targetLocale, effectiveContextKey, textHash);
          if (cachedVal) {
            const decrypted = decryptCachedTranslation(cachedVal, targetLocale);
            if (decrypted) {
              return decrypted;
            }
          }
        }

        if (pendingSeedPromise) {
          if (!suspend && typeof window !== 'undefined') {
            return fallbackTranslation || noTranslationFallback;
          }
          if (shouldHoldTargetLocaleDisplay()) {
            return fallbackTranslation || noTranslationFallback;
          }
          if (isRenderingSuspenseFallback) {
            // On the server, keep suspending until seed resolves so we do not
            // stream source-language fallback content.
            if (typeof window === 'undefined') {
              throw pendingSeedPromise;
            }
            return fallbackTranslation || noTranslationFallback;
          }

          throw pendingSeedPromise;
        }

        queueTranslation(queuedEntry);

        if (shouldHoldTargetLocaleDisplay()) {
          return fallbackTranslation || noTranslationFallback;
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
        return noTranslationFallback;
      })();

      if (domSnapshotIdentity) {
        recordDomSnapshotRenderedTranslation({
          ...domSnapshotIdentity,
          sourceTexts: [sourceText],
          translatedTexts: [translatedText.toString()],
          visibleTexts: [
            formatWithMessageFormatter(
              resolvedMessageFormatter,
              vars,
              translatedText.toString(),
              targetLocale
            ),
          ],
        });
      }

      const domSnapshotOverride =
        domSnapshotIdentity && targetLocale
          ? getDomSnapshotTranslationOverride(domSnapshotIdentity)
          : null;
      const effectiveTranslatedText = domSnapshotOverride?.[0] ?? translatedText;

      if (extractedMessage.kind === 'rich') {
        const translatedMarkup = effectiveTranslatedText || extractedMessage.markup;
        const parsedTranslatedMarkup = parseRichTextMarkupAgainstSource(
          translatedMarkup,
          extractedMessage.value
        );
        const valueToRender = parsedTranslatedMarkup.value || extractedMessage.value;

        if (parsedTranslatedMarkup.error) {
          console.error(
            '[18ways] Invalid rich text translation markup:',
            parsedTranslatedMarkup.error
          );
        }

        return renderRichTextValue({
          value: valueToRender,
          slotRenderers: extractedMessage.slotRenderers,
          renderText: (text) =>
            applyComponentsToText(
              components,
              formatWithMessageFormatter(resolvedMessageFormatter, vars, text, targetLocale)
            ),
        });
      }

      const textWithVars = formatWithMessageFormatter(
        resolvedMessageFormatter,
        vars,
        effectiveTranslatedText,
        targetLocale
      );

      return applyComponentsToText(components, textWithVars);
    }) as TFunction,
    [
      context,
      domSnapshotOverrideVersion,
      isRenderingSuspenseFallback,
      storeSnapshot.version,
      tBaseLocale,
      tTargetLocale,
    ]
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

export const useAcceptedLocales = (): string[] => {
  const rootContext = useContext(WaysRootContext);
  return rootContext.acceptedLocales;
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
      persistLocaleCookie={rootContext.persistLocaleCookie}
      rootLocale={rootContext.targetLocale}
      hasRootStore={rootContext.store !== emptyStore}
      isTranslationLoading={isTranslationLoading}
      onRootLocaleChange={rootContext.setTargetLocale}
      languages={languages}
    />
  );
};

export const T: <X extends TRenderableChild>(props: {
  children: X;
  vars?: Record<string, any>;
  context?: TranslationContextInput;
  baseLocale?: string;
  targetLocale?: string;
  components?: ComponentsMap;
  fixed?: boolean;
}) => ReactNode = ({ children, vars, context, baseLocale, targetLocale, components, fixed }) => {
  const t = useT({
    baseLocale,
    targetLocale,
  });

  const normalized = normalizeInlineAliases(children);

  if (fixed) {
    return normalized.children;
  }

  const resolvedVars = mergeAliasVars(vars, normalized.vars);

  return t(normalized.children, { vars: resolvedVars, components, context });
};
