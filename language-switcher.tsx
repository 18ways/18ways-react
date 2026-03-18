'use client';

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { getDemoLanguageInfo, type Language } from '@18ways/core/common';
import { readCookieFromDocument, writeCookieToDocument } from '@18ways/core/cookie-utils';
import { canonicalizeLocale, WAYS_LOCALE_COOKIE_NAME } from '@18ways/core/i18n-shared';
import { internalT } from '@18ways/core/internal-i18n';
import { rankSupportedLocalesByPreference } from '@18ways/core/locale-drivers';
import { formatDisplayName } from '@18ways/core/parsers/intl-runtime';
import {
  languageSwitcherStyles,
  type LanguageSwitcherStyleKey,
  type LanguageSwitcherStyleOverrides,
} from './language-switcher-styles';

export type { LanguageSwitcherStyleOverrides } from './language-switcher-styles';
export type LanguageSwitcherClassNameOverrides = Partial<Record<LanguageSwitcherStyleKey, string>>;

const joinClassNames = (
  ...values: Array<string | false | null | undefined>
): string | undefined => {
  const joined = values.filter(Boolean).join(' ');
  return joined || undefined;
};

const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
// Wait long enough for locale change re-renders to enqueue translation work
// before deciding there was no loading phase to observe.
const CHANGE_SETTLE_TIMEOUT_MS = 1000;
const CHANGE_HARD_TIMEOUT_MS = 10000;
const ENHANCED_SWITCHER_MIN_LANGUAGE_COUNT = 5;
const SEARCH_TOKEN_SEPARATOR = /[\s/(),._-]+/;

export interface LanguageSwitcherProps {
  className?: string;
  style?: React.CSSProperties;
  styles?: LanguageSwitcherStyleOverrides;
  classNames?: LanguageSwitcherClassNameOverrides;
  unstyled?: boolean;
  direction?: 'up' | 'down';
  currentLocale?: string;
  preferredLocales?: string[];
  onLocaleChange?: (_locale: string) => void;
}

export interface InternalLanguageSwitcherProps extends LanguageSwitcherProps {
  persistLocaleCookie: boolean;
  rootLocale: string;
  hasRootStore: boolean;
  isTranslationLoading: boolean;
  onRootLocaleChange: (locale: string) => void;
  languages: Language[];
}

const getLocaleFromCookie = (): string | null => {
  return readCookieFromDocument(WAYS_LOCALE_COOKIE_NAME);
};

const setLocaleCookie = (locale: string): void => {
  writeCookieToDocument(WAYS_LOCALE_COOKIE_NAME, locale, {
    maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
    sameSite: 'lax',
    path: '/',
  });
};

const getIntlLocale = (locale: string): Intl.Locale | null => {
  try {
    return new Intl.Locale(canonicalizeLocale(locale));
  } catch {
    return null;
  }
};

const getLanguageSubtag = (locale: string): string => {
  const intlLocale = getIntlLocale(locale);
  if (intlLocale?.language) {
    return intlLocale.language;
  }
  return locale.split('-')[0];
};

const getLocaleRegionSubtag = (locale: string): string | null => {
  const intlLocale = getIntlLocale(locale);
  if (intlLocale?.region) {
    return intlLocale.region.toUpperCase();
  }
  return null;
};

const getLocalizedDisplayName = (
  displayLocale: string,
  value: string,
  type: Intl.DisplayNamesType
): string | null => {
  const localized = formatDisplayName(displayLocale, value, type);
  if (localized) {
    return localized;
  }

  const fallbackLocale = getLanguageSubtag(displayLocale);
  if (fallbackLocale === displayLocale) {
    return null;
  }

  return formatDisplayName(fallbackLocale, value, type);
};

const getLanguageLabel = (
  languageCode: string,
  displayLocale: string,
  fallback: string
): string => {
  const fullTag = getLocalizedDisplayName(displayLocale, languageCode, 'language');
  if (fullTag) {
    return fullTag;
  }

  const subtagLabel = getLocalizedDisplayName(
    displayLocale,
    getLanguageSubtag(languageCode),
    'language'
  );
  return subtagLabel || fallback;
};

const getBaseLanguageLabel = (
  localeCode: string,
  displayLocale: string,
  fallback: string
): string => {
  const baseLanguageCode = getLanguageSubtag(localeCode);
  return getLanguageLabel(baseLanguageCode, displayLocale, fallback);
};

