'use client';

import React, {
  type DependencyList,
  startTransition,
  useRef,
  useEffect,
  useContext,
  useCallback,
  useMemo,
  useSyncExternalStore,
  createContext,
  ReactNode,
} from 'react';
import { XMLParser } from 'fast-xml-parser';
import {
  Translations,
  type Language,
  type TranslationFallbackConfig,
  getInMemoryTranslations,
  getWindowTranslationFallbackConfig,
  mergeWindowTranslationStoreHydrationPayload,
  type _RequestInitDecorator,
  resolveAcceptedLocales,
  resetServerInMemoryTranslations,
  generateHashId,
  DEFAULT_TRANSLATION_FALLBACK_CONFIG,
  type TranslationContextInput,
  type TranslationContextInputObject,
  type TranslationContextValue,
  getDemoLanguageInfo,
  isDemoApiKey,
} from '@18ways/core/common';
import { parseRichTextMarkupAgainstSource } from '@18ways/core/rich-text';
import { InjectTranslations } from './inject';
import { formatWaysParser, isRuntimeOnlyWaysMessage } from '@18ways/core/parsers/ways-parser';
import { TranslationStore } from '@18ways/core/translation-store';
import { registerQueueClearFn } from './testing';
import { registerRuntimeResetFn } from './testing';
import { isTestEnvironment } from './runtime-env';
import { readAcceptedLocalesFromWindow } from '@18ways/core/client-accepted-locales';
import {
  InternalLanguageSwitcher,
  type LanguageSwitcherClassNameOverrides,
  type LanguageSwitcherProps,
  type LanguageSwitcherStyleOverrides,
} from './language-switcher';
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

const DEFAULT_SUSPENSE_TIMEOUT_MS = 3000;

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
      startedAt: number;
      timeoutMs: number;
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

type WaysRootSnapshot = Pick<TranslationStoreState, 'locale' | 'config'>;

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

const createSuspenseTimeoutPromise = (timeoutMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, timeoutMs);
  });

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

type TranslationStoreState = ReturnType<TranslationStore['getState']>;
type TranslationStoreMountEntry = Parameters<TranslationStore['mount']>[0];

interface ContextType {
  store: TranslationStore;
  contextKey: string;
  contextMetadata: TranslationContextValue;
  baseLocale?: string;
  targetLocale: string;
  components?: ComponentsMap;
  messageFormatter: ResolvedMessageFormatter;
}

const Context = createContext<ContextType | undefined>(undefined);

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
  suspenseTimeoutMs?: number;
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

type WaysRootContextType = {
  engine: WaysEngine | null;
  setLocale: (locale: string) => void;
  targetLocale: string;
  defaultLocale: string;
  baseLocale?: string;
  apiUrl?: string;
  cacheTtl?: number;
  fetcher?: typeof fetch;
  requestOrigin?: string;
  requestInitDecorator?: _RequestInitDecorator;
  persistLocaleCookie: boolean;
  acceptedLocales: string[];
  translationFallbackConfig: TranslationFallbackConfig;
  messageFormatter: ResolvedMessageFormatter;
  suspenseTimeoutMs: number;
  store: TranslationStore;
};

const emptyStore = new TranslationStore({
  baseLocale: 'en-GB',
  locale: 'en-GB',
  translations: {},
  fetchKnown: async () => ({ data: [], errors: [] }),
  fetchSeed: async () => ({ data: {} }),
  fetchConfig: async () => ({
    languages: [],
    total: 0,
    translationFallback: DEFAULT_TRANSLATION_FALLBACK_CONFIG,
  }),
  fetchTranslations: async () => ({ data: [], errors: [] }),
});

if (isTestEnvironment()) {
  registerRuntimeResetFn(() => {
    runtimeConfigServerResolutionsSingleton.clear();
  });
}

