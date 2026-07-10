import type {
  DictionarySourceId,
  DictionarySourceResult,
  LookupContext,
} from "./lookup-types";

export const LOOKUP_SOURCE_IDS = [
  "logeion",
  "johnson",
  "webster",
  "wiktionary",
  "aulete",
  "faria",
  "tabelas",
  "priberam",
  "infopedia",
  "infopedia_enpt",
  "english_analogico",
  "etimologia",
  "gramatica",
  "analogico",
  "mitologico",
  "wikipedia",
  "corpus",
  "imagens",
] as const satisfies readonly DictionarySourceId[];

const SOURCE_LABELS: Record<DictionarySourceId, string> = {
  logeion: "Logeion",
  johnson: "Johnson",
  webster: "Webster 1913",
  wiktionary: "Wiktionary",
  aulete: "Aulete",
  faria: "Ernesto Faria",
  tabelas: "Tabelas Latinas",
  priberam: "Priberam",
  infopedia: "Infop\u00e9dia",
  infopedia_enpt: "Infop\u00e9dia",
  english_analogico: "Analogia",
  etimologia: "Etimologia",
  gramatica: "Gram\u00e1tica",
  analogico: "Analogia",
  mitologico: "Mitologia",
  wikipedia: "Wikipedia",
  corpus: "Corpus",
  imagens: "Imagens",
};

export function getLookupSourceLabel(sourceId: DictionarySourceId) {
  return SOURCE_LABELS[sourceId] ?? "Fonte";
}

function isEnglishContext(context?: LookupContext) {
  return /\b(?:en|eng|english|ingles|inglesa|ingl[e\u00ea]s)\b/iu.test(
    context?.documentLanguage ?? "",
  );
}

function isLatinContext(context?: LookupContext) {
  return /\b(?:la|lat|latim|latin|latina)\b/iu.test(
    context?.documentLanguage ?? "",
  );
}

export function getLookupSourceUrl(
  sourceId: DictionarySourceId,
  requestedWord: string,
  context?: LookupContext,
) {
  switch (sourceId) {
    case "logeion":
      return `https://logeion.uchicago.edu/${encodeURIComponent(requestedWord)}`;
    case "johnson":
      return `https://johnsonsdictionaryonline.com/views/search.php?term=${encodeURIComponent(
        requestedWord,
      )}`;
    case "webster":
      return `https://www.websters1913.com/words/${encodeURIComponent(requestedWord)}`;
    case "wiktionary":
      return `https://en.wiktionary.org/wiki/${encodeURIComponent(requestedWord)}`;
    case "aulete":
      return `https://www.aulete.com.br/${encodeURIComponent(requestedWord)}`;
    case "faria":
      return "https://www.dicionariolatino.com/";
    case "tabelas":
    case "gramatica":
    case "mitologico":
      return null;
    case "priberam":
      return `https://dicionario.priberam.org/${encodeURIComponent(requestedWord)}`;
    case "infopedia":
      return `https://www.infopedia.pt/dicionarios/lingua-portuguesa/${encodeURIComponent(
        requestedWord,
      )}`;
    case "infopedia_enpt":
      return `https://www.infopedia.pt/dicionarios/ingles-portugues/${encodeURIComponent(
        requestedWord,
      )}`;
    case "etimologia":
      return isEnglishContext(context)
        ? `https://www.etymonline.com/word/${encodeURIComponent(requestedWord)}`
        : `https://www.google.com/search?q=${encodeURIComponent(
            `etimologia de ${requestedWord}`,
          )}`;
    case "english_analogico":
      return `https://www.onelook.com/thesaurus/?s=${encodeURIComponent(requestedWord)}`;
    case "corpus":
      if (isLatinContext(context)) {
        return "https://www.thelatinlibrary.com/";
      }

      if (isEnglishContext(context)) {
        return "https://www.gutenberg.org/";
      }

      return `https://pt.wikisource.org/w/index.php?search=${encodeURIComponent(
        requestedWord,
      )}&title=Especial:Pesquisar&ns0=1`;
    case "imagens":
      return `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(requestedWord)}`;
    case "wikipedia":
      return isEnglishContext(context)
        ? `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(requestedWord)}`
        : `https://pt.wikipedia.org/w/index.php?search=${encodeURIComponent(requestedWord)}`;
    case "analogico":
      return `https://www.aulete.com.br/analogico/${encodeURIComponent(requestedWord)}`;
    default:
      return null;
  }
}

export function createLoadingSource(
  requestedWord: string,
  sourceId: DictionarySourceId,
  context?: LookupContext,
): DictionarySourceResult {
  return {
    canonicalWord: requestedWord,
    label: getLookupSourceLabel(sourceId),
    note: "Consultando esta fonte em paralelo.",
    sections: [],
    sourceId,
    sourceUrl: getLookupSourceUrl(sourceId, requestedWord, context),
    status: "loading",
  };
}

export function createUnavailableSource(
  requestedWord: string,
  sourceId: DictionarySourceId,
  note = "A consulta falhou antes de o verbete ser montado.",
  context?: LookupContext,
): DictionarySourceResult {
  return {
    canonicalWord: requestedWord,
    label: getLookupSourceLabel(sourceId),
    note,
    sections: [],
    sourceId,
    sourceUrl: getLookupSourceUrl(sourceId, requestedWord, context),
    status: "unavailable",
  };
}