const getLocaleRegionLabel = (localeCode: string, displayLocale: string): string | null => {
  const regionSubtag = getLocaleRegionSubtag(localeCode);
  if (!regionSubtag) {
    return null;
  }

  return getLocalizedDisplayName(displayLocale, regionSubtag, 'region') || regionSubtag;
};

const getFullLanguageLabel = (
  localeCode: string,
  displayLocale: string,
  fallback: string
): string => {
  const fullLocaleLabel = getLocalizedDisplayName(displayLocale, localeCode, 'language');
  if (fullLocaleLabel) {
    return fullLocaleLabel;
  }

  const languageLabel = getBaseLanguageLabel(localeCode, displayLocale, fallback);
  const regionLabel = getLocaleRegionLabel(localeCode, displayLocale);

  if (!regionLabel) {
    return languageLabel;
  }

  return `${languageLabel} (${regionLabel})`;
};

const getCompactLanguageLabel = (
  localeCode: string,
  displayLocale: string,
  fallback: string
): string => {
  const languageLabel = getBaseLanguageLabel(localeCode, displayLocale, fallback);
  const regionSubtag = getLocaleRegionSubtag(localeCode);

  if (!regionSubtag) {
    return languageLabel;
  }

  return `${languageLabel} (${regionSubtag})`;
};

const getPreferredFullLanguageLabel = (
  localeCode: string,
  displayLocale: string,
  fallback: string
): string => {
  if (getDemoLanguageInfo(localeCode)) {
    return fallback;
  }

  return getFullLanguageLabel(localeCode, displayLocale, fallback);
};

const getPreferredLanguageLabel = (
  localeCode: string,
  displayLocale: string,
  fallback: string
): string => {
  if (getDemoLanguageInfo(localeCode)) {
    return fallback;
  }

  return getBaseLanguageLabel(localeCode, displayLocale, fallback);
};

const getPreferredCompactLanguageLabel = (
  localeCode: string,
  displayLocale: string,
  fallback: string
): string => {
  if (getDemoLanguageInfo(localeCode)) {
    return fallback;
  }

  return getCompactLanguageLabel(localeCode, displayLocale, fallback);
};

