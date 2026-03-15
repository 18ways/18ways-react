![18ways logo](https://18ways.com/18w-light.svg)

# @18ways/react

18ways makes i18n easy. SEO-ready, AI-powered translations for modern products.

`@18ways/react` is the React runtime for 18ways. It gives you the `Ways` provider, the `<T>` component, and translation hooks for everyday UI work.

## Install

```bash
npm install @18ways/react
```

## Basic translation

```tsx
import { useState } from 'react';
import { LanguageSwitcher, Ways, T } from '@18ways/react';

export function App() {
  const [locale, setLocale] = useState('fr-FR');

  return (
    <Ways apiKey="YOUR_18WAYS_PUBLIC_API_KEY" locale={locale} baseLocale="en-GB" context="app">
      <LanguageSwitcher currentLocale={locale} onLocaleChange={setLocale} />
      <Ways context="checkout.button">
        <T>Pay now</T>
      </Ways>
    </Ways>
  );
}
```

Docs: [18ways.com/docs](https://18ways.com/docs)
