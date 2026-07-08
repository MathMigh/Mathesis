import type { DictionarySourceId, LookupContext } from "./lookup-types";

export type LookupLanguage = "english" | "latin" | "portuguese";

const LATIN_MACRON_RE = /[\u0100\u0101\u0112\u0113\u012A\u012B\u014C\u014D\u016A\u016B\u0232\u0233]/u;

const PORTUGUESE_HINTS = [
  " que ",
  " para ",
  " com ",
  " nao ",
  " na ",
  " no ",
  " dos ",
  " das ",
  " uma ",
  " um ",
  " os ",
  " as ",
  " de ",
  " do ",
  " da ",
];

const LATIN_HINTS = [
  " et ",
  " non ",
  " est ",
  " sunt ",
  " cum ",
  " in ",
  " ad ",
  " per ",
  " nec ",
  " enim ",
  " autem ",
  " quae ",
  " qui ",
  " quod ",
  " eius ",
  " atque ",
  " erat ",
  " fuit ",
];

const ENGLISH_HINTS = [
  " the ",
  " and ",
  " of ",
  " to ",
  " in ",
  " that ",
  " with ",
  " his ",
  " her ",
  " not ",
  " for ",
  " from ",
  " shall ",
  " would ",
  " have ",
];

const PORTUGUESE_WORD_RE =
  /[ãõç]|\b(?:nao|tambem|acao|coracao|ligacao|entao|porque|aquela|daquele|deste|dessa|isso|coisa|livro|leitura)\b/iu;

const LATIN_WORD_RE =
  /\b(?:adfero|affero|atque|autem|enim|igitur|illud|ipsius|neque|noster|nostra|nostrum|quae|quam|quem|quia|quidem|quoque|vester|vobis|vosmet|[a-z]{4,}(?:ae|am|as|em|es|is|nt|or|re|ri|te|ti|trix|tur|tum|tus|unt|us|um|orum|arum|ibus|ius|eus|eae|eum|uum|ntur|bant|erit|erat|isse))\b/iu;

const LATIN_ENDING_RE =
  /(?:orum|arum|ibus|ntur|bant|erit|erat|isse|ae|am|em|is|nt|re|ri|te|tur|tum|tus|unt|us|um)$/iu;

const ENGLISH_WORD_RE =
  /\b(?:the|and|that|with|shall|would|could|should|through|though|thought|heart|mind|house|virtue|love|death|life|light|dark|king|queen|lord|lady|man|woman|world|heaven|earth)\b/iu;

export const PORTUGUESE_LOOKUP_SOURCE_IDS = [
  "aulete",
  "priberam",
  "infopedia",
  "etimologia",
  "gramatica",
  "analogico",
  "mitologico",
  "wikipedia",
  "corpus",
  "imagens",
] as const satisfies readonly DictionarySourceId[];

export const LATIN_LOOKUP_SOURCE_IDS = [
  "faria",
  "logeion",
  "tabelas",
  "corpus",
] as const satisfies readonly DictionarySourceId[];

export const ENGLISH_LOOKUP_SOURCE_IDS = [
  "johnson",
  "webster",
  "wiktionary",
  "infopedia_enpt",
  "etimologia",
  "english_analogico",
  "mitologico",
  "wikipedia",
  "corpus",
  "imagens",
] as const satisfies readonly DictionarySourceId[];

export function getLookupSourceIdsForLanguage(language: LookupLanguage) {
  if (language === "english") {
    return ENGLISH_LOOKUP_SOURCE_IDS;
  }

  if (language === "latin") {
    return LATIN_LOOKUP_SOURCE_IDS;
  }

  return PORTUGUESE_LOOKUP_SOURCE_IDS;
}

function stripAccents(value: string) {
  return value.normalize("NFD").replace(/\p{Mark}+/gu, "");
}

function normalizeHintText(value: string | undefined) {
  const normalized =
    value?.normalize("NFC").toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim() ?? "";
  return ` ${stripAccents(normalized)} `;
}

