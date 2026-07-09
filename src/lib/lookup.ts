import { lookupAnalogico } from "./analogico";
import { createHash } from "node:crypto";
import { lookupAulete } from "./aulete";
import { lookupClassicCorpus } from "./classic-corpus";
import { lookupEnglishAnalogico } from "./english-analogico";
import { lookupEtymologyAi } from "./etymology-ai";
import { lookupFaria } from "./faria";
import { lookupGrammarLocal } from "./grammar-local";
import { lookupImages } from "./images";
import { normalizeInlineText } from "./dictionary-utils";
import {
  lookupInfopediaBilingual,
  lookupInfopediaEnPt,
  lookupInfopediaEnglish,
  lookupInfopediaMonolingual,
} from "./infopedia-enpt-clean";
import { lookupInfopedia } from "./infopedia";
import { lookupJohnson } from "./johnson";
import { getLookupSourceIdsForWord } from "./lookup-language";
import { lookupLogeion } from "./logeion";
import { lookupMitologico } from "./mitologico";
import {
  createUnavailableSource,
  LOOKUP_SOURCE_IDS,
} from "./lookup-source-config";
import {
  readPersistentLookupCache,
  writePersistentLookupCache,
} from "./persistent-lookup-cache";
import { lookupPriberam } from "./priberam";
import { lookupPorto } from "./porto";
import { lookupLatinTables } from "./latin-tables";
import { lookupTreccani } from "./treccani";
import { lookupWikipedia } from "./wikipedia";
import { lookupWebster } from "./webster";
import { lookupWiktionary } from "./wiktionary";
import type {
  LookupContext,
  DictionarySourceId,
  DictionarySourceResult,
  LookupPayload,
} from "./lookup-types";

const SOURCE_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const SOURCE_CACHE_VERSION = "2026-06-15-mathesis-persistent-cache-v1";
const PERSISTENT_SOURCE_CACHE_SCHEMA = "mathesis-source-cache-stable-v1";
const SOURCE_CACHE_VERSION_BY_SOURCE: Partial<Record<DictionarySourceId, string>> = {
  aulete: "2026-06-23-aulete-canonical-guard-v2",
  etimologia: "2026-07-04-etymology-language-aware-v1",
  faria: "2026-06-27-faria-v2",
  porto: "2026-07-01-porto-v14",
  tabelas: "2026-07-02-tabelas-latinas-v10",
  gramatica: "2026-07-07-gramatica-pt-clean-copy-v32",
  infopedia: "2026-07-09-infopedia-pt-related-v1",
  logeion: "2026-07-09-logeion-rich-html-v11",
  mitologico: "2026-07-06-mitologico-en-stopwords-v9",
  wikipedia: "2026-07-06-wikipedia-v8",
  imagens: "2026-07-07-images-proxy-all-v9",
  johnson: "2026-07-07-johnson-structured-v6",
  webster: "2026-07-07-webster-structured-v7",
  wiktionary: "2026-07-07-wiktionary-structured-v11",
  english_analogico: "2026-07-06-english-analogico-v2",
  infopedia_dept: "2026-07-04-infopedia-dept-v1",
  infopedia_de: "2026-07-04-infopedia-de-v1",
  infopedia_en: "2026-07-07-infopedia-en-clean-headword-v11",
  infopedia_enpt: "2026-07-07-infopedia-enpt-clean-headword-v11",
  infopedia_espt: "2026-07-04-infopedia-espt-v1",
  infopedia_es: "2026-07-04-infopedia-es-v1",
  infopedia_frpt: "2026-07-04-infopedia-frpt-v1",
  infopedia_fr: "2026-07-04-infopedia-fr-v1",
  infopedia_itpt: "2026-07-04-infopedia-itpt-v1",
  infopedia_it: "2026-07-04-infopedia-it-v1",
  treccani: "2026-07-04-treccani-v1",
  corpus: "2026-07-09-corpus-classical-highlight-v14",
  analogico: "2026-06-20-analogia-label-v4",
};

const SOURCE_LOOKUPS: Record<
  DictionarySourceId,
  (word: string, context?: LookupContext) => Promise<DictionarySourceResult>
> = {
  analogico: lookupAnalogico,
  aulete: lookupAulete,
  corpus: lookupClassicCorpus,
  etimologia: lookupEtymologyAi,
  faria: lookupFaria,
  porto: lookupPorto,
  tabelas: lookupLatinTables,
  gramatica: lookupGrammarLocal,
  imagens: lookupImages,
  infopedia_dept: (word) => lookupInfopediaBilingual(word, "de"),
  infopedia_de: (word) => lookupInfopediaMonolingual(word, "de"),
  infopedia_en: lookupInfopediaEnglish,
  infopedia_enpt: lookupInfopediaEnPt,
  infopedia_espt: (word) => lookupInfopediaBilingual(word, "es"),
  infopedia_es: (word) => lookupInfopediaMonolingual(word, "es"),
  infopedia_frpt: (word) => lookupInfopediaBilingual(word, "fr"),
  infopedia_fr: (word) => lookupInfopediaMonolingual(word, "fr"),
  infopedia_itpt: (word) => lookupInfopediaBilingual(word, "it"),
  infopedia_it: (word) => lookupInfopediaMonolingual(word, "it"),
  infopedia: lookupInfopedia,
  johnson: lookupJohnson,
  treccani: lookupTreccani,
  english_analogico: lookupEnglishAnalogico,
  webster: lookupWebster,
  wiktionary: lookupWiktionary,
  logeion: lookupLogeion,
  mitologico: lookupMitologico,
  priberam: lookupPriberam,
  wikipedia: lookupWikipedia,
};

