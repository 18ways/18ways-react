import React from 'react';
import type { Translations, TranslationFallbackConfig } from '@18ways/core/common';
import type { TranslationStore } from '@18ways/core/translation-store';

interface InjectTranslationsProps {
  translations: Translations;
  acceptedLocales: string[];
  translationFallbackConfig: TranslationFallbackConfig;
  store: TranslationStore;
  idlePromiseRef: React.MutableRefObject<Promise<void> | null>;
  hasPendingSeedWork: () => boolean;
  waitForPendingSeedWork: () => Promise<void>;
}

const renderTranslationsScript = (
  translations: Translations,
  acceptedLocales: string[],
  translationFallbackConfig: TranslationFallbackConfig
) => (
  <script
    dangerouslySetInnerHTML={{
      __html: `(() => {
  const next = ${JSON.stringify(translations)};
  const target = window.__18WAYS_IN_MEMORY_TRANSLATIONS__ || {};
  for (const locale of Object.keys(next || {})) {
    const nextLocale = next[locale] || {};
    const targetLocale = target[locale] || {};
    target[locale] = { ...targetLocale, ...nextLocale };
  }
  window.__18WAYS_IN_MEMORY_TRANSLATIONS__ = target;
  window.__18WAYS_ACCEPTED_LOCALES__ = ${JSON.stringify(acceptedLocales)};
  window.__18WAYS_TRANSLATION_FALLBACK_CONFIG__ = ${JSON.stringify(translationFallbackConfig)};
})();`,
    }}
  />
);

export const InjectTranslations = ({
  translations,
  acceptedLocales,
  translationFallbackConfig,
  store,
  idlePromiseRef,
  hasPendingSeedWork,
  waitForPendingSeedWork,
}: InjectTranslationsProps) => {
  if (typeof window !== 'undefined') {
    return null;
  }

  const hasPendingStoreWork = store.hasPendingRequests() || store.hasInFlightRequests();
  const pendingSeedWork = hasPendingSeedWork();
  if (!hasPendingStoreWork && !pendingSeedWork) {
    return renderTranslationsScript(translations, acceptedLocales, translationFallbackConfig);
  }

  if (!idlePromiseRef.current) {
    idlePromiseRef.current = Promise.resolve()
      .then(async () => {
        await store.waitForBlockingIdle();
        await waitForPendingSeedWork();
      })
      .finally(() => {
        idlePromiseRef.current = null;
      });
  }

  throw idlePromiseRef.current;
};
