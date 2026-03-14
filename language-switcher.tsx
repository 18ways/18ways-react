'use client';

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { type Language } from '@18ways/core/common';
import { readCookieFromDocument, writeCookieToDocument } from '@18ways/core/cookie-utils';
import { canonicalizeLocale, WAYS_LOCALE_COOKIE_NAME } from '@18ways/core/i18n-shared';
import { internalT } from '@18ways/core/internal-i18n';
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

export interface LanguageSwitcherProps {
  className?: string;
  style?: React.CSSProperties;
  styles?: LanguageSwitcherStyleOverrides;
  classNames?: LanguageSwitcherClassNameOverrides;
  unstyled?: boolean;
  direction?: 'up' | 'down';
  currentLocale?: string;
  onLocaleChange?: (_locale: string) => void;
  persistLocaleCookie?: boolean;
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
  onLocaleChange,
  persistLocaleCookie = true,
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
                      styles={styles}
                      classNames={classNames}
                      unstyled={unstyled}
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
