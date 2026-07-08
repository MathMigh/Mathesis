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
  "porto",
  "tabelas",
  "priberam",
  "infopedia",
  "infopedia_dept",
  "infopedia_de",
  "infopedia_en",
  "infopedia_enpt",
  "infopedia_espt",
  "infopedia_es",
  "infopedia_frpt",
  "infopedia_fr",
  "infopedia_itpt",
  "infopedia_it",
  "treccani",
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
  porto: "Porto Editora",
  tabelas: "Tabelas Latinas",
  priberam: "Priberam",
  infopedia: "Infopédia",
  infopedia_dept: "Alemão-Português",
  infopedia_de: "Alemão-Alemão",
  infopedia_en: "Infopédia",
  infopedia_enpt: "Infopédia",
  infopedia_espt: "Espanhol-Português",
  infopedia_es: "Espanhol-Espanhol",
  infopedia_frpt: "Francês-Português",
  infopedia_fr: "Francês-Francês",
  infopedia_itpt: "Italiano-Português",
  infopedia_it: "Italiano-Italiano",
  treccani: "Treccani",
  english_analogico: "Analogia",
  etimologia: "Etimologia",
  gramatica: "Gramática",
  analogico: "Analogia",
  mitologico: "Mitologia",
  wikipedia: "Wikipedia",
  corpus: "Corpus",
  imagens: "Imagens",
};

export function getLookupSourceLabel(sourceId: DictionarySourceId) {
  return SOURCE_LABELS[sourceId] ?? "Analogia";
}

function isEnglishContext(context?: LookupContext) {
  return /\b(?:en|eng|english|ingles|inglesa|ingl[eê]s)\b/iu.test(
    context?.documentLanguage ?? "",
  );
}

export function getLookupSourceUrl(
  sourceId: DictionarySourceId,
  requestedWord: string,
  context?: LookupContext,
) {
  if (sourceId === "logeion") {
    return `https://logeion.uchicago.edu/${encodeURIComponent(requestedWord)}`;
  }

  if (sourceId === "johnson") {
    return `https://johnsonsdictionaryonline.com/views/search.php?term=${encodeURIComponent(
      requestedWord,
    )}`;
  }

  if (sourceId === "webster") {
    return `https://www.websters1913.com/words/${encodeURIComponent(requestedWord)}`;
  }

  if (sourceId === "wiktionary") {
    return `https://en.wiktionary.org/wiki/${encodeURIComponent(requestedWord)}`;
  }

  if (sourceId === "treccani") {
    return `https://www.treccani.it/vocabolario/${encodeURIComponent(requestedWord)}/`;
  }

  if (sourceId === "aulete") {
    return `https://www.aulete.com.br/${encodeURIComponent(requestedWord)}`;
  }

  if (sourceId === "faria") {
    return "https://www.dicionariolatino.com/";
  }

  if (sourceId === "porto" || sourceId === "tabelas") {
    return null;
  }

  if (sourceId === "priberam") {
    return `https://dicionario.priberam.org/${encodeURIComponent(requestedWord)}`;
  }

  if (sourceId === "infopedia") {
    return `https://www.infopedia.pt/dicionarios/lingua-portuguesa/${encodeURIComponent(
      requestedWord,
    )}`;
  }

  if (sourceId === "infopedia_en" || sourceId === "infopedia_enpt") {
    return `https://www.infopedia.pt/dicionarios/ingles-portugues/${encodeURIComponent(
      requestedWord,
    )}`;
  }

  if (sourceId === "infopedia_frpt") {
    return `https://www.infopedia.pt/dicionarios/frances-portugues/${encodeURIComponent(
      requestedWord,
    )}`;
  }

  if (sourceId === "infopedia_fr") {
    return `https://www.infopedia.pt/dicionarios/frances-frances/${encodeURIComponent(
      requestedWord,
    )}`;
  }

  if (sourceId === "infopedia_espt") {
    return `https://www.infopedia.pt/dicionarios/espanhol-portugues/${encodeURIComponent(
      requestedWord,
    )}`;
  }

  if (sourceId === "infopedia_es") {
    return `https://www.infopedia.pt/dicionarios/espanhol-espanhol/${encodeURIComponent(
      requestedWord,
    )}`;
  }

  if (sourceId === "infopedia_dept") {
    return `https://www.infopedia.pt/dicionarios/alemao-portugues/${encodeURIComponent(
      requestedWord,
    )}`;
  }

  if (sourceId === "infopedia_de") {
    return `https://www.infopedia.pt/dicionarios/alemao-alemao/${encodeURIComponent(
      requestedWord,
    )}`;
  }

  if (sourceId === "infopedia_itpt") {
    return `https://www.infopedia.pt/dicionarios/italiano-portugues/${encodeURIComponent(
      requestedWord,
    )}`;
  }

  if (sourceId === "infopedia_it") {
    return `https://www.infopedia.pt/dicionarios/italiano-italiano/${encodeURIComponent(
      requestedWord,
    )}`;
  }

  if (sourceId === "etimologia") {
    if (isEnglishContext(context)) {
      return `https://www.etymonline.com/word/${encodeURIComponent(requestedWord)}`;
    }

    return `https://www.google.com/search?q=${encodeURIComponent(
      `etimologia de ${requestedWord}`,
    )}`;
  }

  if (sourceId === "english_analogico") {
    return `https://www.onelook.com/thesaurus/?s=${encodeURIComponent(requestedWord)}`;
  }

  if (sourceId === "gramatica" || sourceId === "mitologico") {
    return null;
  }

  if (sourceId === "corpus") {
    if (
      /\b(?:la|lat|latim|latin|latina|grc|greek|grego|grega)\b/iu.test(
        context?.documentLanguage ?? "",
      )
    ) {
      return "https://www.thelatinlibrary.com/";
    }

    if (isEnglishContext(context)) {
      return "https://www.gutenberg.org/";
    }

    return `https://pt.wikisource.org/w/index.php?search=${encodeURIComponent(
      requestedWord,
    )}&title=Especial:Pesquisar&ns0=1`;
  }

  if (sourceId === "imagens") {
    return `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(requestedWord)}`;
  }

  if (sourceId === "wikipedia") {
    if (isEnglishContext(context)) {
      return `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(requestedWord)}`;
    }

    return `https://pt.wikipedia.org/w/index.php?search=${encodeURIComponent(requestedWord)}`;
  }

  return `https://www.aulete.com.br/analogico/${encodeURIComponent(requestedWord)}`;
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
