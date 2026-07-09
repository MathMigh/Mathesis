import type { ReaderDocument } from "@/lib/local-reader-documents";
import type { LookupLanguage } from "@/lib/lookup-language";
import { getLookupSourceIdsForLanguage } from "@/lib/lookup-language";
import type {
  DictionarySourceId,
  DictionarySourceResult,
  LookupContext,
  LookupPayload,
} from "@/lib/lookup-types";
import {
  createLoadingSource,
  createUnavailableSource,
} from "@/lib/lookup-source-config";

import { buildEmptySourceMessage, getDisplaySource } from "./lookup-display";

export const SEARCHABLE_INLINE_SOURCE_IDS = new Set<DictionarySourceId>([
  "aulete",
  "priberam",
  "infopedia",
  "infopedia_de",
  "infopedia_dept",
  "infopedia_en",
  "infopedia_enpt",
  "infopedia_es",
  "infopedia_espt",
  "infopedia_fr",
  "infopedia_frpt",
  "infopedia_it",
  "infopedia_itpt",
  "etimologia",
  "gramatica",
  "analogico",
  "mitologico",
  "wikipedia",
  "corpus",
  "johnson",
  "webster",
  "wiktionary",
  "english_analogico",
  "treccani",
  "logeion",
  "faria",
]);

export function isInlineSearchSource(sourceId: DictionarySourceId) {
  return SEARCHABLE_INLINE_SOURCE_IDS.has(sourceId);
}

export function buildLookupContext(
  documentState: ReaderDocument | null,
  selectionContextText?: string,
  overrides?: Partial<LookupContext>,
): LookupContext {
  return {
    documentAuthor: overrides?.documentAuthor ?? documentState?.meta.author,
    documentLanguage: overrides?.documentLanguage ?? documentState?.meta.language,
    documentLabel: overrides?.documentLabel ?? documentState?.label,
    selectionContextText: overrides?.selectionContextText ?? selectionContextText,
    documentTitle: overrides?.documentTitle ?? documentState?.meta.title,
  };
}

export function buildManualEmptyPayload(language: LookupLanguage): LookupPayload {
  const context: LookupContext = { documentLanguage: language };

  return {
    displayWord: "",
    requestedWord: "",
    sources: getLookupSourceIdsForLanguage(language).map((sourceId) => {
      if (language === "latin" && sourceId === "tabelas") {
        return createLoadingSource("sum", sourceId, context);
      }

      return createUnavailableSource(
        "",
        sourceId,
        buildEmptySourceMessage(sourceId),
        context,
      );
    }),
  };
}

export function seedInlineSourceState(payload: LookupPayload, seedWord: string) {
  const queries: Partial<Record<DictionarySourceId, string>> = {};
  const results: Partial<Record<DictionarySourceId, DictionarySourceResult>> = {};
  const loading: Partial<Record<DictionarySourceId, boolean>> = {};

  for (const source of payload.sources) {
    if (!SEARCHABLE_INLINE_SOURCE_IDS.has(source.sourceId)) {
      continue;
    }

    queries[source.sourceId] = seedWord;
    results[source.sourceId] = source;
    loading[source.sourceId] = source.status === "loading";
  }

  return { loading, queries, results };
}

function getSourceTimeoutMs(sourceId: DictionarySourceId) {
  if (sourceId === "corpus") {
    return 60000;
  }

  if (sourceId === "analogico") {
    return 25000;
  }

  if (sourceId === "mitologico") {
    return 45000;
  }

  if (sourceId === "wikipedia") {
    return 15000;
  }

  if (sourceId === "infopedia") {
    return 45000;
  }

  if (sourceId === "imagens") {
    return 45000;
  }

  if (sourceId === "etimologia") {
    return 60000;
  }

  if (sourceId === "gramatica") {
    return 60000;
  }

  return 25000;
}

export async function fetchLookupSourceResult(
  word: string,
  sourceId: DictionarySourceId,
  context: LookupContext,
  parentSignal: AbortSignal,
) {
  const timeoutController = new AbortController();
  const timeoutId = window.setTimeout(
    () => timeoutController.abort(),
    getSourceTimeoutMs(sourceId),
  );
  const abortFromParent = () => timeoutController.abort();

  parentSignal.addEventListener("abort", abortFromParent, { once: true });

  try {
    const shouldSendDocumentContext =
      sourceId === "corpus" ||
      sourceId === "etimologia" ||
      sourceId === "imagens" ||
      sourceId === "wikipedia" ||
      sourceId === "johnson" ||
      sourceId === "webster" ||
      sourceId === "wiktionary" ||
      sourceId === "english_analogico" ||
      sourceId === "infopedia_de" ||
      sourceId === "infopedia_dept" ||
      sourceId === "infopedia_en" ||
      sourceId === "infopedia_enpt" ||
      sourceId === "infopedia_es" ||
      sourceId === "infopedia_espt" ||
      sourceId === "infopedia_fr" ||
      sourceId === "infopedia_frpt" ||
      sourceId === "infopedia_it" ||
      sourceId === "infopedia_itpt" ||
      sourceId === "treccani" ||
      sourceId === "gramatica" ||
      sourceId === "logeion" ||
      sourceId === "faria" ||
      sourceId === "porto" ||
      sourceId === "tabelas" ||
      sourceId === "mitologico";
    const response = await fetch(
      `/api/lookup?${new URLSearchParams({
        word,
        source: sourceId,
        ...(sourceId === "analogico" ? { revision: "analogia-v12" } : {}),
        ...(sourceId === "mitologico" ? { revision: "grimal-allowed-names-v40" } : {}),
        ...(shouldSendDocumentContext && context.documentAuthor
          ? { documentAuthor: context.documentAuthor }
          : {}),
        ...(shouldSendDocumentContext && context.documentLanguage
          ? { documentLanguage: context.documentLanguage }
          : {}),
        ...(shouldSendDocumentContext && context.documentLabel
          ? { documentLabel: context.documentLabel }
          : {}),
        ...(shouldSendDocumentContext && context.selectionContextText
          ? { selectionContextText: context.selectionContextText }
          : {}),
        ...(shouldSendDocumentContext && context.documentTitle
          ? { documentTitle: context.documentTitle }
          : {}),
      }).toString()}`,
      {
        signal: timeoutController.signal,
      },
    );

    const body = (await response.json()) as
      | DictionarySourceResult
      | { message?: string };

    if (!response.ok || !("sourceId" in body)) {
      throw new Error(
        "message" in body && body.message
          ? body.message
          : "Nao consegui consultar esta fonte agora.",
      );
    }

    return getDisplaySource(body);
  } catch (error) {
    if (parentSignal.aborted) {
      throw error;
    }

    if (timeoutController.signal.aborted) {
      throw new Error("Esta fonte demorou demais nesta consulta; tente de novo em instantes.");
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    parentSignal.removeEventListener("abort", abortFromParent);
  }
}
