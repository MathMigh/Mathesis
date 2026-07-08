import {
  decodeHtmlBuffer,
  htmlFromText,
  normalizeInlineText,
  repairMojibake,
} from "./dictionary-utils";
import { buildPortugueseLookupCandidates } from "./portuguese-word-candidates";
import type { DictionarySourceResult } from "./lookup-types";

const INFOPEDIA_ENDPOINT = "https://www.infopedia.pt/dicionarios/lingua-portuguesa/";
const INFOPEDIA_MIRROR_ENDPOINTS = [
  "https://r.jina.ai/http://https://www.infopedia.pt/dicionarios/lingua-portuguesa/",
  "https://r.jina.ai/http://r.jina.ai/http://www.infopedia.pt/dicionarios/lingua-portuguesa/",
];
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0 Safari/537.36";

const STOP_PATTERNS = [
  /^Partilhar$/i,
  /^Como referenciar$/i,
  /^Veja alguns exemplos/i,
  /^Presente do Indicativo/i,
  /^Pret[eÃ©]rito/i,
  /^Futuro do/i,
  /^Imperativo/i,
  /^Conjuga[cÃ§][aÃ£]o/i,
  /^Em destaque$/i,
  /^Refer[eê]ncias a /i,
  /^Sin[oó]nimos de /i,
  /^Ant[oó]nimos de /i,
  /^Tradu[cç][oõ]es de /i,
  /^Rimas com /i,
  /^Anagramas de /i,
  /^Cita[cç][oõ]es com a palavra /i,
  /^Palavras parecidas com /i,
  /^Resultados noutros dicion[aá]rios$/i,
  /^Recomendar$/i,
  /^Artigos$/i,
  /no Dicion[aá]rio Infop[eé]dia/i,
];

const IGNORE_PATTERNS = [
  /^Audio \d+$/i,
  /^Ouvir$/i,
  /^Enviar sugest[aã]o$/i,
  /^Favoritos$/i,
  /^Conjuga[cç][aã]o$/i,
  /^Palavra em destaque /i,
  /^Ver mais$/i,
  /^Portugueses$/i,
  /^Ingleses$/i,
  /^Franceses$/i,
  /^Italianos$/i,
  /^Espanh[oó]is$/i,
  /^L[ií]ngua Portuguesa$/i,
];

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR");
}

function buildResult(
  requestedWord: string,
  status: DictionarySourceResult["status"],
  note: string | null,
  canonicalWord = requestedWord,
  sectionLabel = "Verbete",
  html: string | null = null,
  text: string | null = null,
  lookupWord = canonicalWord,
): DictionarySourceResult {
  return {
    canonicalWord,
    label: "Infop\u00e9dia",
    note,
    sections:
      html || text
        ? [
            {
              html,
              label: sectionLabel,
              text,
            },
          ]
        : [],
    sourceId: "infopedia",
    sourceUrl: `${INFOPEDIA_ENDPOINT}${encodeURIComponent(lookupWord)}`,
    status,
  };
}