type SourceCacheEntry = {
  expiresAt: number;
  value: DictionarySourceResult;
};

declare global {
  var __lookupSourceCache: Map<string, SourceCacheEntry> | undefined;
}

function getLookupSourceCache() {
  if (!globalThis.__lookupSourceCache) {
    globalThis.__lookupSourceCache = new Map<string, SourceCacheEntry>();
  }

  return globalThis.__lookupSourceCache;
}

function buildSourceCacheKey(
  requestedWord: string,
  sourceId: DictionarySourceId,
  contextFingerprint = "",
) {
  const sourceVersion = SOURCE_CACHE_VERSION_BY_SOURCE[sourceId] ?? SOURCE_CACHE_VERSION;
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        requestedWord.toLocaleLowerCase("pt-BR"),
        contextFingerprint.toLocaleLowerCase("pt-BR"),
      ]),
    )
    .digest("hex");

  return `${sourceVersion}:${sourceId}:${digest}`;
}

function buildPersistentSourceCacheKey(
  requestedWord: string,
  sourceId: DictionarySourceId,
  contextFingerprint = "",
) {
  const sourceVersion = SOURCE_CACHE_VERSION_BY_SOURCE[sourceId] ?? SOURCE_CACHE_VERSION;
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        requestedWord.toLocaleLowerCase("pt-BR"),
        contextFingerprint.toLocaleLowerCase("pt-BR"),
      ]),
    )
    .digest("hex");

  return [
    PERSISTENT_SOURCE_CACHE_SCHEMA,
    sourceVersion,
    sourceId,
    digest,
  ].join(":");
}

function buildContextFingerprint(context?: LookupContext) {
  return [
    context?.documentAuthor,
    context?.documentLanguage,
    context?.documentTitle,
    context?.documentLabel,
  ]
    .map((value) =>
      (value ?? "")
        .normalize("NFC")
        .replace(/[\u0000-\u001f\u007f]/gu, " ")
        .replace(/\s+/gu, " ")
        .trim()
        .slice(0, 240),
    )
    .join("|");
}

const CONTEXT_SENSITIVE_SOURCE_IDS = new Set<DictionarySourceId>([
  "corpus",
  "etimologia",
  "faria",
  "gramatica",
  "imagens",
  "logeion",
  "porto",
  "tabelas",
]);

function getCacheContext(sourceId: DictionarySourceId, context?: LookupContext) {
  return CONTEXT_SENSITIVE_SOURCE_IDS.has(sourceId)
    ? buildContextFingerprint(context)
    : "";
}

const VOLATILE_MISS_SOURCE_IDS = new Set<DictionarySourceId>([
  "aulete",
  "faria",
  "priberam",
  "porto",
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
  "johnson",
  "treccani",
  "webster",
  "wiktionary",
  "logeion",
  "wikipedia",
]);
const MITOLOGICO_CACHE_NOISE_RE =
  /\b(?:por xemplo|por exmplo|seu oema|oema De natura rerum|ltrodu(?:cao|ção)|conurso|sui unica|uni ca|proriamente|lágica|0\\\.)\b/iu;
const PEITO_IMAGE_NOISE_RE =
  /\b(?:mala de viagem|enviar correio|advocacia|arrecadacao|assistencia medica|bravura)\b/iu;
const FEBO_IMAGE_NOISE_RE =
  /\b(?:alimento|sanduiche|almoco|14 fevereiro|amsterdam|anoitecer)\b/iu;
const FEBO_IMAGE_SIGNAL_RE =
  /\b(?:apolo|apollo|phoebus|deus|greg[oa]|escultura|estatua|classica|classico|marmore|busto)\b/iu;
const MITOLOGICO_SPANISH_RE =
  /\b(?:hijo|hija|donde|mientras|llamad[oa]|estaba|habia|solo|asi|diosa)\b/iu;
const MITOLOGICO_HARD_REJECTION_RE =
  /(?:[ÃÂ]|\b[iÃí]teto\b|\bepep[iÃí]teto\b|leus|mit[oÃó]no|rno nome|ue muitas vezes|\u00c3\u0083\u00c2[\u0080-\u00bf])/iu;

function shouldPersistSourceResult(
  sourceId: DictionarySourceId,
  result: DictionarySourceResult,
) {
  if (sourceId === "mitologico") {
    return result.status === "found";
  }

  if (result.status === "found") {
    return true;
  }

  if (result.status !== "not_found") {
    return false;
  }

  return !VOLATILE_MISS_SOURCE_IDS.has(sourceId);
}