const optionIdFor = (listboxId: string, locale: string): string =>
  `${listboxId}-option-${locale.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

const areSameLocale = (left: string, right: string): boolean =>
  canonicalizeLocale(left).toLowerCase() === canonicalizeLocale(right).toLowerCase();

const normalizeForSearch = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const isPrintableSearchKey = (event: React.KeyboardEvent<HTMLElement>): boolean =>
  event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey;

const readPreferredLocalesFromBrowser = (): string[] => {
  if (typeof navigator === 'undefined') {
    return [];
  }

  return rankSupportedLocalesByPreference(
    [...(navigator.languages || []), navigator.language].filter(Boolean)
  );
};

const getSearchValuesForLanguage = (lang: Language, currentLocale: string): string[] => {
  const fallback = lang.nativeName || lang.name || lang.code;

  return [
    lang.code,
    lang.name,
    lang.nativeName || '',
    getPreferredLanguageLabel(lang.code, currentLocale, fallback),
    getPreferredFullLanguageLabel(lang.code, currentLocale, fallback),
    getPreferredCompactLanguageLabel(lang.code, currentLocale, fallback),
    getPreferredLanguageLabel(lang.code, lang.code, fallback),
    getPreferredFullLanguageLabel(lang.code, lang.code, fallback),
    getPreferredCompactLanguageLabel(lang.code, lang.code, fallback),
    getLocaleRegionLabel(lang.code, currentLocale) || '',
    getLocaleRegionLabel(lang.code, lang.code) || '',
  ].filter(Boolean);
};

const getSubsequenceScore = (query: string, candidate: string): number => {
  let queryIndex = 0;
  let firstMatchIndex = -1;

  for (let index = 0; index < candidate.length; index += 1) {
    if (candidate[index] !== query[queryIndex]) {
      continue;
    }

    if (firstMatchIndex < 0) {
      firstMatchIndex = index;
    }

    queryIndex += 1;
    if (queryIndex === query.length) {
      return 420 - (index - firstMatchIndex) - firstMatchIndex;
    }
  }

  return -1;
};

const getFuzzySearchScore = (query: string, candidates: string[]): number => {
  let bestScore = -1;

  for (const rawCandidate of candidates) {
    const candidate = normalizeForSearch(rawCandidate);
    if (!candidate) {
      continue;
    }

    if (candidate === query) {
      bestScore = Math.max(bestScore, 1000 - candidate.length);
    }

    if (candidate.startsWith(query)) {
      bestScore = Math.max(bestScore, 920 - candidate.length);
    }

    const tokenPrefixMatch = candidate
      .split(SEARCH_TOKEN_SEPARATOR)
      .some((token) => token.startsWith(query));
    if (tokenPrefixMatch) {
      bestScore = Math.max(bestScore, 860 - candidate.length);
    }

    const substringIndex = candidate.indexOf(query);
    if (substringIndex >= 0) {
      bestScore = Math.max(bestScore, 760 - substringIndex);
    }

    const subsequenceScore = getSubsequenceScore(query, candidate);
    if (subsequenceScore >= 0) {
      bestScore = Math.max(bestScore, subsequenceScore);
    }
  }

  return bestScore;
};

const sortLanguagesAlphabetically = (languages: Language[], currentLocale: string): Language[] => {
  const collator = new Intl.Collator([currentLocale, 'en'], { sensitivity: 'base' });

  return [...languages].sort((left, right) => {
    const leftFallback = left.nativeName || left.name || left.code;
    const rightFallback = right.nativeName || right.name || right.code;
    const labelComparison = collator.compare(
      getPreferredFullLanguageLabel(left.code, currentLocale, leftFallback),
      getPreferredFullLanguageLabel(right.code, currentLocale, rightFallback)
    );

    if (labelComparison !== 0) {
      return labelComparison;
    }

    return collator.compare(left.code, right.code);
  });
};

const buildSuggestedLanguages = (
  languages: Language[],
  currentLocale: string,
  preferredLocales: string[]
): Language[] => {
  const rankedLocaleCodes = rankSupportedLocalesByPreference(
    [currentLocale, ...preferredLocales],
    languages.map((lang) => lang.code)
  );
  const languageByCode = new Map(
    languages.map((lang) => [canonicalizeLocale(lang.code).toLowerCase(), lang] as const)
  );

  return rankedLocaleCodes.flatMap((localeCode) => {
    const lang = languageByCode.get(localeCode.toLowerCase());
    return lang ? [lang] : [];
  });
};

type LanguageSection = {
  key: string;
  label: string | null;
  options: Language[];
};

type IndexedLanguageOption = {
  lang: Language;
  index: number;
};

type IndexedLanguageSection = {
  key: string;
  label: string | null;
  options: IndexedLanguageOption[];
};

const indexLanguageSections = (sections: LanguageSection[]): IndexedLanguageSection[] => {
  let nextIndex = 0;

  return sections.map((section) => ({
    ...section,
    options: section.options.map((lang) => ({
      lang,
      index: nextIndex++,
    })),
  }));
};

type LanguageOptionProps = {
  currentLocale: string;
  index: number;
  isActive: boolean;
  isHovered: boolean;
  isSelected: boolean;
  lang: Language;
  onHover: (locale: string, nextIndex: number) => void;
  onLeave: () => void;
  onSelect: (locale: string) => void;
  optionId: string;
  styles?: LanguageSwitcherStyleOverrides;
  classNames?: LanguageSwitcherClassNameOverrides;
  unstyled?: boolean;
};

const mergeStyle = (
  key: LanguageSwitcherStyleKey,
  styles: LanguageSwitcherStyleOverrides | undefined,
  unstyled: boolean | undefined,
  ...conditionalOverrides: Array<React.CSSProperties | null | undefined>
): React.CSSProperties | undefined => {
  if (unstyled) {
    const custom = styles?.[key];
    return custom
      ? { ...custom, ...Object.assign({}, ...conditionalOverrides.filter(Boolean)) }
      : undefined;
  }

  return {
    ...languageSwitcherStyles[key],
    ...styles?.[key],
    ...Object.assign({}, ...conditionalOverrides.filter(Boolean)),
  };
};

const LanguageOption: React.FC<LanguageOptionProps> = ({
  currentLocale,
  index,
  isActive,
  isHovered,
  isSelected,
  lang,
  onHover,
  onLeave,
  onSelect,
  optionId,
  styles,
  classNames,
  unstyled,
}) => {
  const localizedName = getPreferredFullLanguageLabel(
    lang.code,
    currentLocale,
    lang.name || lang.code
  );
  const nativeName = getPreferredCompactLanguageLabel(
    lang.code,
    lang.code,
    lang.nativeName || lang.name || lang.code
  );
  const showSubtitle = localizedName.trim().toLowerCase() !== nativeName.trim().toLowerCase();

  return (
    <button
      key={lang.code}
      id={optionId}
      type="button"
      onClick={() => onSelect(lang.code)}
      onMouseEnter={() => onHover(lang.code, index)}
      onMouseLeave={onLeave}
      className={joinClassNames(
        classNames?.menuItem,
        (isHovered || isActive) && !isSelected ? classNames?.menuItemHover : undefined,
        isSelected ? classNames?.menuItemSelected : undefined
      )}
      style={mergeStyle(
        'menuItem',
        styles,
        unstyled,
        isHovered && !isSelected ? mergeStyle('menuItemHover', styles, unstyled) : null,
        isActive && !isSelected ? mergeStyle('menuItemHover', styles, unstyled) : null,
        isSelected ? mergeStyle('menuItemSelected', styles, unstyled) : null
      )}
      role="option"
      aria-selected={isSelected}
    >
      {lang.flag && (
        <span className={classNames?.flag} style={mergeStyle('flag', styles, unstyled)}>
          {lang.flag}
        </span>
      )}
      <div
        className={classNames?.menuItemTextWrap}
        style={mergeStyle('menuItemTextWrap', styles, unstyled)}
      >
        <div
          className={classNames?.menuItemName}
          style={mergeStyle('menuItemName', styles, unstyled)}
        >
          {localizedName}
        </div>
        {showSubtitle && (
          <div
            className={classNames?.menuItemNativeName}
            style={mergeStyle('menuItemNativeName', styles, unstyled)}
          >
            {nativeName}
          </div>
        )}
      </div>
      {isSelected && (
        <CheckIcon className={classNames?.check} style={mergeStyle('check', styles, unstyled)} />
      )}
    </button>
  );
};

const ChevronIcon: React.FC<{
  isOpen: boolean;
  className?: string;
  style?: React.CSSProperties;
}> = ({ isOpen, className, style }) => (
  <svg
    className={className}
    style={{
      ...style,
      transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
    }}
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 20 20"
    fill="currentColor"
  >
    <path
      fillRule="evenodd"
      d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
      clipRule="evenodd"
    />
  </svg>
);

const SpinnerIcon: React.FC<{ className?: string; style?: React.CSSProperties }> = ({
  className,
  style,
}) => (
  <svg
    className={className}
    style={style}
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
  >
    <g>
      <animateTransform
        attributeName="transform"
        type="rotate"
        from="0 12 12"
        to="360 12 12"
        dur="1s"
        repeatCount="indefinite"
      />
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path
        fill="currentColor"
        fillOpacity="0.75"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </g>
  </svg>
);

const CheckIcon: React.FC<{ className?: string; style?: React.CSSProperties }> = ({
  className,
  style,
}) => (
  <svg
    className={className}
    style={style}
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 20 20"
    fill="currentColor"
  >
    <path
      fillRule="evenodd"
      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
      clipRule="evenodd"
    />
  </svg>
);

export const InternalLanguageSwitcher: React.FC<InternalLanguageSwitcherProps> = ({
  className,
  style,
  styles,
  classNames,
  unstyled,
  direction = 'up',
  currentLocale: controlledLocale,
  preferredLocales,
  onLocaleChange,
  persistLocaleCookie,
  rootLocale,
  hasRootStore,
  isTranslationLoading,
  onRootLocaleChange,
  languages,
}) => {
  const listboxId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [isChanging, setIsChanging] = useState(false);
  const [isTriggerHovered, setIsTriggerHovered] = useState(false);
  const [hoveredOptionCode, setHoveredOptionCode] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [uncontrolledLocale, setUncontrolledLocale] = useState('en-GB');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const observedTranslationLoadingRef = useRef(false);

  const currentLocale = controlledLocale ?? rootLocale ?? uncontrolledLocale;
  const searchEnabled = languages.length >= ENHANCED_SWITCHER_MIN_LANGUAGE_COUNT;
  const resolvedPreferredLocales = useMemo(
    () =>
      Array.isArray(preferredLocales)
        ? rankSupportedLocalesByPreference(preferredLocales)
        : readPreferredLocalesFromBrowser(),
    [preferredLocales]
  );
  const sortedLanguages = useMemo(
    () => sortLanguagesAlphabetically(languages, currentLocale),
    [currentLocale, languages]
  );
  const suggestedLanguages = useMemo(
    () =>
      searchEnabled
        ? buildSuggestedLanguages(languages, currentLocale, resolvedPreferredLocales)
        : [],
    [currentLocale, languages, resolvedPreferredLocales, searchEnabled]
  );
  const allLanguages = useMemo(
    () =>
      suggestedLanguages.length > 0
        ? sortedLanguages.filter((lang) => !areSameLocale(lang.code, currentLocale))
        : sortedLanguages,
    [currentLocale, sortedLanguages, suggestedLanguages.length]
  );
  const languageSections = useMemo<LanguageSection[]>(() => {
    const trimmedQuery = searchQuery.trim();
    if (trimmedQuery) {
      const normalizedQuery = normalizeForSearch(trimmedQuery);
      const collator = new Intl.Collator([currentLocale, 'en'], { sensitivity: 'base' });

      const matchingLanguages = languages
        .map((lang) => ({
          lang,
          score: getFuzzySearchScore(
            normalizedQuery,
            getSearchValuesForLanguage(lang, currentLocale)
          ),
        }))
        .filter((entry) => entry.score >= 0)
        .sort((left, right) => {
          if (left.score !== right.score) {
            return right.score - left.score;
          }

          const leftFallback = left.lang.nativeName || left.lang.name || left.lang.code;
          const rightFallback = right.lang.nativeName || right.lang.name || right.lang.code;
          const labelComparison = collator.compare(
            getPreferredFullLanguageLabel(left.lang.code, currentLocale, leftFallback),
            getPreferredFullLanguageLabel(right.lang.code, currentLocale, rightFallback)
          );

          if (labelComparison !== 0) {
            return labelComparison;
          }

          return collator.compare(left.lang.code, right.lang.code);
        })
        .map((entry) => entry.lang);

      return [
        {
          key: 'search-results',
          label: null,
          options: matchingLanguages,
        },
      ];
    }

    if (!searchEnabled) {
      return [
        {
          key: 'all',
          label: null,
          options: sortedLanguages,
        },
      ];
    }

    const sections: LanguageSection[] = [];
    if (suggestedLanguages.length > 0) {
      sections.push({
        key: 'suggested',
        label: internalT(currentLocale, 'suggestedLanguages'),
        options: suggestedLanguages,
      });
    }

    sections.push({
      key: 'all',
      label: suggestedLanguages.length > 0 ? internalT(currentLocale, 'allLanguages') : null,
      options: allLanguages,
    });

    return sections.filter((section) => section.options.length > 0);
  }, [
    allLanguages,
    currentLocale,
    languages,
    searchEnabled,
    searchQuery,
    sortedLanguages,
    suggestedLanguages,
  ]);
  const indexedLanguageSections = useMemo(
    () => indexLanguageSections(languageSections),
    [languageSections]
  );
  const visibleLanguages = useMemo(
    () =>
      indexedLanguageSections.flatMap((section) => section.options.map((option) => option.lang)),
    [indexedLanguageSections]
  );

  const clearChangeTimers = useCallback(() => {
    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    if (hardStopTimerRef.current) {
      clearTimeout(hardStopTimerRef.current);
      hardStopTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (controlledLocale) {
      return;
    }

    const cookieLocale = getLocaleFromCookie();
    if (cookieLocale) {
      setUncontrolledLocale(cookieLocale);
    }
  }, [controlledLocale]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      return;
    }

    setSearchQuery('');
    setHoveredOptionCode(null);
  }, [isOpen]);

  useEffect(() => {
    if (!isChanging) {
      return;
    }

    if (isTranslationLoading) {
      observedTranslationLoadingRef.current = true;
      return;
    }

    if (!observedTranslationLoadingRef.current) {
      return;
    }

    clearChangeTimers();
    observedTranslationLoadingRef.current = false;
    setIsChanging(false);
  }, [clearChangeTimers, isChanging, isTranslationLoading]);

  useEffect(() => {
    return () => {
      clearChangeTimers();
    };
  }, [clearChangeTimers]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const nextIndex = searchQuery.trim()
      ? 0
      : (() => {
          const selectedIndex = visibleLanguages.findIndex((lang) =>
            areSameLocale(lang.code, currentLocale)
          );
          return selectedIndex >= 0 ? selectedIndex : 0;
        })();
    setActiveIndex(nextIndex);
    requestAnimationFrame(() => {
      if (searchEnabled) {
        searchInputRef.current?.focus();
      } else {
        listboxRef.current?.focus();
      }
    });
  }, [currentLocale, isOpen, searchEnabled, visibleLanguages]);

  useEffect(() => {
    setHoveredOptionCode(null);
    if (searchQuery.trim()) {
      setActiveIndex(0);
    }
  }, [searchQuery]);

  useEffect(() => {
    if (!visibleLanguages.length) {
      setActiveIndex(0);
      return;
    }

    setActiveIndex((previousIndex) =>
      Math.max(0, Math.min(previousIndex, visibleLanguages.length - 1))
    );
  }, [visibleLanguages.length]);

  const applyLocale = useCallback(
    (newLocale: string) => {
      if (onLocaleChange) {
        onLocaleChange(newLocale);
        return;
      }

      if (hasRootStore) {
        onRootLocaleChange(newLocale);
        return;
      }

      setUncontrolledLocale(newLocale);
    },
    [hasRootStore, onLocaleChange, onRootLocaleChange]
  );

  const handleLanguageChange = useCallback(
    (newLocale: string) => {
      if (newLocale === currentLocale) {
        setIsOpen(false);
        return;
      }

      clearChangeTimers();
      observedTranslationLoadingRef.current = false;
      setIsChanging(true);
      setIsOpen(false);
      setIsTriggerHovered(false);
      setSearchQuery('');
      setHoveredOptionCode(null);

      applyLocale(newLocale);
      if (persistLocaleCookie) {
        setLocaleCookie(newLocale);
      }

      settleTimerRef.current = setTimeout(() => {
        if (observedTranslationLoadingRef.current) {
          return;
        }

        clearChangeTimers();
        setIsChanging(false);
      }, CHANGE_SETTLE_TIMEOUT_MS);

      hardStopTimerRef.current = setTimeout(() => {
        clearChangeTimers();
        observedTranslationLoadingRef.current = false;
        setIsChanging(false);
      }, CHANGE_HARD_TIMEOUT_MS);
    },
    [applyLocale, clearChangeTimers, currentLocale, persistLocaleCookie]
  );

  const commitByIndex = useCallback(
    (index: number) => {
      const selectedLanguage = visibleLanguages[index];
      if (!selectedLanguage) {
        return;
      }
      handleLanguageChange(selectedLanguage.code);
    },
    [handleLanguageChange, visibleLanguages]
  );

  const openWithIndex = useCallback(
    (index: number) => {
      if (!visibleLanguages.length) {
        return;
      }
      const boundedIndex = Math.max(0, Math.min(index, visibleLanguages.length - 1));
      setSearchQuery('');
      setActiveIndex(boundedIndex);
      setIsOpen(true);
    },
    [visibleLanguages.length]
  );

  const beginKeyboardSearch = useCallback(
    (character: string) => {
      setSearchQuery((previousQuery) => `${previousQuery}${character}`);
      setActiveIndex(0);

      if (!isOpen) {
        setIsOpen(true);
        return;
      }

      if (searchEnabled) {
        searchInputRef.current?.focus();
        requestAnimationFrame(() => {
          searchInputRef.current?.focus();
        });
      }
    },
    [isOpen, searchEnabled]
  );

  const handleButtonKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (isChanging) {
      return;
    }

    if (isPrintableSearchKey(event)) {
      event.preventDefault();
      beginKeyboardSearch(event.key);
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        openWithIndex(
          Math.max(
            visibleLanguages.findIndex((lang) => areSameLocale(lang.code, currentLocale)),
            0
          )
        );
        break;
      case 'ArrowUp':
        event.preventDefault();
        openWithIndex(visibleLanguages.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (isOpen) {
          setIsOpen(false);
        } else {
          openWithIndex(
            Math.max(
              visibleLanguages.findIndex((lang) => areSameLocale(lang.code, currentLocale)),
              0
            )
          );
        }
        break;
      case 'Escape':
        if (isOpen) {
          event.preventDefault();
          setIsOpen(false);
        }
        break;
      default:
        break;
    }
  };

  const handleListboxKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!visibleLanguages.length) {
      if (isPrintableSearchKey(event)) {
        event.preventDefault();
        beginKeyboardSearch(event.key);
      }
      return;
    }

    if (isPrintableSearchKey(event)) {
      event.preventDefault();
      beginKeyboardSearch(event.key);
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((prev) => (prev + 1) % visibleLanguages.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((prev) => (prev - 1 + visibleLanguages.length) % visibleLanguages.length);
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(visibleLanguages.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        commitByIndex(activeIndex);
        break;
      case 'Escape':
        event.preventDefault();
        setIsOpen(false);
        buttonRef.current?.focus();
        break;
      case 'Tab':
        setIsOpen(false);
        break;
      default:
        break;
    }
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        if (!visibleLanguages.length) {
          return;
        }
        event.preventDefault();
        listboxRef.current?.focus();
        break;
      case 'ArrowUp':
        if (!visibleLanguages.length) {
          return;
        }
        event.preventDefault();
        setActiveIndex(visibleLanguages.length - 1);
        listboxRef.current?.focus();
        break;
      case 'Enter':
        if (!visibleLanguages.length) {
          return;
        }
        event.preventDefault();
        commitByIndex(0);
        break;
      case 'Escape':
        event.preventDefault();
        setIsOpen(false);
        setSearchQuery('');
        setHoveredOptionCode(null);
        buttonRef.current?.focus();
        break;
      default:
        break;
    }
  };

  if (languages.length === 0) {
    return null;
  }

  const currentLanguage = languages.find((lang) => areSameLocale(lang.code, currentLocale)) || {
    code: currentLocale,
    name: currentLocale,
    nativeName: currentLocale,
    flag: '🌐',
  };
  const currentLocaleName = getPreferredCompactLanguageLabel(
    currentLanguage.code,
    currentLanguage.code,
    currentLanguage.nativeName || currentLanguage.name
  );
  const changingLanguageLabel = internalT(currentLocale, 'changingLanguage');
  const searchLabel = internalT(currentLocale, 'searchAvailableLanguages');
  const searchPlaceholder = internalT(currentLocale, 'searchLanguagesPlaceholder');
  const noMatchingLanguagesLabel = internalT(currentLocale, 'noMatchingLanguages');
  const activeOptionId =
    activeIndex >= 0 && activeIndex < visibleLanguages.length
      ? optionIdFor(listboxId, visibleLanguages[activeIndex].code)
      : undefined;
  const menuStyle =
    direction === 'down'
      ? {
          ...mergeStyle('menu', styles, unstyled),
          top: 'calc(100% + 8px)',
          bottom: 'auto',
        }
      : mergeStyle('menu', styles, unstyled);

  return (
    <div className={className} style={{ ...mergeStyle('wrapper', styles, unstyled), ...style }}>
      <div
        className={classNames?.container}
        style={mergeStyle('container', styles, unstyled)}
        ref={dropdownRef}
      >
        <button
          ref={buttonRef}
          type="button"
          onClick={() => !isChanging && setIsOpen(!isOpen)}
          onMouseEnter={() => setIsTriggerHovered(true)}
          onMouseLeave={() => setIsTriggerHovered(false)}
          onKeyDown={handleButtonKeyDown}
          disabled={isChanging}
          className={joinClassNames(
            classNames?.button,
            isTriggerHovered && !isChanging ? classNames?.buttonHover : undefined,
            isChanging ? classNames?.buttonChanging : undefined
          )}
          style={mergeStyle(
            'button',
            styles,
            unstyled,
            isTriggerHovered && !isChanging ? mergeStyle('buttonHover', styles, unstyled) : null,
            isChanging ? mergeStyle('buttonChanging', styles, unstyled) : null
          )}
          aria-label={internalT(currentLocale, 'selectLanguageCurrent', {
            name: currentLocaleName,
          })}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-busy={isChanging}
        >
          <div className={classNames?.content} style={mergeStyle('content', styles, unstyled)}>
            {isChanging ? (
              <>
                <SpinnerIcon
                  className={classNames?.spinnerIcon}
                  style={mergeStyle('spinnerIcon', styles, unstyled)}
                />
                <span
                  className={classNames?.spinnerText}
                  style={mergeStyle('spinnerText', styles, unstyled)}
                >
                  {changingLanguageLabel}
                </span>
              </>
            ) : (
              <>
                {currentLanguage.flag && (
                  <span className={classNames?.flag} style={mergeStyle('flag', styles, unstyled)}>
                    {currentLanguage.flag}
                  </span>
                )}
                <span className={classNames?.label} style={mergeStyle('label', styles, unstyled)}>
                  {currentLocaleName}
                </span>
              </>
            )}
          </div>
          {!isChanging && (
            <ChevronIcon
              isOpen={isOpen}
              className={classNames?.chevron}
              style={mergeStyle('chevron', styles, unstyled)}
            />
          )}
        </button>

        <div
          className={classNames?.srOnly}
          style={mergeStyle('srOnly', styles, unstyled)}
          aria-live="polite"
          aria-atomic="true"
        >
          {isChanging ? changingLanguageLabel : ''}
        </div>

        {isOpen && !isChanging && (
          <div className={classNames?.menu} style={menuStyle}>
            <div className={classNames?.menuCard} style={mergeStyle('menuCard', styles, unstyled)}>
              {searchEnabled && (
                <div
                  className={classNames?.searchWrap}
                  style={mergeStyle('searchWrap', styles, unstyled)}
                >
                  <input
                    ref={searchInputRef}
                    type="search"
                    autoFocus
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    onKeyDown={handleSearchKeyDown}
                    className={classNames?.searchInput}
                    style={mergeStyle('searchInput', styles, unstyled)}
                    role="combobox"
                    aria-label={searchLabel}
                    aria-controls={listboxId}
                    aria-expanded={isOpen}
                    aria-activedescendant={activeOptionId}
                    aria-autocomplete="list"
                    autoComplete="off"
                    placeholder={searchPlaceholder}
                    spellCheck={false}
                  />
                </div>
              )}
              <div
                ref={listboxRef}
                id={listboxId}
                className={classNames?.menuList}
                style={mergeStyle('menuList', styles, unstyled)}
                role="listbox"
                aria-label={internalT(currentLocale, 'availableLanguages')}
                aria-activedescendant={activeOptionId}
                tabIndex={-1}
                onKeyDown={handleListboxKeyDown}
              >
                {indexedLanguageSections.map((section) => (
                  <div
                    key={section.key}
                    role={section.label ? 'group' : undefined}
                    aria-label={section.label || undefined}
                    className={classNames?.section}
                    style={mergeStyle('section', styles, unstyled)}
                  >
                    {section.label ? (
                      <div
                        className={classNames?.sectionHeader}
                        style={mergeStyle('sectionHeader', styles, unstyled)}
                      >
                        {section.label}
                      </div>
                    ) : null}
                    {section.options.map(({ lang, index }) => {
                      const isSelected = lang.code === currentLocale;
                      const isHovered = hoveredOptionCode === lang.code;
                      const isActive = index === activeIndex;

                      return (
                        <LanguageOption
                          key={lang.code}
                          currentLocale={currentLocale}
                          index={index}
                          isActive={isActive}
                          isHovered={isHovered}
                          isSelected={isSelected}
                          lang={lang}
                          onHover={(locale, nextIndex) => {
                            setHoveredOptionCode(locale);
                            setActiveIndex(nextIndex);
                          }}
                          onLeave={() => setHoveredOptionCode(null)}
                          onSelect={handleLanguageChange}
                          optionId={optionIdFor(listboxId, lang.code)}
                          styles={styles}
                          classNames={classNames}
                          unstyled={unstyled}
                        />
                      );
                    })}
                  </div>
                ))}
                {visibleLanguages.length === 0 && (
                  <div
                    className={classNames?.emptyState}
                    style={mergeStyle('emptyState', styles, unstyled)}
                  >
                    {noMatchingLanguagesLabel}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
