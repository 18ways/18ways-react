import type { ResolvedTranslationStoreHydrationPayload } from '@18ways/core/common';

type _18WaysInlineAliasNode = {
  format?: string;
  [key: string]: unknown;
};

declare module 'react' {
  interface DO_NOT_USE_OR_YOU_WILL_BE_FIRED_EXPERIMENTAL_REACT_NODES {
    __18waysInlineAliasNode: _18WaysInlineAliasNode;
  }
}

declare global {
  interface Window {
    __18WAYS_TRANSLATION_STORE__?: ResolvedTranslationStoreHydrationPayload;
  }
}

export {};