function shouldReuseSourceResult(
  requestedWord: string,
  sourceId: DictionarySourceId,
  result: DictionarySourceResult,
) {
  if (result.status !== "found") {
    if (result.status !== "not_found") {
      return false;
    }

    return !VOLATILE_MISS_SOURCE_IDS.has(sourceId) && sourceId !== "mitologico";
  }

  if (sourceId === "analogico") {
    return result.label === "Analogia";
  }

  if (sourceId === "mitologico" && result.status === "found") {
    const combined = result.sections
      .map((section) => normalizeInlineText(section.text ?? section.html ?? ""))
      .join("\n");
    return (
      !MITOLOGICO_CACHE_NOISE_RE.test(combined) &&
      !MITOLOGICO_SPANISH_RE.test(combined) &&
      !MITOLOGICO_HARD_REJECTION_RE.test(combined)
    );
  }

  if (
    sourceId === "imagens" &&
    result.status === "found" &&
    requestedWord.toLocaleLowerCase("pt-BR") === "peito"
  ) {
    const combined = result.sections
      .map((section) => normalizeInlineText(section.text ?? ""))
      .join("\n")
      .toLocaleLowerCase("pt-BR");
    return !PEITO_IMAGE_NOISE_RE.test(combined);
  }

  if (
    sourceId === "imagens" &&
    result.status === "found" &&
    requestedWord.toLocaleLowerCase("pt-BR") === "febo"
  ) {
    const combined = result.sections
      .map((section) => normalizeInlineText(section.text ?? ""))
      .join("\n")
      .toLocaleLowerCase("pt-BR");
    return FEBO_IMAGE_SIGNAL_RE.test(combined) && !FEBO_IMAGE_NOISE_RE.test(combined);
  }

  return true;
}

async function readSourceFromPersistentCache(
  requestedWord: string,
  sourceId: DictionarySourceId,
  stableKey: string,
  legacyVersionedKey: string,
) {
  const stableValue =
    await readPersistentLookupCache<DictionarySourceResult>(stableKey);

  if (
    stableValue &&
    shouldReuseSourceResult(requestedWord, sourceId, stableValue)
  ) {
    return stableValue;
  }

  const legacyValue =
    stableKey === legacyVersionedKey
      ? null
      : await readPersistentLookupCache<DictionarySourceResult>(legacyVersionedKey);

  if (
    !legacyValue ||
    !shouldReuseSourceResult(requestedWord, sourceId, legacyValue)
  ) {
    return null;
  }

  await writePersistentLookupCache(stableKey, legacyValue);
  return legacyValue;
}

export async function lookupSource(
  word: string,
  sourceId: DictionarySourceId,
  context?: LookupContext,
): Promise<DictionarySourceResult> {
  const requestedWord = normalizeInlineText(word.normalize("NFC"));
  const cache = getLookupSourceCache();
  const cacheContext = getCacheContext(sourceId, context);
  const cacheKey = buildSourceCacheKey(
    requestedWord,
    sourceId,
    cacheContext,
  );
  const persistentCacheKey = buildPersistentSourceCacheKey(
    requestedWord,
    sourceId,
    cacheContext,
  );
  const cached = cache.get(cacheKey);

  if (
    cached &&
    cached.expiresAt > Date.now() &&
    shouldReuseSourceResult(requestedWord, sourceId, cached.value)
  ) {
    return cached.value;
  }

  const persistentCached =
    await readSourceFromPersistentCache(
      requestedWord,
      sourceId,
      persistentCacheKey,
      cacheKey,
    );

  if (persistentCached) {
    cache.set(cacheKey, {
      expiresAt: Date.now() + SOURCE_CACHE_TTL_MS,
      value: persistentCached,
    });

    return persistentCached;
  }

  const result = await SOURCE_LOOKUPS[sourceId](requestedWord, context);
  const shouldMemoize = shouldReuseSourceResult(requestedWord, sourceId, result);

  if (shouldMemoize) {
    cache.set(cacheKey, {
      expiresAt: Date.now() + SOURCE_CACHE_TTL_MS,
      value: result,
    });
  }

  if (shouldPersistSourceResult(sourceId, result)) {
    await writePersistentLookupCache(persistentCacheKey, result);
  }

  return result;
}

export async function lookupAllSources(
  word: string,
  context?: LookupContext,
): Promise<LookupPayload> {
  const requestedWord = normalizeInlineText(word.normalize("NFC"));
  const sourceIds = getLookupSourceIdsForWord(requestedWord, context);
  const entries = await Promise.allSettled(
    sourceIds.map((sourceId) => lookupSource(requestedWord, sourceId, context)),
  );

  const sources = sourceIds.map((sourceId, index) => {
    const entry = entries[index];

    if (entry?.status === "fulfilled") {
      return entry.value;
    }

    return createUnavailableSource(requestedWord, sourceId);
  });

  return {
    displayWord: requestedWord,
    requestedWord,
    sources,
  };
}
