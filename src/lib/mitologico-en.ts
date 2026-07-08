import entries from "../../data/mitologico-en/entries.json";
import index from "../../data/mitologico-en/index.json";
import pages from "../../data/mitologico-en/pages.json";
import {
  escapeHtml,
  htmlFromMarkdown,
  normalizeInlineText,
  repairMojibake,
} from "./dictionary-utils";
import type { DictionarySourceResult, LookupSection } from "./lookup-types";

type EnglishMitologicoEntry = {
  aliases?: string[];
  endPage?: number;
  headword: string;
  id: string;
  startPage?: number;
  text: string;
};

type EnglishMitologicoPage = {
  page: number;
  text: string;
};

const ENTRIES = entries as EnglishMitologicoEntry[];
const INDEX = index as Record<string, string[] | undefined>;
const PAGES = pages as EnglishMitologicoPage[];

const ENTRY_BY_ID = new Map(ENTRIES.map((entry) => [entry.id, entry]));
const MAX_ENTRY_TEXT_LENGTH = 50000;
const MAX_ENTRY_PAGE_SPAN = 28;
const GREEKISH_TEXT_PATTERN = /(?:\p{Script=Greek}|Î|Ï|Ά|Έ|Ή|Ί|Ό|Ύ|Ώ|€)/u;
const GREEKISH_PAREN_PATTERN = /[(][^)]*(?:\p{Script=Greek}|Î|Ï|Ά|Έ|Ή|Ί|Ό|Ύ|Ώ|€)[^)]*[)]/u;
const REFERENCE_PAREN_PATTERN = /\b(?:see|table|not|or|and|compare|cf)\b/iu;
const LOOSE_HEADING_KEYS = new Set([
  "janus",
  "latinus",
  "mars",
  "roma",
  "romulus",
  "tellus",
  "venus",
]);

const ALIASES: Record<string, string[]> = {
  argonaut: ["Argonauts"],
  argonauts: ["Argonauts"],
  aeneas: ["Aeneas"],
  eneas: ["Aeneas"],
  eneias: ["Aeneas"],
  febo: ["Phoebus", "Apollo"],
  phoebus: ["Phoebus", "Apollo"],
  apollo: ["Apollo"],
  apolo: ["Apollo"],
  mars: ["Mars", "Ares"],
  marte: ["Mars", "Ares"],
  venus: ["Venus", "Aphrodite"],
};

const NON_MYTHOLOGICAL_ENGLISH_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "has",
  "have",
  "he",
  "her",
  "his",
  "in",
  "into",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "she",
  "that",
  "the",
  "their",
  "them",
  "they",
  "this",
  "to",
  "was",
  "were",
  "with",
]);

