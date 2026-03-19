import { useState } from 'react';
import { LanguageSwitcher, T, Ways } from '@18ways/react';

export function App() {
  const [locale, setLocale] = useState('en-GB');

  return (
    <Ways
      apiKey="pk_dummy_demo_token"
      locale={locale}
      baseLocale="en-GB"
      acceptedLocales={['en-GB', 'en-GB-x-caesar']}
      persistLocaleCookie={false}
      context="docs.react.example"
    >
      <main className="react-demo-shell">
        <section className="react-demo-card">
          <p className="react-demo-eyebrow">@18ways/react</p>
          <h1 className="react-demo-title">
            <T>Hello world</T>
          </h1>
          <p className="react-demo-copy">
            <T>Translate React UI without writing translation keys.</T>
          </p>
        </section>
        <div className="react-demo-switcher">
          <LanguageSwitcher currentLocale={locale} onLocaleChange={setLocale} />
        </div>
      </main>
    </Ways>
  );
}
