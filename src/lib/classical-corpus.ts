import { load } from "cheerio";
import type { Element } from "domhandler";
import {
  escapeHtml,
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

type CleanedContext = {
  html: string | null;
  text: string;
};

function cleanContext(html: string): CleanedContext {
  const $ = load(`<div>${html}</div>`);
  const root = $("div").first();
  const text = selectionToText($, root)
    .replace(/\s+/g, " ")
    .replace(/ \./g, ".")
    .trim();
  const repaired = repairMojibake(text) ?? text;

  root.find("script, style, noscript, svg, iframe, img, button, input").remove();
  root.find("*").each((_, node) => {
    if (node.type !== "tag") {
      return;
    }

    const element = node as Element;
    const current = $(element);
    const tagName = element.tagName.toLowerCase();
    const className = current.attr("class") ?? "";
    const isHit = tagName === "mark" || /\bhighlight\b/i.test(className);

    if (isHit) {
      current.replaceWith(
        `<strong class="corpusSearchHit">${escapeHtml(current.text())}</strong>`,
      );
      return;
    }

    if (tagName === "br") {
      current.replaceWith("<br>");
      return;
    }

    if (!["b", "strong", "i", "em"].includes(tagName)) {
      current.replaceWith(current.contents());
      return;
    }

    for (const attr of Object.keys(element.attribs ?? {})) {
      current.removeAttr(attr);
    }
  });

  if (repaired.length <= MAX_CONTEXT_LENGTH) {
    const contextHtml = repairMojibake(root.html()?.trim() ?? "") ?? "";

    return {
      html: contextHtml ? `<p class="corpusContext">${contextHtml}</p>` : null,
      text: repaired,
    };
  }

  return {
    html: null,
    text: `${repaired.slice(0, MAX_CONTEXT_LENGTH).trim()}...`,
  };
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
      context.text || null,
    ].filter(Boolean) as string[];

    const text = lines.join("\n");
    const metaHtml = [
      author ? `<p class="lookupEntryMeta">Autor: ${escapeHtml(author)}</p>` : null,
      title ? `<p class="lookupEntryMeta">Obra: ${escapeHtml(title)}</p>` : null,
      citation ? `<p class="lookupEntryMeta">Passagem: ${escapeHtml(citation)}</p>` : null,
      genre ? `<p class="lookupEntryMeta">G\u00eanero: ${escapeHtml(genre)}</p>` : null,
    ]
      .filter(Boolean)
      .join("");

    return {
      html: `<article class="lookupEntry corpusHitCard">${metaHtml}${
        context.html ?? htmlFromText(context.text)
      }</article>`,
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