function scoreHints(text: string, hints: readonly string[]) {
  let score = 0;

  for (const hint of hints) {
    if (text.includes(hint)) {
      score += 1;
    }
  }

  return score;
}

function resolveLanguageFromDocument(documentLanguage: string | undefined) {
  const normalized = normalizeHintText(documentLanguage);

  if (!normalized.trim()) {
    return null;
  }

  if (/\b(?:la|lat|latim|latin|latina)\b/u.test(normalized)) {
    return "latin" satisfies LookupLanguage;
  }

  if (/\b(?:en|eng|english|ingles|inglesa|ingl[eê]s)\b/u.test(normalized)) {
    return "english" satisfies LookupLanguage;
  }

  if (/\b(?:pt|por|portuguese|portugues|portuguesa)\b/u.test(normalized)) {
    return "portuguese" satisfies LookupLanguage;
  }

  return null;
}
export function detectLookupLanguage(
  word: string,
  context?: LookupContext,
): LookupLanguage {
  const normalizedWord = word.normalize("NFC");
  const normalizedWordAscii = stripAccents(normalizedWord.toLocaleLowerCase("pt-BR"));

  const contextEnvelope = normalizeHintText(
    [
      context?.selectionContextText ?? "",
      context?.documentTitle ?? "",
      context?.documentAuthor ?? "",
      context?.documentLabel ?? "",
    ].join(" "),
  );
  const documentLanguage = resolveLanguageFromDocument(context?.documentLanguage);

  const latinScore = scoreHints(contextEnvelope, LATIN_HINTS);
  const portugueseScore = scoreHints(contextEnvelope, PORTUGUESE_HINTS);
  const englishScore = scoreHints(contextEnvelope, ENGLISH_HINTS);

  if (documentLanguage === "english" || documentLanguage === "latin") {
    return documentLanguage;
  }

  if (documentLanguage === "portuguese") {
    if (
      englishScore >= 2 &&
      englishScore > portugueseScore &&
      englishScore > latinScore
    ) {
      return "english";
    }

    if (
      latinScore >= 2 &&
      latinScore > portugueseScore &&
      latinScore > englishScore
    ) {
      return "latin";
    }

    if (LATIN_MACRON_RE.test(normalizedWord)) {
      return "latin";
    }

    if (
      ENGLISH_WORD_RE.test(normalizedWordAscii) &&
      !PORTUGUESE_WORD_RE.test(normalizedWordAscii)
    ) {
      return "english";
    }

    return "portuguese";
  }

  if (englishScore >= 2 && englishScore > portugueseScore && englishScore > latinScore) {
    return "english";
  }

  if (portugueseScore >= 1 && latinScore === 0 && englishScore === 0) {
    return "portuguese";
  }

  if (latinScore >= 1 && portugueseScore === 0 && englishScore === 0) {
    return "latin";
  }

  if (portugueseScore >= 2 && portugueseScore > latinScore) {
    return "portuguese";
  }

  if (latinScore >= 2 && latinScore > portugueseScore) {
    return "latin";
  }

  if (LATIN_MACRON_RE.test(normalizedWord) || LATIN_WORD_RE.test(normalizedWordAscii)) {
    return "latin";
  }

  if (ENGLISH_WORD_RE.test(normalizedWordAscii)) {
    return "english";
  }

  if (
    normalizedWordAscii.length >= 4 &&
    LATIN_ENDING_RE.test(normalizedWordAscii) &&
    !PORTUGUESE_WORD_RE.test(normalizedWordAscii)
  ) {
    return "latin";
  }

  if (PORTUGUESE_WORD_RE.test(normalizedWordAscii)) {
    return "portuguese";
  }

  if (documentLanguage) {
    return documentLanguage;
  }

  return "portuguese";
}

export function getLookupSourceIdsForWord(
  word: string,
  context?: LookupContext,
): readonly DictionarySourceId[] {
  if (/\s/u.test(word)) {
    return ["wikipedia"] as const;
  }

  const language = detectLookupLanguage(word, context);
  return getLookupSourceIdsForLanguage(language);
}

