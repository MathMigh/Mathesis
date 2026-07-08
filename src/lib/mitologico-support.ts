import { readFile } from "node:fs/promises";
import path from "node:path";

import { normalizeInlineText, normalizeLineText } from "./dictionary-utils";
import type { MitologicoEntry } from "./mitologico-data";

export type MitologicoSupportBlock = {
  label: string;
  text: string;
};

export type MitologicoSupportExactEntry = {
  blocks: MitologicoSupportBlock[];
  canonicalTerm: string;
  fallbackText: string | null;
};

type SupportPage = {
  bookPage: number;
  pdfPage: number;
  side?: "left" | "right";
  text: string;
};

type SupportPayload = {
  mode: string;
  pageCount: number;
  pages: SupportPage[];
  sourcePdfName: string;
};

type IndexedSupportPage = SupportPage & {
  chartPenalty: number;
  normalizedText: string;
  searchTokens: string[];
};

type LoadedSupportPayload = Omit<SupportPayload, "pages"> & {
  pages: IndexedSupportPage[];
  pagesByBookPage: Map<number, IndexedSupportPage>;
  tokenIndex: Map<string, IndexedSupportPage[]>;
};

type LoadedMitologicoSupport = {
  primeiro: LoadedSupportPayload;
  segundo: LoadedSupportPayload;
};

export type MitologicoSupportContext = {
  blocks: MitologicoSupportBlock[];
  fallbackText: string | null;
};

declare global {
  var __mitologicoSupportPromise: Promise<LoadedMitologicoSupport> | undefined;
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR");
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => normalizeInlineText(value)).filter(Boolean))];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function buildIndexedSupportPage(page: SupportPage): IndexedSupportPage {
  const cleanText = normalizeLineText(page.text);
  const normalizedText = normalizeSearchText(cleanText);
  const searchTokens = [
    ...new Set(normalizedText.split(/[^a-z0-9]+/u).filter((token) => token.length >= 4)),
  ];
  const chartPenalty =
    /\bquadro geneal[oó]gico\b/iu.test(cleanText) || /[|]{2,}|[-–—]{4,}/u.test(cleanText)
      ? 80
      : 0;

  return {
    ...page,
    chartPenalty,
    normalizedText,
    searchTokens,
  };
}

function buildSupportPageMap(pages: IndexedSupportPage[]) {
  return new Map(pages.map((page) => [page.bookPage, page]));
}

function buildSupportTokenIndex(pages: IndexedSupportPage[]) {
  const tokenIndex = new Map<string, IndexedSupportPage[]>();

  for (const page of pages) {
    for (const token of page.searchTokens) {
      const current = tokenIndex.get(token);

      if (current) {
        current.push(page);
      } else {
        tokenIndex.set(token, [page]);
      }
    }
  }

  return tokenIndex;
}

function hydrateSupportPayload(payload: SupportPayload): LoadedSupportPayload {
  const pages = payload.pages.map(buildIndexedSupportPage);

  return {
    ...payload,
    pages,
    pagesByBookPage: buildSupportPageMap(pages),
    tokenIndex: buildSupportTokenIndex(pages),
  };
}

async function readSupportJsonFile(filename: string) {
  const filePath = path.join(process.cwd(), "data", "mitologico-support", filename);
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw) as SupportPayload;
}

function buildHeadingRegexes(term: string) {
  return [
    new RegExp(`(^|\\n)\\*?\\s*${escapeRegExp(term)}(?:[\\s.:(\\-]|$)`, "u"),
    new RegExp(`\\b${escapeRegExp(term)}\\.\\s+${escapeRegExp(term)}\\b`, "u"),
    new RegExp(`\\b${escapeRegExp(term)}\\.\\s+[a-z]`, "u"),
  ];
}

function cleanSupportHeadingLine(line: string) {
  return normalizeInlineText(line)
    .replace(/^\d+\s*/u, "")
    .replace(/^[•*]\s*/u, "")
    .trim();
}

