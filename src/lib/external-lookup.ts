import type { LookupLanguage } from "./lookup-language";

const MAX_EXTERNAL_LOOKUP_LENGTH = 120;

export type ExternalLookupRequest = {
  language: LookupLanguage | null;
  word: string;
};

function readLanguage(value: string | null): LookupLanguage | null {
  if (value === "portuguese" || value === "latin" || value === "english") {
    return value;
  }

  return null;
}

/**
 * Reads the companion/extension hand-off without trusting arbitrary query
 * strings. The reader accepts only one short lexical query at a time.
 */
export function readExternalLookupRequest(search: string): ExternalLookupRequest | null {
  const params = new URLSearchParams(search);
  const rawWord = params.get("lookup")?.normalize("NFC").trim() ?? "";

  if (!rawWord || rawWord.length > MAX_EXTERNAL_LOOKUP_LENGTH) {
    return null;
  }

  return {
    language: readLanguage(params.get("lang")),
    word: rawWord,
  };
}