function normalizeLookupKey(value: string) {
  return normalizeInlineText(value)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeGreekishText(value: string) {
  return (
    repairMojibake(value) ?? value
  )
    .replace(/\u00ad/g, "")
    .replace(/([A-Za-zÀ-ÖØ-öø-ÿ])-\s+([a-zà-öø-ÿ])/g, "$1$2")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function stripRunningHeaders(value: string) {
  return value
    .replace(/(?:^|\n)\s*[A-Z][A-Z' -]{2,40}\s+\d{1,4}\s*(?=\n|$)/gu, "\n")
    .replace(/(?:^|\n)\s*\d{1,4}\s+[A-Z][A-Z' -]{2,40}\s*(?=\n|$)/gu, "\n");
}

function isLikelyHeadwordParenthesis(value: string) {
  const content = value.match(/[(]([^)]{1,160})[)]/u)?.[1]?.trim() ?? "";

  if (!content && value.includes("(") && GREEKISH_TEXT_PATTERN.test(value)) {
    return true;
  }

  if (!content || REFERENCE_PAREN_PATTERN.test(content)) {
    return false;
  }

  if (/^\d+$|^[ιπvixlcdm]+$/iu.test(content)) {
    return false;
  }

  return GREEKISH_PAREN_PATTERN.test(value) || /^[^\s,;:]{2,40}$/u.test(content);
}

function isPrepositionWrappedContinuation(value: string, matchIndex: number) {
  const before = value.slice(Math.max(0, matchIndex - 28), matchIndex);
  return /\b(?:and|as|at|by|for|from|in|of|on|or|to|with)\s*$/iu.test(before);
}

function getHeadwordOffset(matchText: string, candidate: string) {
  const index = matchText.toLocaleLowerCase("en-US").indexOf(
    candidate.toLocaleLowerCase("en-US"),
  );
  return index >= 0 ? index : 0;
}

function buildSection(text: string, pageLabel: string | null): LookupSection {
  const normalized = normalizeGreekishText(text);
  const header = pageLabel ? `**${pageLabel}**\n\n` : "";

  return {
    html: htmlFromMarkdown(`${header}${normalized}`),
    label: "Verbete",
    text: `${pageLabel ? `${pageLabel}\n\n` : ""}${normalized}`,
  };
}

function buildNamesSection(headword: string, aliases: string[]): LookupSection | null {
  const values = [...new Set([headword, ...aliases].map(normalizeInlineText).filter(Boolean))];

  if (values.length <= 1) {
    return null;
  }

  return {
    html: `
      <article class="analogCategoryCard">
        <h4 class="analogCategoryTitle">Names and variants</h4>
        <div class="analogPillList">
          ${values
            .map(
              (value) =>
                `<button type="button" class="analogPill" data-lookup-word="${escapeHtml(
                  value,
                )}">${escapeHtml(value)}</button>`,
            )
            .join("")}
        </div>
      </article>
    `,
    label: "Names",
    text: values.join(" · "),
  };
}

function buildResult(
  requestedWord: string,
  status: DictionarySourceResult["status"],
  note: string | null,
  canonicalWord = requestedWord,
  sections: LookupSection[] = [],
): DictionarySourceResult {
  return {
    canonicalWord,
    label: "Mitologia",
    note,
    sections,
    sourceId: "mitologico",
    sourceUrl: null,
    status,
  };
}

function candidatesFor(word: string) {
  const cleaned = normalizeInlineText(word.normalize("NFC"));
  const key = normalizeLookupKey(cleaned);

  if (NON_MYTHOLOGICAL_ENGLISH_WORDS.has(key) && !ALIASES[key]) {
    return [];
  }

  return [...new Set([cleaned, ...(ALIASES[key] ?? [])].filter(Boolean))];
}

function findIndexedEntry(candidate: string) {
  const ids = INDEX[normalizeLookupKey(candidate)] ?? [];
  return ids.map((id) => ENTRY_BY_ID.get(id)).find(Boolean) ?? null;
}

function findEntryInPages(candidate: string) {
  const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const strictHeadingPattern = new RegExp(
    `(?:^|\\n|[.!?]\\s+)\\s*${escaped}\\s+[(][^\\n)]{1,160}[)]?\\s+`,
    "giu",
  );
  const looseHeadingPattern = new RegExp(
    `(?:^|\\n)\\s*${escaped}\\s+(?=(?:The|A|An|See|Son|Daughter|One|In)\\b)`,
    "iu",
  );
  const nextStrictHeadingPattern =
    /(?:\n|[.!?]\s+)[A-Z][A-Za-zÀ-ÖØ-öø-ÿ' -]{1,70}\s+[(][^\n)]{1,160}[)]?\s+/gu;
  const nextLooseHeadingPattern =
    /\n(?:Janus|Latinus|Mars|Roma|Romulus|Tellus|Venus)\s+(?=(?:The|A|An|See|Son|Daughter|One|In)\b)/gu;

  const candidateKey = normalizeLookupKey(candidate);
  const allowLooseHeading = LOOSE_HEADING_KEYS.has(candidateKey);

  for (let pageIndex = 0; pageIndex < PAGES.length; pageIndex += 1) {
    const page = PAGES[pageIndex];
    const text = stripRunningHeaders(page.text ?? "");
    const strictMatches = [...text.matchAll(strictHeadingPattern)];
    const match =
      strictMatches.find((candidateMatch) =>
        isLikelyHeadwordParenthesis(candidateMatch[0]),
      ) ?? (allowLooseHeading ? looseHeadingPattern.exec(text) : null);

    if (!match || match.index < 0) {
      continue;
    }

    const start = Math.max(0, match.index + getHeadwordOffset(match[0], candidate));
    const pageSlice = [text.slice(start)];

    for (let nextPageIndex = pageIndex + 1; nextPageIndex < PAGES.length; nextPageIndex += 1) {
      if (nextPageIndex - pageIndex >= MAX_ENTRY_PAGE_SPAN) {
        break;
      }

      pageSlice.push(stripRunningHeaders(PAGES[nextPageIndex]?.text ?? ""));
    }

    const chunk = pageSlice.join("\n").slice(0, MAX_ENTRY_TEXT_LENGTH);
    const headingSearchOffset = Math.max(match[0].length, candidate.length + 10);
    const nextHeadingSlice = chunk.slice(headingSearchOffset);
    const nextStrictHeading = [...nextHeadingSlice.matchAll(nextStrictHeadingPattern)].find(
      (candidateMatch) =>
        isLikelyHeadwordParenthesis(candidateMatch[0]) &&
        !isPrepositionWrappedContinuation(nextHeadingSlice, candidateMatch.index),
    );
    const nextLooseHeading = nextLooseHeadingPattern.exec(nextHeadingSlice);
    const nextHeading =
      nextStrictHeading && nextLooseHeading
        ? nextStrictHeading.index < nextLooseHeading.index
          ? nextStrictHeading
          : nextLooseHeading
        : nextStrictHeading ?? nextLooseHeading;
    const body = nextHeading
      ? chunk.slice(0, Math.max(candidate.length, headingSearchOffset + nextHeading.index))
      : chunk;
    const coveredPages = Math.max(1, Math.ceil(body.length / Math.max(text.length, 1)));

    return {
      aliases: [],
      endPage: PAGES[Math.min(PAGES.length - 1, pageIndex + coveredPages - 1)]?.page ?? page.page,
      headword: candidate,
      id: `page-${page.page}-${normalizeLookupKey(candidate)}`,
      startPage: page.page,
      text: body,
    } satisfies EnglishMitologicoEntry;
  }

  return null;
}

function findEnglishEntry(word: string) {
  for (const candidate of candidatesFor(word)) {
    const fromPages = findEntryInPages(candidate);

    if (fromPages) {
      return fromPages;
    }

    const indexed = findIndexedEntry(candidate);

    if (indexed) {
      return indexed;
    }
  }

  return null;
}

export async function lookupEnglishMitologico(
  word: string,
): Promise<DictionarySourceResult> {
  const requestedWord = normalizeInlineText(word.normalize("NFC"));
  const entry = findEnglishEntry(requestedWord);

  if (!entry) {
    return buildResult(
      requestedWord,
      "not_found",
      `Não encontrei um verbete direto para "${requestedWord}" no dicionário de Pierre Grimal em inglês.`,
    );
  }

  const pageLabel =
    entry.startPage && entry.endPage && entry.startPage !== entry.endPage
      ? `Grimal · p. ${entry.startPage}-${entry.endPage}`
      : entry.startPage
        ? `Grimal · p. ${entry.startPage}`
        : null;
  const sections = [
    buildSection(entry.text, pageLabel),
    buildNamesSection(entry.headword, entry.aliases ?? []),
  ].filter((section): section is LookupSection => Boolean(section));

  return buildResult(
    requestedWord,
    "found",
    "Verbete extraído do Concise Dictionary of Classical Mythology, de Pierre Grimal.",
    entry.headword,
    sections,
  );
}
