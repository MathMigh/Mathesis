export type DictionarySourceId =
  | "analogico"
  | "aulete"
  | "corpus"
  | "etimologia"
  | "faria"
  | "gramatica"
  | "imagens"
  | "mitologico"
  | "logeion"
  | "porto"
  | "tabelas"
  | "wikipedia"
  | "priberam"
  | "infopedia"
  | "infopedia_dept"
  | "infopedia_de"
  | "infopedia_en"
  | "infopedia_enpt"
  | "infopedia_espt"
  | "infopedia_es"
  | "infopedia_frpt"
  | "infopedia_fr"
  | "infopedia_itpt"
  | "infopedia_it"
  | "english_analogico"
  | "johnson"
  | "treccani"
  | "webster"
  | "wiktionary";

export type DictionarySourceStatus =
  | "found"
  | "loading"
  | "not_found"
  | "unavailable";

export type LookupSection = {
  html: string | null;
  label: string;
  text: string | null;
};

export type DictionarySourceResult = {
  canonicalWord: string;
  label: string;
  note: string | null;
  sections: LookupSection[];
  sourceId: DictionarySourceId;
  sourceUrl: string | null;
  status: DictionarySourceStatus;
};

export type LookupPayload = {
  displayWord: string;
  requestedWord: string;
  sources: DictionarySourceResult[];
};

export type LookupContext = {
  documentAuthor?: string;
  documentLanguage?: string;
  documentLabel?: string;
  selectionContextText?: string;
  documentTitle?: string;
};
