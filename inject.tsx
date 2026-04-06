import type {} from './global';
import React from 'react';
import type { TranslationStoreHydrationPayload } from '@18ways/core/common';
import type { TranslationStore } from '@18ways/core/translation-store';

interface InjectTranslationsProps {
  store: Pick<TranslationStore, 'dehydrate' | 'getIdleState'>;
  suspenseTimeoutMs: number;
}

const renderTranslationsScript = (
  storeHydration: Required<TranslationStoreHydrationPayload>,
  scriptId: string
) => (
  <script
    id={scriptId}
    suppressHydrationWarning
    dangerouslySetInnerHTML={{
      __html: `(() => {
  const next = ${JSON.stringify(storeHydration)};
  const target = window.__18WAYS_TRANSLATION_STORE__ || {
    translations: {},
    config: {
      acceptedLocales: [],
      translationFallback: { default: 'source', overrides: [] },
    },
  };
  const targetTranslations = target.translations || {};
  const nextTranslations = next.translations || {};
  for (const locale of Object.keys(nextTranslations || {})) {
    const nextLocale = nextTranslations[locale] || {};
    const targetLocale = targetTranslations[locale] || {};
    for (const contextKey of Object.keys(nextLocale || {})) {
      const nextContext = nextLocale[contextKey] || {};
      const targetContext = targetLocale[contextKey] || {};
      targetLocale[contextKey] = { ...targetContext, ...nextContext };
    }
    targetTranslations[locale] = targetLocale;
  }

  const nextConfig = next.config || {};
  const targetConfig = target.config || {
    acceptedLocales: [],
    translationFallback: { default: 'source', overrides: [] },
  };
  const acceptedLocales = Array.isArray(nextConfig.acceptedLocales)
    ? Array.from(new Set((nextConfig.acceptedLocales || []).filter(Boolean)))
    : targetConfig.acceptedLocales || [];
  const existingFallback = targetConfig.translationFallback || {
    default: 'source',
    overrides: [],
  };
  const translationFallback = nextConfig.translationFallback || existingFallback;

  window.__18WAYS_TRANSLATION_STORE__ = {
    translations: targetTranslations,
    config: {
      acceptedLocales,
      translationFallback,
    },
  };
})();`,
    }}
  />
);

export const InjectTranslations = ({ store, suspenseTimeoutMs }: InjectTranslationsProps) => {
  const scriptId = React.useId();
  const storeHydration = store.dehydrate();

  if (typeof window !== 'undefined') {
    return document.getElementById(scriptId)
      ? renderTranslationsScript(storeHydration, scriptId)
      : null;
  }

  const idleState = store.getIdleState({ timeoutMs: suspenseTimeoutMs });
  if (!idleState.promise || idleState.timedOut) {
    return renderTranslationsScript(storeHydration, scriptId);
  }

  throw idleState.promise;
};
