import type React from 'react';

const SWITCHER_MENU_Z_INDEX = 50;

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
  | 'menuList'
  | 'menuItem'
  | 'menuItemHover'
  | 'menuItemSelected'
  | 'menuItemTextWrap'
  | 'menuItemName'
  | 'menuItemNativeName'
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
    border: '1px solid #d1d5db',
    borderRadius: 10,
    background: '#ffffff',
    color: '#111827',
    boxShadow: '0 10px 24px rgba(15, 23, 42, 0.12)',
    fontSize: 14,
    fontWeight: 500,
    lineHeight: 1.2,
    cursor: 'pointer',
    transition:
      'background-color 160ms ease, box-shadow 160ms ease, transform 120ms ease, opacity 120ms ease',
  },
  buttonHover: {
    background: '#f8fafc',
    boxShadow: '0 14px 28px rgba(15, 23, 42, 0.14)',
    transform: 'translateY(-1px)',
  },
  buttonChanging: {
    cursor: 'wait',
    opacity: 0.75,
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
    color: '#6b7280',
    pointerEvents: 'none',
    transition: 'transform 0.2s ease',
    transformOrigin: 'center',
  },
  spinnerText: {
    color: '#6b7280',
  },
  menu: {
    position: 'absolute',
    right: 0,
    bottom: 'calc(100% + 8px)',
    width: 256,
    maxHeight: 384,
    overflowY: 'auto',
    zIndex: SWITCHER_MENU_Z_INDEX,
  },
  menuCard: {
    borderRadius: 10,
    background: '#ffffff',
    boxShadow: '0 10px 24px rgba(15, 23, 42, 0.16)',
    border: '1px solid rgba(15, 23, 42, 0.1)',
    overflow: 'hidden',
  },
  menuList: {
    padding: '4px 0',
  },
  menuItem: {
    width: '100%',
    textAlign: 'left',
    border: 'none',
    background: 'transparent',
    padding: '8px 14px',
    fontSize: 14,
    lineHeight: 1.25,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    cursor: 'pointer',
    color: '#374151',
    transition: 'background-color 120ms ease, color 120ms ease',
  },
  menuItemHover: {
    background: '#f1f5f9',
  },
  menuItemSelected: {
    background: '#eff6ff',
    color: '#1d4ed8',
  },
  menuItemTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  menuItemName: {
    fontWeight: 500,
    textTransform: 'capitalize',
  },
  menuItemNativeName: {
    fontSize: 12,
    opacity: 0.75,
    marginTop: 1,
  },
  check: {
    width: 16,
    height: 16,
    color: '#2563eb',
    flexShrink: 0,
  },
  spinnerIcon: {
    width: 16,
    height: 16,
    color: '#6b7280',
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