const WaysRootContext = createContext<WaysRootContextType>({
  engine: null,
  setLocale: () => {},
  targetLocale: 'en-GB',
  defaultLocale: 'en-GB',
  baseLocale: undefined,
  apiUrl: undefined,
  cacheTtl: undefined,
  fetcher: undefined,
  requestOrigin: undefined,
  requestInitDecorator: undefined,
  persistLocaleCookie: true,
  acceptedLocales: [],
  translationFallbackConfig: DEFAULT_TRANSLATION_FALLBACK_CONFIG,
  messageFormatter: 'waysParser',
  suspenseTimeoutMs: DEFAULT_SUSPENSE_TIMEOUT_MS,
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
  suspenseTimeoutMs?: number;
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
  suspenseTimeoutMs = DEFAULT_SUSPENSE_TIMEOUT_MS,
}) => {
  const store = engine.getStore();
  const rootSnapshotRef = useRef<{
    key: string;
    snapshot: WaysRootSnapshot;
  } | null>(null);
  const getRootSnapshot = useCallback((): WaysRootSnapshot => {
    const state = store.getState();
    const snapshotKey = JSON.stringify({
      locale: state.locale,
      config: {
        status: state.config.status,
        acceptedLocales: state.config.acceptedLocales,
        translationFallback: state.config.translationFallback,
      },
    });
    const existingSnapshot = rootSnapshotRef.current;
    if (existingSnapshot?.key === snapshotKey) {
      return existingSnapshot.snapshot;
    }

    const nextSnapshot: WaysRootSnapshot = {
      locale: state.locale,
      config: state.config,
    };
    rootSnapshotRef.current = {
      key: snapshotKey,
      snapshot: nextSnapshot,
    };
    return nextSnapshot;
  }, [store]);
  const initialStoreConfig = store.getState().config;
  const resolvedBaseLocale = canonicalizeLocale(baseLocale || defaultLocale);
  const acceptedLocalesFromProps = useMemo(
    () => resolveAcceptedLocales(undefined, acceptedLocales),
    [acceptedLocales]
  );
  const acceptedLocalesFromWindow =
    initialStoreConfig.status === 'empty' ? readAcceptedLocalesFromWindow() : [];
  const translationFallbackConfigFromWindow =
    initialStoreConfig.status === 'empty' ? getWindowTranslationFallbackConfig() : null;
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
  const hasTimedOutRuntimeConfigResolution =
    runtimeConfigServerResolution?.status === 'pending' &&
    Date.now() - runtimeConfigServerResolution.startedAt >= runtimeConfigServerResolution.timeoutMs;

  const hasStaticConfigOverride =
    acceptedLocalesFromProps.length > 0 ||
    acceptedLocalesFromWindow.length > 0 ||
    Boolean(translationFallbackConfigFromWindow);

  if (
    typeof window === 'undefined' &&
    runtimeConfigServerResolutionKey &&
    !hasStaticConfigOverride
  ) {
    if (!runtimeConfigServerResolution) {
      const startedAt = Date.now();
      const runtimeConfigPromise = store
        .loadConfig()
        .then((config) => {
          runtimeConfigServerResolutionsSingleton.set(runtimeConfigServerResolutionKey, {
            status: 'resolved',
            locales: resolveAcceptedLocales(
              resolvedBaseLocale || defaultLocale,
              config.acceptedLocales
            ),
            translationFallback: config.translationFallback,
          });
        })
        .catch((error) => {
          runtimeConfigServerResolutionsSingleton.delete(runtimeConfigServerResolutionKey);
          console.error('[18ways] Failed to fetch runtime config during SSR:', error);
        });
      const timeoutPromise = createSuspenseTimeoutPromise(suspenseTimeoutMs);
      const blockingPromise = Promise.race([runtimeConfigPromise, timeoutPromise]).then(
        () => undefined
      );
      runtimeConfigServerResolutionsSingleton.set(runtimeConfigServerResolutionKey, {
        status: 'pending',
        promise: blockingPromise,
        startedAt,
        timeoutMs: suspenseTimeoutMs,
      });
      throw blockingPromise;
    }

    if (runtimeConfigServerResolution.status === 'pending' && !hasTimedOutRuntimeConfigResolution) {
      throw runtimeConfigServerResolution.promise;
    }
  }

  const fallbackLocale = resolvedBaseLocale || canonicalizeLocale(defaultLocale);
  const acceptedLocalesFromServer =
    runtimeConfigServerResolution?.status === 'resolved'
      ? runtimeConfigServerResolution.locales
      : [];
  const translationFallbackConfigFromServer =
    runtimeConfigServerResolution?.status === 'resolved'
      ? runtimeConfigServerResolution.translationFallback
      : null;
  const fallbackAcceptedLocales = fallbackLocale ? [fallbackLocale] : [];
  const staticAcceptedLocales =
    acceptedLocalesFromProps.length > 0
      ? resolveAcceptedLocales(resolvedBaseLocale, acceptedLocalesFromProps)
      : resolveAcceptedLocales(
          resolvedBaseLocale,
          acceptedLocalesFromWindow,
          acceptedLocalesFromServer,
          fallbackAcceptedLocales
        );
  const hasResolvedStaticConfig =
    acceptedLocalesFromProps.length > 0 ||
    acceptedLocalesFromWindow.length > 0 ||
    acceptedLocalesFromServer.length > 0 ||
    Boolean(translationFallbackConfigFromWindow) ||
    Boolean(translationFallbackConfigFromServer);
  const staticTranslationFallbackConfig =
    translationFallbackConfigFromWindow ||
    translationFallbackConfigFromServer ||
    DEFAULT_TRANSLATION_FALLBACK_CONFIG;

  const previousLoggedDemoLocaleRef = useRef<string | null>(null);
  const shouldHydrateInitialStoreConfig =
    hasResolvedStaticConfig &&
    (!localeCodeListsEqual(initialStoreConfig.acceptedLocales, staticAcceptedLocales) ||
      !translationFallbackConfigsEqual(
        initialStoreConfig.translationFallback,
        staticTranslationFallbackConfig
      ) ||
      initialStoreConfig.status !== 'ready');

  if (typeof window === 'undefined' && shouldHydrateInitialStoreConfig) {
    store.hydrate({
      config: {
        acceptedLocales: staticAcceptedLocales,
        translationFallback: staticTranslationFallbackConfig,
      },
    });
  }

  const rootSnapshot = useSyncExternalStore(store.subscribe, getRootSnapshot, getRootSnapshot);
  const targetLocale = rootSnapshot.locale.selected;
  const acceptedLocalesFromStore =
    rootSnapshot.config.status === 'ready'
      ? resolveAcceptedLocales(
          resolvedBaseLocale,
          rootSnapshot.config.acceptedLocales,
          fallbackAcceptedLocales
        )
      : staticAcceptedLocales;
  const translationFallbackConfigFromStore =
    rootSnapshot.config.status === 'ready'
      ? rootSnapshot.config.translationFallback
      : staticTranslationFallbackConfig;

  useEffect(() => {
    if (shouldHydrateInitialStoreConfig) {
      store.hydrate({
        config: {
          acceptedLocales: staticAcceptedLocales,
          translationFallback: staticTranslationFallbackConfig,
        },
      });
      return;
    }

    if (store.getState().config.status !== 'empty') {
      return;
    }

    let cancelled = false;

    void store.loadConfig().catch((error) => {
      if (!cancelled) {
        console.error('[18ways] Failed to fetch runtime config:', error);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    acceptedLocalesFromWindowKey,
    hasResolvedStaticConfig,
    requestOrigin,
    store,
    staticAcceptedLocales,
    staticTranslationFallbackConfig,
    shouldHydrateInitialStoreConfig,
    translationFallbackConfigFromWindowKey,
  ]);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = targetLocale;
    }
  }, [targetLocale]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const syncWindowStore = () => {
      mergeWindowTranslationStoreHydrationPayload(store.dehydrate());
    };

    syncWindowStore();
    return store.subscribe(syncWindowStore);
  }, [store]);

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
      getTargetLocale: () => store.getState().locale.selected,
      getBaseLocale: () => canonicalizeLocale(baseLocale || defaultLocale),
    });
  }, [apiKey, _apiUrl, requestOrigin, requestInitDecorator, store, baseLocale, defaultLocale]);

  useEffect(() => {
    if (!locale) {
      return;
    }

    startTransition(() => {
      engine.setLocale(locale);
    });
  }, [engine, locale]);

  return (
    <WaysRootContext.Provider
      value={{
        engine,
        setLocale: engine.setLocale,
        targetLocale,
        defaultLocale,
        baseLocale,
        apiUrl: _apiUrl,
        cacheTtl,
        fetcher,
        requestOrigin,
        requestInitDecorator,
        persistLocaleCookie,
        acceptedLocales: acceptedLocalesFromStore,
        translationFallbackConfig: translationFallbackConfigFromStore,
        messageFormatter,
        suspenseTimeoutMs,
        store,
      }}
    >
      {children}
      <InjectTranslations store={store} suspenseTimeoutMs={suspenseTimeoutMs} />
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
  const rootContext = useContext(WaysRootContext);
  const { store, messageFormatter } = rootContext;
  const contextState = store.getState();
  const targetLocale = pTargetLocale || contextState.locale.selected;
  const baseLocale = pBaseLocale || rootContext.baseLocale;

  useEffect(() => {
    if (!baseLocale && typeof console !== 'undefined' && console.warn) {
      console.warn(
        '[18ways] Missing baseLocale in WaysProvider. This may result in unnecessary translation charges. ' +
          'Set baseLocale to your source language to avoid charges for same-language lookups.'
      );
    }
  }, [baseLocale]);

  useEffect(() => {
    if (!isTestEnvironment()) {
      return;
    }

    const clearQueue = async () => {
      await store.waitForIdle();
    };

    return registerQueueClearFn(clearQueue);
  }, [store]);

  return (
    <>
      <Context.Provider
        value={{
          store,
          contextKey,
          contextMetadata,
          baseLocale,
          targetLocale,
          components,
          messageFormatter,
        }}
      >
        {children}
      </Context.Provider>
    </>
  );
};

