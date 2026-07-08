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
const USER_AGENT = "Mathesis/1.0 classical lookup";
const MAX_SECTION_TEXT = 20000;

type LogeionFindResponse = {
  description?: string;
  parses?: Array<{ lemma?: string; parse?: string }>;
  word?: string;
};

type LogeionDetailResponse = {
  detail?: {
    dicos?: Array<{ dname?: string; es?: string[] }>;
    headword?: string;
    shortdef?: string[];
  };
  info?: {
    frequency?: Array<{
      authorList?: Array<{ author?: string; authorSearch?: string }>;
      rank?: string;
      word?: string;
    }>;
  };
};

type LogeionFrequencyEntry = NonNullable<
  NonNullable<LogeionDetailResponse["info"]>["frequency"]
>[number];

function buildResult(
  requestedWord: string,
  status: DictionarySourceResult["status"],
  note: string,
  sections: LookupSection[] = [],
  canonicalWord = requestedWord,
): DictionarySourceResult {
  return {
    canonicalWord,
    label: "Logeion",
    note,
    sections,
    sourceId: "logeion",
    sourceUrl: `https://logeion.uchicago.edu/${encodeURIComponent(canonicalWord)}`,
    status,
  };
}

function cleanLogeionHtml(html: string) {
  const $ = load(`<div>${html}</div>`);
  const text = selectionToText($, $("div"));
  return (repairMojibake(text) ?? text).normalize("NFC");
}

