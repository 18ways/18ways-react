import { LanguageSwitcher, T, Ways } from '@18ways/react';

type KnownConversationLocale = 'en-GB' | 'en-GB-x-caesar' | 'fr-FR' | 'de-DE' | 'ja-JP';
type ConversationLocale = KnownConversationLocale | '?';

type ConversationMessage = {
  author: string;
  message: string;
  locale?: ConversationLocale;
};

const API_KEY = 'pk_dummy_demo_token';
const isDemoKey = API_KEY === 'pk_dummy_demo_token';

const demoConversation: ConversationMessage[] = [
  {
    author: 'Alice Rowe',
    message: 'How are you doing?',
    locale: 'en-GB',
  },
  {
    author: 'Theo Hart',
    message: 'V nz qbvat jryy. Ubj ner lbh?',
    locale: 'en-GB-x-caesar',
  },
  {
    author: 'Alice Rowe',
    message: 'I am ready for lunch.',
    locale: 'en-GB',
  },
  {
    author: 'Theo Hart',
    message: "Terng. Yrg'f zrrg ng abba.",
    locale: 'en-GB-x-caesar',
  },
];

const multilingualConversation: ConversationMessage[] = [
  {
    author: 'Alice Rowe',
    message: 'How are you doing?',
    locale: 'en-GB',
  },
  {
    author: 'Camille Laurent',
    message: 'Je vais bien. Tu veux dejeuner ensemble ?',
    locale: 'fr-FR',
  },
  {
    author: 'Jonas Keller',
    message: 'Ja, gern. Ich kann um zwoelf Uhr da sein.',
    locale: 'de-DE',
  },
  {
    author: 'Aiko Tanaka',
    message: 'いいですね。駅の近くで会いましょう。',
    locale: 'ja-JP',
  },
  {
    author: 'Mina Rossi',
    message: 'Ciao, ci vediamo tra dieci minuti.',
  },
];

const conversation = isDemoKey ? demoConversation : multilingualConversation;

export function App() {
  return (
    <Ways
      apiKey={API_KEY}
      baseLocale="en-GB"
      persistLocaleCookie={false}
      context="docs.react.example.conversation-array"
      _apiUrl="http://localhost:3001/api"
    >
      <main>
        <p>@18ways/react</p>
        <h1>
          <T>Conversation</T>
        </h1>
        <p>
          <T>Each message keeps its own source locale and renders in the selected target locale.</T>
        </p>
        <LanguageSwitcher direction="down right" />
        <ul>
          {conversation.map((entry, index) => (
            <li key={`${entry.author}-${index}`}>
              <p>{entry.author}</p>
              <Ways context={`message-${index}`} baseLocale={entry.locale || '?'}>
                <p>
                  <T>{entry.message}</T>
                </p>
              </Ways>
            </li>
          ))}
        </ul>
      </main>
    </Ways>
  );
}
