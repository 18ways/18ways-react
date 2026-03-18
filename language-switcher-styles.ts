import type React from 'react';

const SWITCHER_MENU_Z_INDEX = 50;
const NEUTRAL_0 = '#f9fbfa';
const NEUTRAL_50 = '#f2f6f4';
const NEUTRAL_100 = '#e3ece8';
const NEUTRAL_200 = '#c8d7d0';
const NEUTRAL_300 = '#a7bbb2';
const NEUTRAL_500 = '#61766d';
const NEUTRAL_600 = '#495b54';
const NEUTRAL_950 = '#052015';
const BRAND_50 = '#f1faf5';
const BRAND_100 = '#dbf0e3';
const BRAND_200 = '#b8e0ca';
const BRAND_400 = '#4dbb88';
const BRAND_500 = '#119955';
const BRAND_700 = '#0d6f47';

export type LanguageSwitcherStyleKey =
  | 'wrapper'
  | 'container'
  | 'button'
  | 'buttonHover'
  | 'buttonChanging'
  | 'content'
  | 'flag'
  | 'label'
  | 'chevron'
  | 'spinnerText'
  | 'menu'
  | 'menuCard'
  | 'searchWrap'
  | 'searchInput'
  | 'menuList'
  | 'section'
  | 'sectionHeader'
  | 'menuItem'
  | 'menuItemHover'
  | 'menuItemSelected'
  | 'menuItemTextWrap'
  | 'menuItemName'
  | 'menuItemNativeName'
  | 'emptyState'
  | 'check'
  | 'spinnerIcon'
  | 'srOnly';

export type LanguageSwitcherStyleOverrides = Partial<
  Record<LanguageSwitcherStyleKey, React.CSSProperties>
>;

export const languageSwitcherStyles: Record<LanguageSwitcherStyleKey, React.CSSProperties> = {
  wrapper: {
    display: 'inline-block',
  },
  container: {
    position: 'relative',
    display: 'inline-block',
  },
  button: {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    minWidth: 164,
    padding: '10px 40px 10px 16px',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: NEUTRAL_300,
    borderRadius: 12,
    background: NEUTRAL_0,
    color: NEUTRAL_950,
    boxShadow: '0 12px 30px rgba(5, 32, 21, 0.12)',
    fontSize: 14,
    fontWeight: 500,
    lineHeight: 1.2,
    cursor: 'pointer',
    transition:
      'background-color 160ms ease, box-shadow 160ms ease, transform 120ms ease, opacity 120ms ease',
  },
  buttonHover: {
    background: NEUTRAL_50,
    borderColor: BRAND_200,
    boxShadow: '0 16px 34px rgba(5, 32, 21, 0.14)',
    transform: 'translateY(-1px)',
  },
  buttonChanging: {
    cursor: 'wait',
    opacity: 0.75,
    background: NEUTRAL_50,
    transform: 'translateY(-1px)',
  },
  content: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  flag: {
    fontSize: 16,
    lineHeight: 1,
    flexShrink: 0,
  },
  label: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    textTransform: 'capitalize',
  },
  chevron: {
    position: 'absolute',
    right: 12,
    width: 16,
    height: 16,
    color: NEUTRAL_500,
    pointerEvents: 'none',
    transition: 'transform 0.2s ease',
    transformOrigin: 'center',
  },
  spinnerText: {
    color: NEUTRAL_600,
  },
  menu: {
    position: 'absolute',
    right: 0,
    bottom: 'calc(100% + 8px)',
    width: 320,
    zIndex: SWITCHER_MENU_Z_INDEX,
  },
  menuCard: {
    display: 'flex',
    flexDirection: 'column',
    maxHeight: 384,
    borderRadius: 16,
    background: NEUTRAL_0,
    boxShadow: '0 18px 44px rgba(5, 32, 21, 0.16)',
    border: `1px solid ${NEUTRAL_200}`,
    overflow: 'hidden',
  },
  searchWrap: {
    padding: '12px 12px 10px',
    borderBottom: `1px solid ${NEUTRAL_100}`,
    background: NEUTRAL_0,
  },
  searchInput: {
    width: '100%',
    border: `1px solid ${NEUTRAL_300}`,
    borderRadius: 10,
    background: NEUTRAL_50,
    color: NEUTRAL_950,
    padding: '9px 12px',
    fontSize: 14,
    lineHeight: 1.25,
    outline: 'none',
  },
  menuList: {
    flex: 1,
    overflowY: 'auto',
    padding: '8px 0',
  },
  section: {
    padding: '0 0 8px',
  },
  sectionHeader: {
    padding: '4px 14px 8px',
    fontSize: 11,
    lineHeight: 1.2,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: NEUTRAL_500,
  },
  menuItem: {
    width: '100%',
    textAlign: 'left',
    border: 'none',
    background: 'transparent',
    padding: '10px 14px',
    fontSize: 14,
    lineHeight: 1.25,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    cursor: 'pointer',
    color: NEUTRAL_600,
    borderRadius: 10,
    margin: '0 6px',
    transition: 'background-color 120ms ease, color 120ms ease',
  },
  menuItemHover: {
    background: NEUTRAL_50,
  },
  menuItemSelected: {
    background: BRAND_50,
    color: BRAND_700,
  },
  menuItemTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  menuItemName: {
    fontWeight: 500,
  },
  menuItemNativeName: {
    fontSize: 12,
    opacity: 0.75,
    marginTop: 1,
  },
  emptyState: {
    padding: '14px',
    fontSize: 13,
    lineHeight: 1.4,
    color: NEUTRAL_500,
  },
  check: {
    width: 16,
    height: 16,
    color: BRAND_500,
    flexShrink: 0,
  },
  spinnerIcon: {
    width: 16,
    height: 16,
    color: BRAND_400,
    flexShrink: 0,
  },
  srOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    border: 0,
    whiteSpace: 'nowrap',
  },
};