function trimSectionText(value: string) {
  const normalized = normalizeInlineText((repairMojibake(value) ?? value).replace(/\s*\n\s*/g, "\n"));

  if (normalized.length <= MAX_SECTION_TEXT) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_SECTION_TEXT).trim()}...`;
}

function buildShortDefSection(shortdefs: string[] | undefined): LookupSection | null {
  if (!shortdefs?.length) {
    return null;
  }

  const text = trimSectionText(shortdefs.map((item) => repairMojibake(item) ?? item).join("\n"));

  return {
    html: htmlFromText(text),
    label: "Definicao rapida",
    text,
  };
}

function buildMorphologySection(
  parses: Array<{ lemma?: string; parse?: string }> | undefined,
): LookupSection | null {
  if (!parses?.length) {
    return null;
  }

  const text = trimSectionText(
    parses
      .map((item) =>
        repairMojibake(normalizeInlineText(`${item.lemma ?? ""} ${item.parse ?? ""}`)) ?? "",
      )
      .filter(Boolean)
      .join("\n"),
  );

  if (!text) {
    return null;
  }

  return {
    html: htmlFromText(text),
    label: "Forma",
    text,
  };
}

function buildExamplesCorpusSection(
  entry: { dname?: string; es?: string[] },
): LookupSection | null {
  const label = normalizeInlineText(entry.dname ?? "");

  if (!label || label !== "Examples from the corpus") {
    return null;
  }

  const $ = load(`<div>${(entry.es ?? []).join("")}</div>`);
  const items = $("li")
    .toArray()
    .map((item) => {
      const node = $(item);
      const author = normalizeInlineText(node.find("as").first().text());
      const work = normalizeInlineText(node.find("ws").first().text());
      const excerptNode = node.clone();

      excerptNode.find("as, ws").remove();

      const rawText =
        repairMojibake(normalizeInlineText(excerptNode.text())) ?? "";

      if (!rawText) {
        return null;
      }

      const lines = [
        rawText,
        author ? `Autor: ${author}` : null,
        work ? `Obra: ${work}` : null,
      ].filter(Boolean) as string[];

      return lines.join("\n");
    })
    .filter((value): value is string => Boolean(value));

  if (items.length === 0) {
    return null;
  }

  const text = trimSectionText(items.join("\n\n"));
  const html = items
    .map((item) => {
      const rendered = htmlFromText(item) ?? "";
      return `<article class="lookupEntry corpusHitCard">${rendered}</article>`;
    })
    .join("");

  return {
    html,
    label,
    text,
  };
}

function buildDictionarySections(
  dicos: Array<{ dname?: string; es?: string[] }> | undefined,
): LookupSection[] {
  if (!dicos?.length) {
    return [];
  }

  return dicos
    .map((entry): LookupSection | null => {
      const label = normalizeInlineText(entry.dname ?? "");
      const corpusExamplesSection = buildExamplesCorpusSection(entry);

      if (corpusExamplesSection) {
        return corpusExamplesSection;
      }

      const text = trimSectionText(
        (entry.es ?? [])
          .map((item) => cleanLogeionHtml(item))
          .filter(Boolean)
          .join("\n\n"),
      );

      if (!label || !text) {
        return null;
      }

      return {
        html: htmlFromText(text),
        label,
        text,
      };
    })
    .filter((section): section is LookupSection => section !== null);
}

function buildFrequencySection(
  frequency: LogeionFrequencyEntry[] | undefined,
): LookupSection | null {
  const first = frequency?.[0];

  if (!first) {
    return null;
  }

  const lines = [
    first.rank ? `Frequencia: ${repairMojibake(first.rank) ?? first.rank}.` : null,
    first.authorList?.length
      ? `Autores recorrentes: ${first.authorList
          .map((item) => repairMojibake(item.author?.trim() ?? "") ?? "")
          .filter(Boolean)
          .slice(0, 6)
          .join(", ")}.`
      : null,
  ].filter(Boolean) as string[];

  if (lines.length === 0) {
    return null;
  }

  const text = trimSectionText(lines.join("\n"));

  return {
    html: htmlFromText(text),
    label: "Frequencia",
    text,
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
    throw new Error(`Logeion respondeu com status ${response.status}.`);
  }

  return (await response.json()) as T;
}

async function fetchDetail(word: string) {
  const detailUrl = new URL(`${LOGEION_API}/detail`);
  detailUrl.searchParams.set("w", word);
  detailUrl.searchParams.set("type", "normal");
  return fetchJson<LogeionDetailResponse>(detailUrl);
}

function scoreDetailPayload(payload: LogeionDetailResponse) {
  const dicoCount = payload.detail?.dicos?.length ?? 0;
  const shortdefCount = payload.detail?.shortdef?.length ?? 0;
  const frequencyCount = payload.info?.frequency?.length ?? 0;
  return dicoCount * 100 + shortdefCount * 10 + frequencyCount;
}

export async function lookupLogeion(
  word: string,
  context?: LookupContext,
): Promise<DictionarySourceResult> {
  const requestedWord = normalizeInlineText(word.normalize("NFC"));
  const preferredLanguage = detectLookupLanguage(requestedWord, context);

  if (preferredLanguage === "portuguese") {
    return buildResult(
      requestedWord,
      "not_found",
      "Digite uma forma latina para consultar o Logeion.",
    );
  }

  const findUrl = new URL(`${LOGEION_API}/find`);
  findUrl.searchParams.set("w", requestedWord);

  const findPayload = await fetchJson<LogeionFindResponse>(findUrl);
  const lemmaCandidate =
    normalizeInlineText(findPayload.parses?.[0]?.lemma ?? requestedWord) || requestedWord;

  const requestedDetailPromise = fetchDetail(requestedWord);
  const lemmaDetailPromise =
    lemmaCandidate !== requestedWord ? fetchDetail(lemmaCandidate) : null;

  const [requestedDetailPayload, lemmaDetailPayload] = await Promise.all([
    requestedDetailPromise,
    lemmaDetailPromise,
  ]);

  const detailPayload =
    lemmaDetailPayload && scoreDetailPayload(lemmaDetailPayload) > scoreDetailPayload(requestedDetailPayload)
      ? lemmaDetailPayload
      : requestedDetailPayload;

  const canonicalWord =
    normalizeInlineText(
      detailPayload.detail?.headword ??
        lemmaCandidate ??
        requestedWord,
    ) || requestedWord;

  const sections = [
    ...buildDictionarySections(detailPayload.detail?.dicos),
    buildShortDefSection(detailPayload.detail?.shortdef),
    buildMorphologySection(findPayload.parses),
    buildFrequencySection(detailPayload.info?.frequency),
  ].filter((section): section is LookupSection => section !== null);

  if (sections.length === 0) {
    return buildResult(
      requestedWord,
      "not_found",
      `O Logeion nao encontrou um verbete direto para "${requestedWord}".`,
      [],
      canonicalWord,
    );
  }

  return buildResult(
    requestedWord,
    "found",
    "Verbete lexical do Logeion para latim.",
    sections,
    canonicalWord,
  );
}
