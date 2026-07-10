export type DictionarySourceId =
  | "analogico"
  | "aulete"
  | "corpus"
  | "english_analogico"
  | "etimologia"
  | "faria"
  | "gramatica"
  | "imagens"
  | "infopedia"
  | "infopedia_enpt"
  | "johnson"
  | "logeion"
  | "mitologico"
  | "priberam"
  | "tabelas"
  | "webster"
  | "wikipedia"
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
