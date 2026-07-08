import { load } from "cheerio";
import {
  htmlFromText,
  normalizeInlineText,
  repairMojibake,
  selectionToText,
} from "./dictionary-utils";
import { detectLookupLanguage } from "./lookup-language";
import type { DictionarySourceResult, LookupContext, LookupSection } from "./lookup-types";

const LOGEION_API = "https://anastrophe.uchicago.edu/logeion-api";
const USER_AGENT = "Mathesis/1.0 classical corpus";
const MAX_CORPUS_OCCURRENCES = 60;
const MAX_CONTEXT_LENGTH = 1600;

type LogeionFindResponse = {
  parses?: Array<{ lemma?: string; parse?: string }>;
  word?: string;
};

type LogeionCorpusLinkResponse = {
  lemmaSite?: string;
};

type ClassicalCorpusResponse = {
  results?: Array<{
    citation?: Array<{ label?: string; separator?: string }>;
    citation_links?: Record<string, string>;
    context?: string;
    metadata_fields?: {
      author?: string;
      text_genre?: string;
      title?: string;
    };
  }>;
};

function buildResult(
  requestedWord: string,
  status: DictionarySourceResult["status"],
  note: string,
  sections: LookupSection[] = [],
  sourceUrl: string | null = null,
  canonicalWord = requestedWord,
): DictionarySourceResult {
  return {
    canonicalWord,
    label: "Corpus",
    note,
    sections,
    sourceId: "corpus",
    sourceUrl,
    status,
  };
}

async function fetchJson<T>(url: URL) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
    },
    next: { revalidate: 60 * 60 * 24 * 30 },
  });

  if (!response.ok) {
    throw new Error(`Corpus cl\u00e1ssico respondeu com status ${response.status}.`);
  }

  return (await response.json()) as T;
}

async function resolveLemmaCandidate(requestedWord: string) {
  const findUrl = new URL(`${LOGEION_API}/find`);
  findUrl.searchParams.set("w", requestedWord);

  try {
    const payload = await fetchJson<LogeionFindResponse>(findUrl);
    return normalizeInlineText(payload.parses?.[0]?.lemma ?? requestedWord) || requestedWord;
  } catch {
    return requestedWord;
  }
}

async function fetchCorpusPayload(displayedWord: string) {
  const corpusLinkUrl = new URL(`${LOGEION_API}/getCorpusSite`);
  corpusLinkUrl.searchParams.set("displayed", displayedWord);

  const corpusLink = await fetchJson<LogeionCorpusLinkResponse>(corpusLinkUrl);
  const sourceUrl = corpusLink.lemmaSite ?? null;

  if (!sourceUrl) {
    return {
      payload: null,
      sourceUrl: null,
    };
  }

  const corpusUrl = new URL(sourceUrl);
  corpusUrl.searchParams.set("format", "json");

  const payload = await fetchJson<ClassicalCorpusResponse>(corpusUrl);

  return {
    payload,
    sourceUrl,
  };
}

function buildCitationText(
  citation: Array<{ label?: string; separator?: string }> | undefined,
) {
  if (!citation?.length) {
    return "";
  }

  return normalizeInlineText(
    citation.map((part) => `${part.label ?? ""}${part.separator ?? ""}`).join(""),
  );
}

function cleanContext(html: string) {
  const $ = load(`<div>${html}</div>`);
  const text = selectionToText($, $("div"))
    .replace(/\s+/g, " ")
    .replace(/ \./g, ".")
    .trim();
  const repaired = repairMojibake(text) ?? text;

  if (repaired.length <= MAX_CONTEXT_LENGTH) {
    return repaired;
  }

  return `${repaired.slice(0, MAX_CONTEXT_LENGTH).trim()}...`;
}

function buildOccurrenceSections(
  results: ClassicalCorpusResponse["results"],
  baseUrl: string,
) {
  if (!results?.length) {
    return [] as LookupSection[];
  }

  return results.slice(0, MAX_CORPUS_OCCURRENCES).map((result, index) => {
    const author = repairMojibake(normalizeInlineText(result.metadata_fields?.author ?? "")) ?? "";
    const title = repairMojibake(normalizeInlineText(result.metadata_fields?.title ?? "")) ?? "";
    const genre = repairMojibake(normalizeInlineText(result.metadata_fields?.text_genre ?? "")) ?? "";
    const citation = repairMojibake(buildCitationText(result.citation)) ?? "";
    const context = cleanContext(result.context ?? "");
    const lines = [
      author ? `Autor: ${author}` : null,
      title ? `Obra: ${title}` : null,
      citation ? `Passagem: ${citation}` : null,
      genre ? `G\u00eanero: ${genre}` : null,
      context || null,
    ].filter(Boolean) as string[];

    const text = lines.join("\n");

    return {
      html: htmlFromText(text),
      label: String(index + 1),
      text,
    } satisfies LookupSection;
  });
}

export async function lookupClassicalCorpus(
  word: string,
  context?: LookupContext,
): Promise<DictionarySourceResult> {
  const requestedWord = normalizeInlineText(word.normalize("NFC"));
  const language = detectLookupLanguage(requestedWord, context);

  if (language === "portuguese") {
    return buildResult(
      requestedWord,
      "not_found",
      "O corpus cl\u00e1ssico aparece apenas em leituras latinas.",
    );
  }

  if (language !== "latin") {
    return buildResult(
      requestedWord,
      "not_found",
      "Ainda nao ha corpus classico curado para este idioma nesta versao.",
    );
  }

  const lemmaCandidate = await resolveLemmaCandidate(requestedWord);

  const requestedLookup = await fetchCorpusPayload(requestedWord);
  const lemmaLookup =
    lemmaCandidate !== requestedWord
      ? await fetchCorpusPayload(lemmaCandidate)
      : null;

  const requestedSections = buildOccurrenceSections(
    requestedLookup.payload?.results,
    requestedLookup.sourceUrl ?? "",
  );
  const lemmaSections = lemmaLookup
    ? buildOccurrenceSections(lemmaLookup.payload?.results, lemmaLookup.sourceUrl ?? "")
    : [];

  if (requestedSections.length === 0 && lemmaSections.length === 0) {
    return buildResult(
      requestedWord,
      "not_found",
      `N\u00e3o encontrei ocorr\u00eancias aproveit\u00e1veis para "${requestedWord}" no corpus cl\u00e1ssico desta vez.`,
      [],
      requestedLookup.sourceUrl ?? lemmaLookup?.sourceUrl ?? null,
      lemmaCandidate,
    );
  }

  const combinedSections = [...requestedSections];

  for (const section of lemmaSections) {
    if (combinedSections.some((existing) => existing.text === section.text)) {
      continue;
    }

    combinedSections.push(section);
  }

  const sections = combinedSections
    .slice(0, MAX_CORPUS_OCCURRENCES)
    .map((section, index) => ({
      ...section,
      label: String(index + 1),
    }));
  const sourceUrl = requestedLookup.sourceUrl ?? lemmaLookup?.sourceUrl ?? null;

  return buildResult(
    requestedWord,
    "found",
    "Busca de corpus cl\u00e1ssico ao estilo Logeion para latim.",
    sections,
    sourceUrl,
    lemmaSections.length > 0 ? lemmaCandidate : requestedWord,
  );
}