function extractCanonicalTermFromHeadingLine(line: string) {
  const cleaned = cleanSupportHeadingLine(line);
  const match = cleaned.match(
    /^([A-ZÀ-Ý][A-ZÀ-Ýa-zà-ÿ' -]{1,80}?)(?:\.\s|\.$|\s*\(|:\s|$)/u,
  );

  return match?.[1] ? normalizeInlineText(match[1]) : null;
}

function matchesExactHeadingLine(line: string, terms: string[]) {
  const cleaned = cleanSupportHeadingLine(line);

  if (!cleaned) {
    return false;
  }

  const normalizedLine = normalizeSearchText(cleaned);

  return terms.some((term) => {
    const normalizedTerm = normalizeSearchText(term);

    if (!normalizedTerm) {
      return false;
    }

    return (
      normalizedLine === normalizedTerm ||
      normalizedLine.startsWith(`${normalizedTerm}. (`) ||
      normalizedLine.startsWith(`${normalizedTerm}. ${normalizedTerm}`) ||
      normalizedLine.startsWith(`${normalizedTerm} (`) ||
      normalizedLine.startsWith(`${normalizedTerm}:`) ||
      normalizedLine.startsWith(`${normalizedTerm}: ${normalizedTerm}`)
    );
  });
}

function extractHeadingStem(line: string) {
  const cleaned = cleanSupportHeadingLine(line);

  if (!cleaned || cleaned.length > 110) {
    return null;
  }

  if (/^[a-zà-ÿ]/u.test(cleaned) || /^[,.;:!?]/u.test(cleaned)) {
    return null;
  }

  if (/\b(?:quadro|cf\.|v\.|fig\.)\b/iu.test(cleaned)) {
    return null;
  }

  const directMatch = cleaned.match(
    /^([A-ZÀ-Ý][A-ZÀ-Ýa-zà-ÿ' -]{1,80}?)(?:\.\s|:\s|\.$|:$|\s*\(|$)/u,
  );

  if (!directMatch?.[1]) {
    return null;
  }

  const candidate = normalizeInlineText(directMatch[1]).trim();
  const words = candidate.split(/\s+/u).filter(Boolean);

  if (words.length === 0 || words.length > 7) {
    return null;
  }

  return candidate;
}

function isLikelyHeadingBoundaryLine(line: string, terms: string[]) {
  const stem = extractHeadingStem(line);

  if (!stem) {
    return false;
  }

  const normalizedStem = normalizeSearchText(stem);

  if (!normalizedStem) {
    return false;
  }

  return !terms.some((term) => normalizeSearchText(term) === normalizedStem);
}

function findNextHeadingIndex(text: string, startIndex: number) {
  const nextHeadingMatch = text
    .slice(startIndex + 1)
    .match(/\n\s*(?:[•*]\s*)?[A-ZÀ-Ý][A-ZÀ-Ý .,'()/-]{2,40}\./u);

  if (nextHeadingMatch?.index === undefined) {
    return null;
  }

  return startIndex + 1 + nextHeadingMatch.index;
}

function extractSnippet(text: string, terms: string[]) {
  const cleanText = normalizeLineText(text);

  if (!cleanText) {
    return null;
  }

  const normalizedText = normalizeSearchText(cleanText);
  const normalizedTerms = uniqueStrings(terms)
    .map((term) => normalizeSearchText(term))
    .filter(Boolean);
  const headingRegexes = normalizedTerms.flatMap(buildHeadingRegexes);
  let bestHeadingIndex = Number.POSITIVE_INFINITY;

  for (const headingRegex of headingRegexes) {
    const headingMatch = normalizedText.match(headingRegex);

    if (
      headingMatch &&
      headingMatch.index !== undefined &&
      headingMatch.index < bestHeadingIndex
    ) {
      bestHeadingIndex = headingMatch.index;
    }
  }

  let bestIndex = bestHeadingIndex;

  for (const term of normalizedTerms) {
    const index = normalizedText.indexOf(term);

    if (index >= 0 && index < bestIndex) {
      bestIndex = index;
    }
  }

  if (!Number.isFinite(bestIndex)) {
    const paragraphs = cleanText.split(/\n{2,}/u).filter(Boolean);
    return paragraphs[0]?.slice(0, 1100).trim() ?? cleanText.slice(0, 1100).trim();
  }

  const desiredRadius = 760;
  let start = Number.isFinite(bestHeadingIndex)
    ? Math.max(0, bestHeadingIndex)
    : Math.max(0, bestIndex - desiredRadius);
  let end = Math.min(cleanText.length, bestIndex + desiredRadius);

  if (!Number.isFinite(bestHeadingIndex)) {
    const sentenceStart = cleanText.lastIndexOf(". ", start);
    const paragraphStart = cleanText.lastIndexOf("\n", start);
    start = Math.max(
      0,
      sentenceStart >= 0 ? sentenceStart + 2 : 0,
      paragraphStart >= 0 ? paragraphStart + 1 : 0,
    );
  } else {
    const nextHeadingIndex = findNextHeadingIndex(cleanText, bestHeadingIndex);

    if (nextHeadingIndex !== null) {
      return cleanText.slice(start, Math.min(end, nextHeadingIndex)).trim();
    }
  }

  const nextSentence = cleanText.indexOf(". ", end);
  const nextParagraph = cleanText.indexOf("\n", end);
  const candidateEnds = [nextSentence >= 0 ? nextSentence + 1 : cleanText.length];

  if (nextParagraph >= 0) {
    candidateEnds.push(nextParagraph);
  }

  end = Math.min(cleanText.length, ...candidateEnds.filter((value) => value > start));
  return cleanText.slice(start, end).trim();
}

function extractExactEntrySnippetFromPages(
  pages: IndexedSupportPage[],
  terms: string[],
) {
  if (pages.length === 0) {
    return null;
  }

  const cleanText = normalizeLineText(pages.map((page) => page.text).join("\n"));

  if (!cleanText) {
    return null;
  }

  let bestStart: number | null = null;

  for (const term of terms) {
    const cleanedTerm = normalizeInlineText(term);

    if (!cleanedTerm) {
      continue;
    }

    const headingPattern = new RegExp(
      `(?:^|\\n)\\s*${escapeRegExp(cleanedTerm)}\\.\\s*(?:\\([^\\n)]{0,120}\\)\\s*)?`,
      "iu",
    );
    const match = headingPattern.exec(cleanText);

    if (match?.index !== undefined && (bestStart === null || match.index < bestStart)) {
      bestStart = match.index;
    }
  }

  if (bestStart === null) {
    return extractSnippet(cleanText, terms);
  }

  const body = cleanText.slice(bestStart).trimStart();
  const nextHeadingPattern =
    /\n\s*(?:[•*]\s*)?[A-ZÀ-Ý][A-ZÀ-Ý' -]{2,48}\.\s*(?:\(|[A-ZÀ-Ý])/u;
  const nextHeadingMatch = nextHeadingPattern.exec(body.slice(1));
  const endIndex =
    nextHeadingMatch?.index !== undefined
      ? 1 + nextHeadingMatch.index
      : body.length;

  return body.slice(0, endIndex).trim() || null;
}

function scoreSupportPage(
  page: IndexedSupportPage,
  primaryTerms: string[],
  secondaryTerms: string[],
) {
  const haystack = page.normalizedText;
  let score = Number.NEGATIVE_INFINITY;

  for (const term of primaryTerms) {
    const needle = normalizeSearchText(term);

    if (!needle) {
      continue;
    }

    for (const headingRegex of buildHeadingRegexes(needle)) {
      const headingMatch = haystack.match(headingRegex);

      if (headingMatch && headingMatch.index !== undefined) {
        score = Math.max(score, 520 - headingMatch.index / 12 - page.chartPenalty);
        break;
      }
    }

    if (score >= 520 - page.chartPenalty - 200) {
      continue;
    }

    const index = haystack.indexOf(needle);

    if (index >= 0) {
      score = Math.max(score, 200 - Math.min(index, 1200) / 20 - page.chartPenalty);
    }
  }

  for (const term of secondaryTerms) {
    const needle = normalizeSearchText(term);

    if (!needle) {
      continue;
    }

    const index = haystack.indexOf(needle);

    if (index >= 0) {
      score = Math.max(score, 110 - Math.min(index, 1500) / 30 - page.chartPenalty);
    }
  }

  return score;
}

function buildSupportSearchTokens(terms: string[]) {
  return uniqueStrings(terms)
    .flatMap((term) => normalizeSearchText(term).split(/[^a-z0-9]+/u))
    .filter((token) => token.length >= 4);
}

function getCandidateSupportPages(
  payload: LoadedSupportPayload,
  primaryTerms: string[],
  secondaryTerms: string[],
) {
  const tokens = [...new Set(buildSupportSearchTokens([...primaryTerms, ...secondaryTerms]))];

  if (tokens.length === 0) {
    return payload.pages;
  }

  const pages = new Map<number, IndexedSupportPage>();

  for (const token of tokens) {
    const indexedPages = payload.tokenIndex.get(token) ?? [];

    for (const page of indexedPages) {
      pages.set(page.bookPage, page);

      for (const offset of [-2, -1, 1, 2]) {
        const neighbor = payload.pagesByBookPage.get(page.bookPage + offset);

        if (neighbor) {
          pages.set(neighbor.bookPage, neighbor);
        }
      }
    }
  }

  return pages.size > 0 ? [...pages.values()] : payload.pages;
}

function collectSupportBlocks(
  payload: LoadedSupportPayload,
  labelPrefix: string,
  primaryTerms: string[],
  secondaryTerms: string[],
) {
  const rankedPages = getCandidateSupportPages(payload, primaryTerms, secondaryTerms)
    .map((page) => ({
      page,
      score: scoreSupportPage(page, primaryTerms, secondaryTerms),
    }))
    .filter((item) => Number.isFinite(item.score))
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);
  const blocks: MitologicoSupportBlock[] = [];

  for (const item of rankedPages) {
    const { page } = item;
    const snippet = extractSnippet(page.text, [...primaryTerms, ...secondaryTerms]);

    if (!snippet) {
      continue;
    }

    blocks.push({
      label: `${labelPrefix} · p. ${page.bookPage}`,
      text: snippet,
    });
  }

  return blocks;
}

function combineBlockTexts(blocks: MitologicoSupportBlock[]) {
  const uniqueTexts = [
    ...new Set(
      blocks
        .map((block) => normalizeInlineText(block.text))
        .filter(Boolean),
    ),
  ];

  if (uniqueTexts.length === 0) {
    return null;
  }

  return uniqueTexts.join("\n\n");
}

function scoreExactSupportBlock(block: MitologicoSupportBlock) {
  const text = normalizeInlineText(block.text);
  const citationPenalty = /\b(?:Apollod|Pausan|Tzetz|Diod|Virg|Ov|Hom|Hes)\b/iu.test(text)
    ? 180
    : 0;
  const mojibakePenalty = /[ÃƒÃ‚ï¿½]/u.test(text) ? 220 : 0;
  return text.length - citationPenalty - mojibakePenalty;
}

function pickStrongestSupportBlocks(blocks: MitologicoSupportBlock[], limit = 1) {
  return [...blocks]
    .sort((left, right) => scoreExactSupportBlock(right) - scoreExactSupportBlock(left))
    .slice(0, limit);
}

function extractSnippetFromPageRange(
  pages: IndexedSupportPage[],
  terms: string[],
) {
  if (pages.length === 0) {
    return null;
  }

  const lines = pages.flatMap((page) =>
    normalizeLineText(page.text)
      .split(/\n+/u)
      .map((line) => ({
        line: normalizeInlineText(line),
        page: page.bookPage,
      }))
      .filter((item) => item.line),
  );

  if (lines.length === 0) {
    return null;
  }

  const startIndex = lines.findIndex((item) => matchesExactHeadingLine(item.line, terms));

  if (startIndex < 0) {
    return null;
  }

  let endIndex = lines.length;

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (isLikelyHeadingBoundaryLine(lines[index].line, terms)) {
      endIndex = index;
      break;
    }
  }

  const bodyLines = lines.slice(startIndex, endIndex).map((item) => item.line);

  while (
    bodyLines.length > 1 &&
    isLikelyHeadingBoundaryLine(bodyLines[bodyLines.length - 1] ?? "", terms)
  ) {
    bodyLines.pop();
  }

  const snippet = bodyLines.join("\n").trim();

  return snippet || null;
}

function collectRangeSupportBlocks(
  payload: LoadedSupportPayload,
  labelPrefix: string,
  pageStart: number,
  pageEnd: number,
  terms: string[],
) {
  const pages: IndexedSupportPage[] = [];

  for (let pageNumber = pageStart; pageNumber <= pageEnd + 1; pageNumber += 1) {
    const page = payload.pagesByBookPage.get(pageNumber);

    if (page) {
      pages.push(page);
    }
  }

  const snippet = extractSnippetFromPageRange(pages, terms);

  if (!snippet) {
    return [];
  }

  const maxPage = pages.at(-1)?.bookPage ?? pageEnd;
  const pageLabel =
    pageStart === maxPage ? `p. ${pageStart}` : `pp. ${pageStart}-${maxPage}`;

  return [
    {
      label: `${labelPrefix} · ${pageLabel}`,
      text: snippet,
    },
  ] satisfies MitologicoSupportBlock[];
}

function collectExactHeadingSupportBlocks(
  payload: LoadedSupportPayload,
  labelPrefix: string,
  terms: string[],
) {
  const blocks: MitologicoSupportBlock[] = [];

  for (const page of payload.pages) {
    const hasHeading = normalizeLineText(page.text)
      .split(/\n+/u)
      .some((line) => matchesExactHeadingLine(line, terms));

    if (!hasHeading) {
      continue;
    }

    const rangeBlocks = collectRangeSupportBlocks(
      payload,
      labelPrefix,
      page.bookPage,
      Math.min(page.bookPage + 2, payload.pageCount),
      terms,
    );

    if (rangeBlocks.length > 0) {
      blocks.push(...rangeBlocks);
    }

    if (blocks.length >= 2) {
      break;
    }
  }

  return blocks;
}

function collectExactSupportEntries(
  payload: LoadedSupportPayload,
  labelPrefix: string,
  terms: string[],
) {
  const entries: MitologicoSupportExactEntry[] = [];

  for (const page of payload.pages) {
    const lines = normalizeLineText(page.text).split(/\n+/u);
    const matchedLine = lines.find((line) => matchesExactHeadingLine(line, terms));

    if (!matchedLine) {
      continue;
    }

    const canonicalTerm = extractCanonicalTermFromHeadingLine(matchedLine);

    if (!canonicalTerm) {
      continue;
    }

    const strongestBlocks = collectRangeSupportBlocks(
      payload,
      labelPrefix,
      page.bookPage,
      Math.min(page.bookPage + 8, payload.pageCount),
      [canonicalTerm, ...terms],
    );

    if (strongestBlocks.length === 0) {
      continue;
    }
    entries.push({
      blocks: strongestBlocks,
      canonicalTerm,
      fallbackText: combineBlockTexts(strongestBlocks),
    });
  }

  return entries;
}

function buildSupportBlocks(
  support: LoadedMitologicoSupport,
  primaryTerms: string[],
  secondaryTerms: string[],
) {
  return [
    ...collectSupportBlocks(
      support.primeiro,
      "Grimal [primeiro]",
      primaryTerms,
      secondaryTerms,
    ),
    ...collectSupportBlocks(
      support.segundo,
      "Grimal [segundo]",
      primaryTerms,
      secondaryTerms,
    ),
  ].slice(0, 4);
}

export async function loadMitologicoSupport() {
  if (!globalThis.__mitologicoSupportPromise) {
    globalThis.__mitologicoSupportPromise = Promise.all([
      readSupportJsonFile("primeiro-pages.json"),
      readSupportJsonFile("segundo-pages.json"),
    ]).then(([primeiro, segundo]) => ({
      primeiro: hydrateSupportPayload(primeiro),
      segundo: hydrateSupportPayload(segundo),
    }));
  }

  return globalThis.__mitologicoSupportPromise;
}

export async function getMitologicoSupportContext(
  requestedWord: string,
  entry: MitologicoEntry,
  referenceEntry?: MitologicoEntry | null,
): Promise<MitologicoSupportContext> {
  try {
    const support = await loadMitologicoSupport();
    const primaryTerms = uniqueStrings([
      requestedWord,
      entry.canonicalTerm,
      ...(entry.aliases ?? []),
    ]);
    const rangeBlocks = [
      ...collectRangeSupportBlocks(
        support.primeiro,
        "Grimal [primeiro]",
        entry.startPage,
        entry.endPage,
        primaryTerms,
      ),
      ...collectRangeSupportBlocks(
        support.segundo,
        "Grimal [segundo]",
        entry.startPage,
        entry.endPage,
        primaryTerms,
      ),
    ];

    if (rangeBlocks.length > 0) {
      const strongestRangeBlocks = pickStrongestSupportBlocks(rangeBlocks, 1);
      return {
        blocks: strongestRangeBlocks,
        fallbackText: combineBlockTexts(strongestRangeBlocks),
      };
    }

    const secondaryTerms = uniqueStrings([
      ...(referenceEntry ? [referenceEntry.canonicalTerm, ...(referenceEntry.aliases ?? [])] : []),
    ]);
    const blocks = buildSupportBlocks(support, primaryTerms, secondaryTerms);

    return {
      blocks,
      fallbackText: combineBlockTexts(blocks),
    };
  } catch {
    return {
      blocks: [],
      fallbackText: null,
    };
  }
}

export async function getMitologicoSupportTermContext(
  requestedWord: string,
): Promise<MitologicoSupportContext> {
  try {
    const support = await loadMitologicoSupport();
    const primaryTerms = uniqueStrings([requestedWord]);
    const exactBlocks = [
      ...collectExactHeadingSupportBlocks(
        support.primeiro,
        "Grimal [primeiro]",
        primaryTerms,
      ),
      ...collectExactHeadingSupportBlocks(
        support.segundo,
        "Grimal [segundo]",
        primaryTerms,
      ),
    ];

    if (exactBlocks.length > 0) {
      const strongestExactBlocks = pickStrongestSupportBlocks(exactBlocks, 1);
      return {
        blocks: strongestExactBlocks,
        fallbackText: combineBlockTexts(strongestExactBlocks),
      };
    }

    const blocks = buildSupportBlocks(support, primaryTerms, []);

    return {
      blocks,
      fallbackText: combineBlockTexts(blocks),
    };
  } catch {
    return {
      blocks: [],
      fallbackText: null,
    };
  }
}

export async function getMitologicoSupportExactEntry(
  requestedWord: string,
): Promise<MitologicoSupportExactEntry | null> {
  try {
    const support = await loadMitologicoSupport();
    const primaryTerms = uniqueStrings([requestedWord]);
    const exactEntries = [
      ...collectExactSupportEntries(
        support.primeiro,
        "Grimal [primeiro]",
        primaryTerms,
      ),
      ...collectExactSupportEntries(
        support.segundo,
        "Grimal [segundo]",
        primaryTerms,
      ),
    ];

    if (exactEntries.length === 0) {
      return null;
    }

    return [...exactEntries].sort((left, right) => {
      const leftScore = scoreExactSupportBlock(left.blocks[0]) + (left.fallbackText?.length ?? 0);
      const rightScore =
        scoreExactSupportBlock(right.blocks[0]) + (right.fallbackText?.length ?? 0);
      return rightScore - leftScore;
    })[0] ?? null;
  } catch {
    return null;
  }
}