function cleanMirrorLine(line: string) {
  const withoutImages = line.replace(/!\[[^\]]*]\([^)]*\)/g, " ");
  const withoutLinks = withoutImages.replace(/\[([^\]]*)]\(([^)]*)\)/g, "$1");
  const withoutMarkup = withoutLinks
    .replace(/^#+\s*/, "")
    .replace(/^\*\s*/, "")
    .replace(/[*_`]/g, " ")
    .replace(/\u200b/g, "")
    .replace(/\bAudio\s+\d+\b/gi, " ")
    .replace(/\(\s*\)/g, " ");
  const repaired = repairMojibake(withoutMarkup) ?? "";
  return normalizeInlineText(repaired);
}

function extractHeadwordCandidate(rawLine: string) {
  const linkedHeadingMatch = rawLine.match(/^#+\s*\[([^\]]+)\]/u);

  if (linkedHeadingMatch?.[1]) {
    return normalizeInlineText(cleanMirrorLine(linkedHeadingMatch[1]));
  }

  const cleaned = cleanMirrorLine(rawLine);

  if (!cleaned) {
    return null;
  }

  return normalizeInlineText(cleaned.split(/\s+\|\s+/u)[0] ?? cleaned);
}

function extractLemmaLine(cleanLines: string[], startIndex: number) {
  for (let index = startIndex; index < cleanLines.length; index += 1) {
    const line = cleanLines[index] ?? "";
    const match = line.match(/\bdo verbo ([\p{L}\p{M}-]+)\b/iu);

    if (match?.[1]) {
      return normalizeInlineText(match[1]);
    }

    if (STOP_PATTERNS.some((pattern) => pattern.test(line))) {
      break;
    }
  }

  return null;
}

function findDictionaryHeadingIndex(rawLines: string[], requestedWord: string) {
  const normalizedRequested = normalizeSearchText(requestedWord);
  let fallbackIndex = -1;

  for (let index = rawLines.length - 1; index >= 0; index -= 1) {
    const rawLine = rawLines[index]?.trim() ?? "";

    if (!rawLine.startsWith("#")) {
      continue;
    }

    const candidate = extractHeadwordCandidate(rawLine);

    if (!candidate) {
      continue;
    }

    if (normalizeSearchText(candidate) === normalizedRequested) {
      if (/^#+\s*\[/u.test(rawLine)) {
        return index;
      }

      if (fallbackIndex === -1) {
        fallbackIndex = index;
      }
    }
  }

  if (fallbackIndex !== -1) {
    return fallbackIndex;
  }

  for (let index = rawLines.length - 1; index >= 0; index -= 1) {
    const rawLine = rawLines[index]?.trim() ?? "";

    if (!rawLine.startsWith("#")) {
      continue;
    }

    const candidate = extractHeadwordCandidate(rawLine);

    if (!candidate) {
      continue;
    }

    for (const lemma of buildPortugueseLookupCandidates(requestedWord)) {
      if (normalizeSearchText(candidate) === normalizeSearchText(lemma)) {
        return index;
      }
    }
  }

  return -1;
}

function findExactLineIndex(cleanLines: string[], expectedLine: string, startIndex: number) {
  const normalizedExpected = normalizeSearchText(expectedLine);

  for (let index = startIndex; index < cleanLines.length; index += 1) {
    if (normalizeSearchText(cleanLines[index] ?? "") === normalizedExpected) {
      return index;
    }
  }

  return -1;
}

function isGrammarLine(line: string) {
  return /^(?:nome|adjetivo|adv[eé]rbio|verbo|determinante|pronome|numeral|preposi[cç][aã]o|conjun[cç][aã]o|interjei[cç][aã]o|locu[cç][aã]o)\b/i.test(
    line,
  );
}

function isNonVerbGrammarLine(line: string) {
  return isGrammarLine(line) && !/^verbo\b/i.test(line);
}

function findLexicalEntryStartIndex(
  cleanLines: string[],
  requestedWord: string,
  startIndex: number,
) {
  const normalizedRequested = normalizeSearchText(requestedWord);

  for (let index = startIndex; index < cleanLines.length; index += 1) {
    const line = cleanLines[index] ?? "";

    if (STOP_PATTERNS.some((pattern) => pattern.test(line))) {
      break;
    }

    if (normalizeSearchText(line) !== normalizedRequested) {
      continue;
    }

    const lookahead = cleanLines.slice(index + 1, index + 7);

    if (
      lookahead.some((candidate) => isGrammarLine(candidate)) &&
      !lookahead.some((candidate) => /\bdo verbo\b/i.test(candidate))
    ) {
      return index;
    }
  }

  return -1;
}

function trimPreludeFromCollectedLines(lines: string[]) {
  const grammarIndex = lines.findIndex((line) => isGrammarLine(line));

  if (grammarIndex === -1) {
    return lines;
  }

  const prelude = lines.slice(0, grammarIndex).join("\n");

  if (!/\bdo verbo\b/i.test(prelude) && !/\b(?:tu|n[oó]s|v[oó]s)\b/i.test(prelude)) {
    return lines;
  }

  return lines.slice(Math.max(0, grammarIndex - 2));
}

function extractCanonicalFromSyllableLine(line: string | undefined) {
  if (!line) {
    return null;
  }

  const firstToken = normalizeInlineText(line.split(/\s+/u)[0] ?? "");

  if (!firstToken.includes(".")) {
    return null;
  }

  const candidate = firstToken.replace(/\./gu, "");

  return /^[\p{L}\p{M}-]{2,}$/u.test(candidate) ? candidate : null;
}

function extractArticleContext(cleanLines: string[], startIndex = 0) {
  const articlesIndex = cleanLines.findIndex(
    (line, index) => index >= startIndex && /^Artigos$/i.test(line),
  );

  if (articlesIndex === -1) {
    return null;
  }

  const collected: string[] = [];

  for (let index = articlesIndex + 1; index < cleanLines.length; index += 1) {
    const line = cleanLines[index] ?? "";

    if (!line) {
      continue;
    }

    if (STOP_PATTERNS.some((pattern) => pattern.test(line))) {
      break;
    }

    if (IGNORE_PATTERNS.some((pattern) => pattern.test(line))) {
      continue;
    }

    if (line.length < 16 || !/\s/u.test(line)) {
      continue;
    }

    collected.push(line);

    if (collected.length >= 5) {
      break;
    }
  }

  return collected.length > 0 ? collected.join("\n") : null;
}

async function fetchMirrorEndpoint(endpoint: string, requestedWord: string) {
  const response = await fetch(
    `${endpoint}${encodeURIComponent(requestedWord)}`,
    {
      cache: "no-store",
      headers: {
        "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
        "user-agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(22000),
    },
  );

  if (!response.ok) {
    throw new Error("Infopedia mirror unavailable");
  }

  const rawText = decodeHtmlBuffer(Buffer.from(await response.arrayBuffer()));
  const text = repairMojibake(rawText) ?? rawText;

  if (text.length < 1000 || /Title:\s*Just a moment/i.test(text)) {
    throw new Error("Infopedia mirror returned blocker page");
  }

  return text;
}

async function fetchMirrorContent(requestedWord: string) {
  try {
    return await Promise.any(
      INFOPEDIA_MIRROR_ENDPOINTS.map((endpoint) =>
        fetchMirrorEndpoint(endpoint, requestedWord),
      ),
    );
  } catch {
    return null;
  }
}

async function lookupInfopediaEntry(
  requestedWord: string,
  lookupWord: string,
): Promise<DictionarySourceResult> {
  const mirrorText = await fetchMirrorContent(lookupWord);

  if (!mirrorText) {
    return buildResult(
      requestedWord,
      "unavailable",
      "Nao consegui consultar a Infopedia nesta tentativa.",
    );
  }

  const rawLines = mirrorText.split("\n");
  const cleanLines = rawLines.map(cleanMirrorLine);
  const notFoundIndex = cleanLines.findIndex((line) =>
    /A palavra pesquisada nao foi encontrada/i.test(normalizeSearchText(line)),
  );

  if (notFoundIndex >= 0) {
    const articleContext = extractArticleContext(cleanLines, notFoundIndex);

    return buildResult(
      requestedWord,
      "not_found",
      articleContext
        ? "A Infopedia nao trouxe verbete direto na Lingua Portuguesa, mas abriu artigos relacionados."
        : "A Infopedia nao apresentou um verbete direto na Lingua Portuguesa para esta palavra.",
      lookupWord,
      articleContext ? "Contexto" : "Verbete",
      htmlFromText(articleContext),
      articleContext,
      lookupWord,
    );
  }

  const headingIndex = findDictionaryHeadingIndex(rawLines, lookupWord);

  if (headingIndex === -1) {
    return buildResult(
      requestedWord,
      "unavailable",
      "Nao consegui localizar o miolo do verbete da Infopedia desta vez.",
    );
  }

  const headingWord = extractHeadwordCandidate(rawLines[headingIndex] ?? "") ?? lookupWord;
  const lexicalEntryStartIndex = findLexicalEntryStartIndex(
    cleanLines,
    lookupWord,
    headingIndex + 1,
  );
  const lemma =
    lexicalEntryStartIndex >= 0
      ? null
      : extractLemmaLine(cleanLines, headingIndex + 1);
  const canonicalWord = lexicalEntryStartIndex >= 0 ? lookupWord : lemma || headingWord;
  const lemmaLineIndex = lemma
    ? findExactLineIndex(cleanLines, lemma, headingIndex + 1)
    : -1;
  const contentStartIndex =
    lexicalEntryStartIndex >= 0
      ? lexicalEntryStartIndex + 1
      : lemmaLineIndex >= 0
        ? lemmaLineIndex + 1
        : headingIndex + 1;
  const collectedLines: string[] = [];

  for (let index = contentStartIndex; index < cleanLines.length; index += 1) {
    const line = cleanLines[index] ?? "";

    if (!line) {
      continue;
    }

    if (STOP_PATTERNS.some((pattern) => pattern.test(line))) {
      break;
    }

    if (IGNORE_PATTERNS.some((pattern) => pattern.test(line))) {
      continue;
    }

    if (
      normalizeSearchText(line) === normalizeSearchText(requestedWord) ||
      normalizeSearchText(line) === normalizeSearchText(canonicalWord)
    ) {
      continue;
    }

    collectedLines.push(line);
  }

  const textLines = trimPreludeFromCollectedLines(collectedLines);
  const hasDirectNonVerbEntry =
    normalizeSearchText(headingWord) === normalizeSearchText(requestedWord) &&
    textLines.some((line) => isNonVerbGrammarLine(line));
  const canonicalFromSyllables = extractCanonicalFromSyllableLine(textLines[0]);
  const finalLemma = hasDirectNonVerbEntry ? null : lemma;
  const finalCanonicalWord = hasDirectNonVerbEntry
    ? requestedWord
    : finalLemma || canonicalFromSyllables || canonicalWord;
  const text = textLines.join("\n");

  if (!text) {
    return buildResult(
      requestedWord,
      "unavailable",
      "Nao consegui extrair o verbete da Infopedia desta vez.",
    );
  }

  const note =
    finalLemma && normalizeSearchText(finalLemma) !== normalizeSearchText(requestedWord)
      ? `A Infopedia abriu o verbo no infinitivo "${finalLemma}" a partir da forma flexionada "${requestedWord}".`
      : normalizeSearchText(finalCanonicalWord) !== normalizeSearchText(requestedWord)
        ? `A Infopedia aproximou "${requestedWord}" pelo verbete "${finalCanonicalWord}".`
      : null;

  return buildResult(
    requestedWord,
    "found",
    note,
    finalCanonicalWord,
    "Verbete",
    htmlFromText(text),
    text,
    finalCanonicalWord,
  );
}

export async function lookupInfopedia(word: string): Promise<DictionarySourceResult> {
  const requestedWord = normalizeInlineText(word.normalize("NFC"));
  const lookupWord = requestedWord.toLocaleLowerCase("pt-BR");
  const directResult = await lookupInfopediaEntry(requestedWord, lookupWord);

  if (directResult.status === "found") {
    const canonicalFromText = extractCanonicalFromSyllableLine(
      directResult.sections[0]?.text?.split("\n")[0],
    );
    const fallbackLemma = buildPortugueseLookupCandidates(lookupWord)
      .slice(1)
      .find(
        (candidate) =>
          normalizeSearchText(candidate) !== normalizeSearchText(lookupWord) &&
          normalizeSearchText(candidate) === normalizeSearchText(canonicalFromText ?? ""),
      );

    if (
      fallbackLemma &&
      normalizeSearchText(directResult.canonicalWord) === normalizeSearchText(requestedWord)
    ) {
      return {
        ...directResult,
        canonicalWord: fallbackLemma,
        note: `A Infopedia abriu "${fallbackLemma}" a partir da forma flexionada "${requestedWord}".`,
        sourceUrl: `${INFOPEDIA_ENDPOINT}${encodeURIComponent(fallbackLemma)}`,
      };
    }

    return directResult;
  }

  for (const candidate of buildPortugueseLookupCandidates(lookupWord).slice(1, 7)) {
    if (normalizeSearchText(candidate) === normalizeSearchText(lookupWord)) {
      continue;
    }

    const fallbackResult = await lookupInfopediaEntry(requestedWord, candidate);

    if (fallbackResult.status === "found") {
      return fallbackResult;
    }
  }

  return directResult;
}
