'use client';

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { type Language } from '@18ways/core/common';
import { readCookieFromDocument, writeCookieToDocument } from '@18ways/core/cookie-utils';
import { canonicalizeLocale, WAYS_LOCALE_COOKIE_NAME } from '@18ways/core/i18n-shared';
import { internalT } from '@18ways/core/internal-i18n';
import { languageSwitcherStyles } from './language-switcher-styles';

const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const COOKIE_CONSENT_COOKIE_NAME = '18ways_cookie_consent';
const FUNCTIONAL_CONSENT_CATEGORY = 'functional';
// Wait long enough for locale change re-renders to enqueue translation work
// before deciding there was no loading phase to observe.
const CHANGE_SETTLE_TIMEOUT_MS = 1000;
const CHANGE_HARD_TIMEOUT_MS = 10000;

export interface LanguageSwitcherProps {
  className?: string;
  style?: React.CSSProperties;
  currentLocale?: string;
  onLocaleChange?: (_locale: string) => void;
}

export interface InternalLanguageSwitcherProps extends LanguageSwitcherProps {
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

const hasFunctionalConsent = (): boolean => {
  const rawConsentCookie = readCookieFromDocument(COOKIE_CONSENT_COOKIE_NAME);
  if (!rawConsentCookie) {
    return false;
  }

  let decodedConsentCookie = rawConsentCookie;
  try {
    decodedConsentCookie = decodeURIComponent(rawConsentCookie);
  } catch {
    decodedConsentCookie = rawConsentCookie;
  }

  try {
    const parsed = JSON.parse(decodedConsentCookie) as Record<string, unknown>;
    const categories = parsed.categories;
    if (Array.isArray(categories)) {
      return categories.includes(FUNCTIONAL_CONSENT_CATEGORY);
    }

    if (typeof categories === 'object' && categories !== null) {
      return (categories as Record<string, unknown>)[FUNCTIONAL_CONSENT_CATEGORY] === true;
    }

    if (Array.isArray(parsed.acceptedCategories)) {
      return parsed.acceptedCategories.includes(FUNCTIONAL_CONSENT_CATEGORY);
    }

    return false;
  } catch {
    return decodedConsentCookie.includes(`"${FUNCTIONAL_CONSENT_CATEGORY}"`);
  }
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

const getDisplayNames = (displayLocale: string): Intl.DisplayNames | null => {
  try {
    return new Intl.DisplayNames([displayLocale], { type: 'language' });
  } catch {
    const fallbackLocale = getLanguageSubtag(displayLocale);
    try {
      return new Intl.DisplayNames([fallbackLocale], { type: 'language' });
    } catch {
      return null;
    }
  }
};

const getLanguageLabel = (
  languageCode: string,
  displayLocale: string,
  fallback: string
): string => {
  const displayNames = getDisplayNames(displayLocale);
  if (!displayNames) {
    return fallback;
  }

  const fullTag = displayNames.of(languageCode);
  if (fullTag) {
    return fullTag;
  }

  const subtagLabel = displayNames.of(getLanguageSubtag(languageCode));
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

const optionIdFor = (listboxId: string, locale: string): string =>
  `${listboxId}-option-${locale.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

const ChevronIcon: React.FC<{ isOpen: boolean }> = ({ isOpen }) => (
  <svg
    style={{
      ...languageSwitcherStyles.chevron,
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

const SpinnerIcon: React.FC = () => (
  <svg
    style={languageSwitcherStyles.spinnerIcon}
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

const CheckIcon: React.FC = () => (
  <svg
    style={languageSwitcherStyles.check}
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
}) => {
  const localizedName = getBaseLanguageLabel(lang.code, currentLocale, lang.name || lang.code);
  const nativeName = getCompactLanguageLabel(
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
      style={{
        ...languageSwitcherStyles.menuItem,
        ...(isHovered && !isSelected ? languageSwitcherStyles.menuItemHover : null),
        ...(isActive && !isSelected ? languageSwitcherStyles.menuItemHover : null),
        ...(isSelected ? languageSwitcherStyles.menuItemSelected : null),
      }}
      role="option"
      aria-selected={isSelected}
    >
      {lang.flag && <span style={languageSwitcherStyles.flag}>{lang.flag}</span>}
      <div style={languageSwitcherStyles.menuItemTextWrap}>
        <div style={languageSwitcherStyles.menuItemName}>{localizedName}</div>
        {showSubtitle && <div style={languageSwitcherStyles.menuItemNativeName}>{nativeName}</div>}
      </div>
      {isSelected && <CheckIcon />}
    </button>
  );
};

export const InternalLanguageSwitcher: React.FC<InternalLanguageSwitcherProps> = ({
  className,
  style,
  currentLocale: controlledLocale,
  onLocaleChange,
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
  const [uncontrolledLocale, setUncontrolledLocale] = useState('en-GB');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const observedTranslationLoadingRef = useRef(false);

  const currentLocale = controlledLocale ?? rootLocale ?? uncontrolledLocale;

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

    const selectedIndex = languages.findIndex((lang) => lang.code === currentLocale);
    const nextIndex = selectedIndex >= 0 ? selectedIndex : 0;
    setActiveIndex(nextIndex);
    requestAnimationFrame(() => {
      listboxRef.current?.focus();
    });
  }, [currentLocale, isOpen, languages]);

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

      applyLocale(newLocale);
      if (hasFunctionalConsent()) {
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
    [applyLocale, clearChangeTimers, currentLocale]
  );

  const commitByIndex = useCallback(
    (index: number) => {
      const selectedLanguage = languages[index];
      if (!selectedLanguage) {
        return;
      }
      handleLanguageChange(selectedLanguage.code);
    },
    [handleLanguageChange, languages]
  );

  const openWithIndex = useCallback(
    (index: number) => {
      if (!languages.length) {
        return;
      }
      const boundedIndex = Math.max(0, Math.min(index, languages.length - 1));
      setActiveIndex(boundedIndex);
      setIsOpen(true);
    },
    [languages]
  );

  const handleButtonKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (isChanging) {
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        openWithIndex(
          Math.max(
            languages.findIndex((lang) => lang.code === currentLocale),
            0
          )
        );
        break;
      case 'ArrowUp':
        event.preventDefault();
        openWithIndex(languages.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (isOpen) {
          setIsOpen(false);
        } else {
          openWithIndex(
            Math.max(
              languages.findIndex((lang) => lang.code === currentLocale),
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
    if (!languages.length) {
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((prev) => (prev + 1) % languages.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((prev) => (prev - 1 + languages.length) % languages.length);
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(languages.length - 1);
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

  if (languages.length === 0) {
    return null;
  }

  const currentLanguage = languages.find((lang) => lang.code === currentLocale) || {
    code: currentLocale,
    name: currentLocale,
    nativeName: currentLocale,
    flag: '🌐',
  };
  const currentLocaleName = getBaseLanguageLabel(
    currentLanguage.code,
    currentLanguage.code,
    currentLanguage.nativeName || currentLanguage.name
  );
  const changingLanguageLabel = internalT(currentLocale, 'changingLanguage');
  const activeOptionId =
    activeIndex >= 0 && activeIndex < languages.length
      ? optionIdFor(listboxId, languages[activeIndex].code)
      : undefined;

  return (
    <div className={className} style={{ ...languageSwitcherStyles.wrapper, ...style }}>
      <div style={languageSwitcherStyles.container} ref={dropdownRef}>
        <button
          ref={buttonRef}
          type="button"
          onClick={() => !isChanging && setIsOpen(!isOpen)}
          onMouseEnter={() => setIsTriggerHovered(true)}
          onMouseLeave={() => setIsTriggerHovered(false)}
          onKeyDown={handleButtonKeyDown}
          disabled={isChanging}
          style={{
            ...languageSwitcherStyles.button,
            ...(isTriggerHovered && !isChanging ? languageSwitcherStyles.buttonHover : null),
            ...(isChanging ? languageSwitcherStyles.buttonChanging : null),
          }}
          aria-label={internalT(currentLocale, 'selectLanguageCurrent', {
            name: currentLocaleName,
          })}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-busy={isChanging}
        >
          <div style={languageSwitcherStyles.content}>
            {isChanging ? (
              <>
                <SpinnerIcon />
                <span style={languageSwitcherStyles.spinnerText}>{changingLanguageLabel}</span>
              </>
            ) : (
              <>
                {currentLanguage.flag && (
                  <span style={languageSwitcherStyles.flag}>{currentLanguage.flag}</span>
                )}
                <span style={languageSwitcherStyles.label}>{currentLocaleName}</span>
              </>
            )}
          </div>
          {!isChanging && <ChevronIcon isOpen={isOpen} />}
        </button>

        <div style={languageSwitcherStyles.srOnly} aria-live="polite" aria-atomic="true">
          {isChanging ? changingLanguageLabel : ''}
        </div>

        {isOpen && !isChanging && (
          <div style={languageSwitcherStyles.menu}>
            <div style={languageSwitcherStyles.menuCard}>
              <div
                ref={listboxRef}
                id={listboxId}
                style={languageSwitcherStyles.menuList}
                role="listbox"
                aria-label={internalT(currentLocale, 'availableLanguages')}
                aria-activedescendant={activeOptionId}
                tabIndex={-1}
                onKeyDown={handleListboxKeyDown}
              >
                {languages.map((lang, index) => {
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
                    />
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
