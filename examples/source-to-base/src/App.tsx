import { LanguageSwitcher, T, Ways } from '@18ways/react';

const API_KEY = 'pk_dummy_demo_token';

export function App() {
  return (
    <Ways
      apiKey={API_KEY}
      baseLocale="en-GB"
      persistLocaleCookie={false}
      context="docs.react.example.source-to-target"
    >
      <main>
        <p>@18ways/react</p>
        <h1>
          <T>Target-locale translation with a nested baseLocale override</T>
        </h1>
        <LanguageSwitcher direction="down right" />

        <section>
          <h2>
            <T>English text</T>
          </h2>
          <p>
            <T>This is written in English, and inherits the baseLocale from the root.</T>
          </p>
        </section>

        <section>
          <Ways context="caesar-context" baseLocale="en-GB-x-caesar">
            <h2>
              <T>Pnrfne-13 grkg</T>
            </h2>
            <p>
              <T>
                Guvf vf jevggra va Pnrfne-13, naq bireevqrf gur onfrYbpnyr whfg sbe guvf pbagrkg
                oybpx.
              </T>
            </p>
          </Ways>
        </section>

        <section>
          <h2>
            <T>Mixed text</T>
          </h2>
          <p>
            <T>This is written in English.</T>
          </p>
          <p>
            <T baseLocale="en-GB-x-caesar">
              Ohg guvf grkg vf jevggra va Pnrfne-13, naq gur onfrYbpnyr vf bireevqqra whfg sbe guvf
              genafyngvba oybpx.
            </T>
          </p>
        </section>
      </main>
    </Ways>
  );
}