export const Ways: React.FC<WaysProps> = (props) => {
  const parentRootContext = useContext(WaysRootContext);
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
      suspenseTimeoutMs,
      requestOrigin,
      acceptedLocales,
      context,
    } = props;
    const resolvedApiUrl = _apiUrl ?? parentRootContext.apiUrl;
    const resolvedCacheTtl = cacheTtl ?? parentRootContext.cacheTtl;
    const resolvedFetcher = fetcher ?? parentRootContext.fetcher;
    const resolvedRequestOrigin =
      requestOrigin ||
      parentRootContext.requestOrigin ||
      (typeof window !== 'undefined' ? window.location.origin : undefined);
    const resolvedRequestInitDecorator =
      _requestInitDecorator ?? parentRootContext.requestInitDecorator;

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
        apiUrl: resolvedApiUrl,
        fetcher: resolvedFetcher,
        cacheTtlSeconds: resolvedCacheTtl,
        origin: resolvedRequestOrigin,
        _requestInitDecorator: resolvedRequestInitDecorator,
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
            cacheTtl={resolvedCacheTtl}
            fetcher={resolvedFetcher}
            _apiUrl={resolvedApiUrl}
            requestOrigin={resolvedRequestOrigin}
            requestInitDecorator={resolvedRequestInitDecorator}
            acceptedLocales={acceptedLocales}
            messageFormatter={messageFormatter}
            suspenseTimeoutMs={suspenseTimeoutMs}
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
const EMPTY_TRANSLATION_STORE_STATE: TranslationStoreState = {
  version: 0,
  baseLocale: 'en-GB',
  translations: {},
  locale: {
    selected: 'en-GB',
    settled: null,
  },
  config: {
    status: 'empty',
    acceptedLocales: [],
    translationFallback: DEFAULT_TRANSLATION_FALLBACK_CONFIG,
  },
};
const getEmptyTranslationStoreState = () => EMPTY_TRANSLATION_STORE_STATE;
let translationMountHookIdCounter = 0;

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
  const translationMountHookIdRef = useRef<string>();
  const mountedEntriesRef = useRef<Map<string, TranslationStoreMountEntry>>(new Map());
  const renderedEntriesRef = useRef<Map<string, TranslationStoreMountEntry>>(new Map());
  const renderEntryCountsRef = useRef<Map<string, number>>(new Map());
  useSyncExternalStore(
    context?.store ? context.store.subscribe : noopSubscribe,
    context?.store ? context.store.getState : getEmptyTranslationStoreState,
    context?.store ? context.store.getState : getEmptyTranslationStoreState
  );
  useSyncExternalStore(
    subscribeDomSnapshotOverrideVersion,
    getDomSnapshotOverrideVersion,
    getDomSnapshotOverrideVersion
  );

  if (!translationMountHookIdRef.current) {
    translationMountHookIdCounter += 1;
    translationMountHookIdRef.current = `ways:t:${translationMountHookIdCounter}`;
  }

  renderedEntriesRef.current = new Map();
  renderEntryCountsRef.current = new Map();

  // Reconcile the store-owned mount registry against the entries rendered in
  // this commit. This must run after every commit, not only once on mount.
  useEffect(() => {
    if (!context?.store) {
      return;
    }

    const mountedEntries = mountedEntriesRef.current;
    const renderedEntries = renderedEntriesRef.current;

    renderedEntries.forEach((entry, instanceId) => {
      if (mountedEntries.has(instanceId)) {
        return;
      }

      context.store.mount(entry);
      mountedEntries.set(instanceId, entry);
    });

    Array.from(mountedEntries.keys()).forEach((instanceId) => {
      if (renderedEntries.has(instanceId)) {
        return;
      }

      context.store.unmount({ instanceId });
      mountedEntries.delete(instanceId);
    });
  });

  useEffect(() => {
    const mountedEntries = mountedEntriesRef.current;

    return () => {
      if (!context?.store) {
        return;
      }

      mountedEntries.forEach((_, instanceId) => {
        context.store.unmount({ instanceId });
      });
      mountedEntries.clear();
    };
  }, [context?.store]);

  const t = useCallback<TFunction>(
    ((
      children: ReactNode | string,
      { vars, components: tComponents, context: localContext }: TOptions = {}
    ): string | ReactNode => {
      const {
        contextKey,
        contextMetadata,
        baseLocale: cBaseLocale,
        targetLocale: cTargetLocale,
        components: cComponents,
        messageFormatter,
        store,
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
      let shouldRecordDomSnapshot = true;

      const translatedText = (() => {
        if (
          extractedMessage.kind === 'plain' &&
          resolvedMessageFormatter === 'waysParser' &&
          isRuntimeOnlyWaysMessage(sourceText)
        ) {
          return sourceText;
        }

        if (!store || !contextKey) {
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

        const entrySignature = JSON.stringify([
          effectiveContextKey,
          textHash,
          contextFingerprint,
          sourceText,
        ]);
        const entryCount = (renderEntryCountsRef.current.get(entrySignature) || 0) + 1;
        renderEntryCountsRef.current.set(entrySignature, entryCount);

        const instanceId = `${translationMountHookIdRef.current}:${entrySignature}:${entryCount}`;
        renderedEntriesRef.current.set(instanceId, {
          instanceId,
          contextKey: effectiveContextKey,
          textHash,
          text: sourceText,
          contextFingerprint,
          contextMetadata: finalContextMetadata,
        });
        const runtimeRead = store.getTranslationSync({
          contextKey: effectiveContextKey,
          textHash,
          text: sourceText,
          baseLocale,
          targetLocale,
          contextFingerprint,
          contextMetadata: finalContextMetadata,
        });

        if (runtimeRead.status === 'pending') {
          const localeState = store.getState().locale;
          const shouldRenderTransitionFallback =
            targetLocale === localeState.selected &&
            Boolean(localeState.settled) &&
            localeState.settled !== localeState.selected;

          if (!suspend) {
            shouldRecordDomSnapshot = false;
            return runtimeRead.fallbackValue;
          }

          if (shouldRenderTransitionFallback) {
            shouldRecordDomSnapshot = false;
            return runtimeRead.fallbackValue;
          }

          const idleState = store.getIdleState({
            timeoutMs: rootContext.suspenseTimeoutMs,
          });
          if (!idleState.promise || idleState.timedOut) {
            shouldRecordDomSnapshot = false;
            return runtimeRead.fallbackValue;
          }

          throw idleState.promise;
        }

        return runtimeRead.value;
      })();

      if (domSnapshotIdentity && shouldRecordDomSnapshot) {
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
    [context, rootContext, suspend, tBaseLocale, tTargetLocale]
  );

  return t;
};

export const useTranslatedMemo = <T,>(
  factory: UseTranslatedMemoFactory<T>,
  deps: DependencyList,
  options: UseTParams = {}
): T => {
  const t = useT(options);
  const memoInputsRef = useRef<Array<unknown> | null>(null);
  const memoValueRef = useRef<T | null>(null);
  const nextInputs = [factory, t, ...deps];
  const shouldReuseMemo =
    memoInputsRef.current &&
    memoInputsRef.current.length === nextInputs.length &&
    memoInputsRef.current.every((value, index) => Object.is(value, nextInputs[index]));

  if (!shouldReuseMemo) {
    memoInputsRef.current = nextInputs;
    memoValueRef.current = factory(t);
  }

  return memoValueRef.current as T;
};

export const useTranslationLoading = (): boolean => {
  const context = useContext(Context);
  useSyncExternalStore(
    context?.store ? context.store.subscribe : noopSubscribe,
    context?.store ? context.store.getState : getEmptyTranslationStoreState,
    context?.store ? context.store.getState : getEmptyTranslationStoreState
  );

  if (!context?.store || !context.contextKey) {
    return false;
  }

  return context.store.isLoading({ contextKey: context.contextKey });
};

export const useCurrentLocale = (): string => {
  const rootContext = useContext(WaysRootContext);
  return rootContext.store.getState().locale.selected || rootContext.defaultLocale || 'en-GB';
};

export const useBaseLocale = (): string => {
  const rootContext = useContext(WaysRootContext);
  return rootContext.baseLocale || rootContext.defaultLocale || 'en-GB';
};

export const useTargetLocale = (): string => {
  const context = useContext(Context);
  const rootContext = useContext(WaysRootContext);

  if (context?.targetLocale) {
    return context.targetLocale;
  }

  return rootContext.store.getState().locale.selected || rootContext.defaultLocale || 'en-GB';
};

export const useSetCurrentLocale = (): ((nextLocale: string) => void) => {
  const rootContext = useContext(WaysRootContext);
  return useCallback(
    (nextLocale: string) => {
      if (!nextLocale) {
        return;
      }

      startTransition(() => {
        rootContext.setLocale(nextLocale);
      });
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
  useSyncExternalStore(
    rootContext.store !== emptyStore ? rootContext.store.subscribe : noopSubscribe,
    rootContext.store !== emptyStore ? rootContext.store.getState : getEmptyTranslationStoreState,
    rootContext.store !== emptyStore ? rootContext.store.getState : getEmptyTranslationStoreState
  );
  const rootStoreState = rootContext.store.getState();
  const currentLocale =
    props.currentLocale || rootStoreState.locale.selected || rootContext.defaultLocale || 'en-GB';
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
  const hasPendingControlledLocaleSync = Boolean(
    props.currentLocale &&
      rootStoreState.locale.selected &&
      canonicalizeLocale(props.currentLocale).toLowerCase() !==
        canonicalizeLocale(rootStoreState.locale.selected).toLowerCase()
  );
  const hasPendingLocaleTransition =
    Boolean(rootStoreState.locale.settled) &&
    rootStoreState.locale.settled !== rootStoreState.locale.selected;
  const isTranslationLoading =
    hasPendingControlledLocaleSync || hasPendingLocaleTransition || rootContext.store.isLoading();

  return (
    <InternalLanguageSwitcher
      {...props}
      persistLocaleCookie={rootContext.persistLocaleCookie}
      rootLocale={rootStoreState.locale.selected}
      hasRootStore={rootContext.store !== emptyStore}
      isTranslationLoading={isTranslationLoading}
      onRootLocaleChange={rootContext.setLocale}
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
