![18ways logo](https://18ways.com/18w-light.svg)

# @18ways/react

18ways makes i18n easy. SEO-ready, AI-powered translations for modern products.

`@18ways/react` is the React runtime for 18ways. It gives you the `Ways` provider, the `<T>` component, and translation hooks for everyday UI work.

## Install

```bash
npm install @18ways/react
```

## Basic translation

Use this example exactly as written to test the library locally. `pk_dummy_demo_token` enables the built-in demo mode with the `Caesar Shift` language.

```tsx
import { useState } from 'react';
import { LanguageSwitcher, Ways, T } from '@18ways/react';

export function App() {
  const [locale, setLocale] = useState('fr-FR');

  return (
    <Ways apiKey="pk_dummy_demo_token" locale={locale} baseLocale="en-GB" context="app">
      <LanguageSwitcher currentLocale={locale} onLocaleChange={setLocale} />
      <Ways context="checkout.button">
        <T>Pay now</T>
      </Ways>
    </Ways>
  );
}
```

## Inline placeholder alias

`<T>` also accepts an inline alias for simple placeholder values so you can keep the value beside the message text while still using the existing formatter internally.

```tsx
<T>Hello today is {{ theDate, format: 'date, long' }}</T>
```

The example above is treated like this behind the scenes:

```tsx
<T vars={{ theDate }}>{'Hello today is {theDate, date, dateStyle:long}'}</T>
```

Docs: [18ways.com/docs](https://18ways.com/docs)
