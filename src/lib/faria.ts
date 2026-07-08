import { load } from "cheerio";
import {
  htmlFromText,
  normalizeInlineText,
  repairMojibake,
  selectionToText,
} from "./dictionary-utils";
import type { DictionarySourceResult, LookupContext, LookupSection } from "./lookup-types";

const FARIA_SEARCH_URL = "https://www.dicionariolatino.com/search.php";
const FARIA_BASE_URL = "https://www.dicionariolatino.com/";
const USER_AGENT = "Mathesis/1.0 latin dictionary";
const MAX_FARIA_SECTIONS = 12;

function buildResult(
  requestedWord: string,
  status: DictionarySourceResult["status"],
  note: string,
  sections: LookupSection[] = [],
  canonicalWord = requestedWord,
  sourceUrl: string | null = FARIA_BASE_URL,
): DictionarySourceResult {
  return {
    canonicalWord,
    label: "Ernesto Faria",
    note,
    sections,
    sourceId: "faria",
    sourceUrl,
    status,
  };
}

function normalizeLemmaLabel(value: string) {
  return normalizeInlineText((repairMojibake(value) ?? value).replace(/,+$/u, "").trim());
}

function normalizeTextBlock(value: string) {
  return normalizeInlineText(repairMojibake(value) ?? value);
}

function scoreResultMatch(requestedWord: string, label: string, text: string) {
  const needle = requestedWord.toLocaleLowerCase("pt-BR");
  const hayLabel = label.toLocaleLowerCase("pt-BR");
  const hayText = text.toLocaleLowerCase("pt-BR");

  if (hayLabel === needle) {
    return 100;
  }

  if (hayLabel.startsWith(`${needle},`) || hayLabel.startsWith(`${needle} `)) {
    return 80;
  }

  if (hayLabel.startsWith(needle)) {
    return 60;
  }

  if (hayText.includes(`${needle},`) || hayText.includes(`${needle} `)) {
    return 30;
  }

  return 0;
}

export async function lookupFaria(
  word: string,
  context?: LookupContext,
): Promise<DictionarySourceResult> {
  const requestedWord = normalizeInlineText(word.normalize("NFC"));

  const body = new URLSearchParams({ query: requestedWord });
  const response = await fetch(FARIA_SEARCH_URL, {
    body: body.toString(),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "User-Agent": USER_AGENT,
      "X-Requested-With": "XMLHttpRequest",
    },
    method: "POST",
    next: { revalidate: 60 * 60 * 24 * 30 },
  });

  if (!response.ok) {
    return buildResult(
      requestedWord,
      "unavailable",
      "Nao consegui consultar o dicionario latino de Ernesto Faria agora.",
    );
  }

  const html = await response.text();
  const $ = load(html);
  const rawResults = $("li.result").toArray();

  if (rawResults.length === 0) {
    return buildResult(
      requestedWord,
      "not_found",
      `Nao encontrei um verbete direto para "${requestedWord}" no dicionario de Ernesto Faria.`,
    );
  }

  const rankedResults = rawResults
    .map((result) => {
      const item = $(result);
      const label = normalizeLemmaLabel(item.find("h3").text());
      const text = normalizeTextBlock(selectionToText($, item.find("h4")));
      const href = item.find("a").attr("href");
      const score = scoreResultMatch(requestedWord, label, text);

      return {
        href,
        label,
        score,
        text,
      };
    })
    .filter((entry) => entry.text)
    .sort((left, right) => right.score - left.score);

  if (rankedResults.length === 0) {
    return buildResult(
      requestedWord,
      "not_found",
      `Nao encontrei um verbete legivel para "${requestedWord}" no dicionario de Ernesto Faria.`,
    );
  }

  const strongestScore = rankedResults[0]?.score ?? 0;
  const bestResults =
    strongestScore > 0
      ? rankedResults
          .filter((entry) => entry.score >= Math.max(30, strongestScore))
          .slice(0, MAX_FARIA_SECTIONS)
      : rankedResults.slice(0, MAX_FARIA_SECTIONS);
  const canonicalWord = bestResults[0]?.label || requestedWord;
  const sourceUrl = bestResults[0]?.href
    ? new URL(bestResults[0].href, FARIA_BASE_URL).toString()
    : FARIA_BASE_URL;

  const sections: LookupSection[] = bestResults.map((entry, index) => ({
    html: htmlFromText(entry.text),
    label: entry.label || `Resultado ${index + 1}`,
    text: entry.text,
  }));

  return buildResult(
    requestedWord,
    "found",
    strongestScore > 0
      ? "Verbete do dicionario latino de Ernesto Faria."
      : "Resultados aproximados do dicionario latino de Ernesto Faria para o radical pesquisado.",
    sections,
    canonicalWord,
    sourceUrl,
  );
}
