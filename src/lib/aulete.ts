import { load } from "cheerio";
import {
  decodeHtmlBuffer,
  htmlFromText,
  normalizeInlineText,
  normalizeLineText,
  repairMojibake,
  selectionToHtml,
  selectionToText,
} from "./dictionary-utils";
import { buildPortugueseLookupCandidates } from "./portuguese-word-candidates";
import type { DictionarySourceResult } from "./lookup-types";

const AULETE_LOOKUP_ENDPOINT =
  "https://www.aulete.com.br/site.php?mdl=aulete_digital&op=loadVerbete&palavra=";
const AULETE_PAGE_ENDPOINT = "https://www.aulete.com.br/";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0 Safari/537.36";

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR");
}

function normalizeEtymology(value: string | null) {
  if (!value) {
    return null;
  }

  const cleaned = normalizeInlineText(value).replace(/^\[/, "").replace(/\]$/, "");
  return cleaned || null;
}

function extractFormationFromText(value: string | null) {
  if (!value) {
    return null;
  }

  const match = value.match(/(?:\[)?F\.?\s*:?\s*([^\]\n]+)/i);
  return normalizeEtymology(match ? `F.: ${match[1]}` : null);
}

function firstNonEmpty(...values: Array<string | null>) {
  return values.find((value) => value && value.length > 0) ?? null;
}

function isAuleteNotFound(value: string | null) {
  if (!value) {
    return false;
  }

  return /nao foi encontrado o verbete/i.test(normalizeSearchText(value));
}

function extractNearestSuggestion(value: string | null) {
  if (!value) {
    return null;
  }

  const normalized = normalizeSearchText(value);
  const match = normalized.match(
    /verbete mais proximo do pesquisado\s*\??\s*([^\n]+)/i,
  );

  if (!match?.[1]) {
    return null;
  }

  const originalLines = normalizeLineText(value).split("\n");
  const targetLine = originalLines.find((line) =>
    normalizeSearchText(line).includes(match[1] ?? ""),
  );

  const suggestion = normalizeInlineText(
    (targetLine ?? match[1]).replace(/[."]+$/g, "").replace(/^.*\?\s*/u, ""),
  );

  return /\p{L}/u.test(suggestion) ? suggestion : null;
}

function buildNotFoundNote(requestedWord: string, rawNote: string | null) {
  const suggestion = extractNearestSuggestion(rawNote);

  if (
    suggestion &&
    normalizeSearchText(suggestion) !== normalizeSearchText(requestedWord)
  ) {
    return `O Aulete nao encontrou "${requestedWord}" e sugeriu "${suggestion}" como aproximacao alfabetica.`;
  }

  return `O Aulete nao encontrou um verbete direto para "${requestedWord}".`;
}

function stripNotFoundPrelude(value: string | null) {
  if (!value) {
    return null;
  }

  const lines = normalizeLineText(value)
    .split("\n")
    .map((line) => normalizeInlineText(line))
    .filter(Boolean)
    .filter((line) => !/^[$A-Z]$/u.test(line))
    .filter(
      (line) =>
        !/nao foi encontrado o verbete/i.test(normalizeSearchText(line)) &&
        !/verbete mais proximo do pesquisado/i.test(normalizeSearchText(line)),
    );

  const cleaned = lines.join("\n");
  return cleaned || null;
}

function isAcceptedAuleteCanonical(
  requestedWord: string,
  canonicalWord: string,
  candidateUniverse: string[],
) {
  const normalizedCanonical = normalizeSearchText(canonicalWord);
  const normalizedRequested = normalizeSearchText(requestedWord);

  if (!normalizedCanonical) {
    return false;
  }

  if (normalizedCanonical === normalizedRequested) {
    return true;
  }

  return candidateUniverse.some(
    (candidate) => normalizeSearchText(candidate) === normalizedCanonical,
  );
}

function buildResult(
  requestedWord: string,
  status: DictionarySourceResult["status"],
  note: string | null,
  canonicalWord = requestedWord,
  updatedHtml: string | null = null,
  updatedText: string | null = null,
  originalHtml: string | null = null,
  originalText: string | null = null,
  etymologyHtml: string | null = null,
  etymologyText: string | null = null,
  sourceLookupWord = requestedWord,
): DictionarySourceResult {
  return {
    canonicalWord,
    label: "Aulete",
    note,
    sections: [
      {
        html: updatedHtml,
        label: "Atualizado",
        text: updatedText,
      },
      {
        html: originalHtml,
        label: "Tradicional",
        text: originalText,
      },
      {
        html: etymologyHtml,
        label: "Etimologia",
        text: etymologyText,
      },
    ],
    sourceId: "aulete",
    sourceUrl: `${AULETE_PAGE_ENDPOINT}${encodeURIComponent(sourceLookupWord)}`,
    status,
  };
}

async function lookupAuleteEntry(
  requestedWord: string,
  lookupWord: string,
  fallbackLemma?: string,
): Promise<DictionarySourceResult> {
  const response = await fetch(
    `${AULETE_LOOKUP_ENDPOINT}${encodeURIComponent(lookupWord)}`,
    {
      cache: "no-store",
      headers: {
        "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
        "user-agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(20000),
    },
  );

  if (!response.ok) {
    return buildResult(
      requestedWord,
      "unavailable",
      "O Aulete nao respondeu como esperado nesta consulta.",
      requestedWord,
    );
  }

  const html = decodeHtmlBuffer(Buffer.from(await response.arrayBuffer()));
  const $ = load(html);

  const updatedRoot = $("#definicao_verbete_homologado").first();
  const originalRoot = $("#definicao_verbete_homologado_original").first();
  const updatedRawText = selectionToText($, updatedRoot, [
    ".oculta",
    "div[style*='float:right']",
    ".edicao-verbete",
  ]);
  const originalRawText = selectionToText($, originalRoot, [
    ".oculta",
    "div[style*='float:right']",
    ".edicao-verbete",
  ]);
  const hiddenNote =
    repairMojibake(normalizeInlineText($("#copy").first().text())) || null;
  const canonicalWord =
    repairMojibake(normalizeInlineText($("#nocab").first().text())) || requestedWord;
  const notFoundNote = firstNonEmpty(hiddenNote, updatedRawText, originalRawText);

  const updatedWithoutNote = updatedRoot.clone();
  updatedWithoutNote.find(".notaverb").remove();

  const originalPrepared = originalRoot.clone();
  originalPrepared.children("strong, span.silabas").remove();

  const updatedText =
    selectionToText($, updatedWithoutNote, [
      ".oculta",
      "div[style*='float:right']",
      ".edicao-verbete",
    ]) || null;
  const originalText =
    selectionToText($, originalPrepared, [
      ".oculta",
      "div[style*='float:right']",
      ".edicao-verbete",
    ]) || null;
  const etymologyText = firstNonEmpty(
    normalizeEtymology(
      selectionToText($, updatedRoot.find(".notaverb").first(), [
        ".oculta",
        "div[style*='float:right']",
      ]),
    ),
    extractFormationFromText(updatedText),
    extractFormationFromText(originalText),
  );

  const updatedHtml = selectionToHtml($, updatedWithoutNote, [
    ".oculta",
    "div[style*='float:right']",
    ".edicao-verbete",
  ]);
  const originalHtml = selectionToHtml($, originalPrepared, [
    ".oculta",
    "div[style*='float:right']",
    ".edicao-verbete",
  ]);
  const etymologyHtml =
    selectionToHtml($, updatedRoot.find(".notaverb").first(), [
      ".oculta",
      "div[style*='float:right']",
    ]) ?? htmlFromText(etymologyText);

  if (
    isAuleteNotFound(hiddenNote) ||
    isAuleteNotFound(updatedRawText) ||
    isAuleteNotFound(originalRawText)
  ) {
    const approximatedUpdatedText = stripNotFoundPrelude(updatedText ?? updatedRawText);
    const approximatedOriginalText = stripNotFoundPrelude(originalText ?? originalRawText);
    const approximatedEtymology = firstNonEmpty(
      extractFormationFromText(approximatedUpdatedText),
      extractFormationFromText(approximatedOriginalText),
      etymologyText,
    );
    const hasApproximationContent = Boolean(
      firstNonEmpty(approximatedUpdatedText, approximatedOriginalText),
    );

    if (
      hasApproximationContent &&
      normalizeSearchText(canonicalWord) !== normalizeSearchText(requestedWord)
    ) {
      return buildResult(
        requestedWord,
        "found",
        `O Aulete aproximou "${requestedWord}" pelo verbete "${canonicalWord}".`,
        canonicalWord,
        approximatedUpdatedText ? htmlFromText(approximatedUpdatedText) : null,
        approximatedUpdatedText,
        approximatedOriginalText ? htmlFromText(approximatedOriginalText) : null,
        approximatedOriginalText,
        approximatedEtymology ? htmlFromText(approximatedEtymology) : null,
        approximatedEtymology,
        canonicalWord,
      );
    }

    return buildResult(
      requestedWord,
      "not_found",
      buildNotFoundNote(requestedWord, notFoundNote),
      requestedWord,
      null,
      null,
      null,
      null,
      null,
      null,
      lookupWord,
    );
  }

  const fallbackNote =
    fallbackLemma && normalizeSearchText(fallbackLemma) !== normalizeSearchText(requestedWord)
      ? `O Aulete abriu "${fallbackLemma}" a partir da forma "${requestedWord}".`
      : null;

  return buildResult(
    requestedWord,
    updatedText || originalText ? "found" : "not_found",
    fallbackNote,
    canonicalWord || requestedWord,
    updatedHtml,
    updatedText,
    originalHtml,
    originalText,
    etymologyHtml,
    etymologyText,
    canonicalWord || lookupWord,
  );
}

export async function lookupAulete(word: string): Promise<DictionarySourceResult> {
  const requestedWord = normalizeInlineText(word.normalize("NFC"));
  const lookupWord = requestedWord.toLocaleLowerCase("pt-BR");
  const candidateUniverse = buildPortugueseLookupCandidates(lookupWord);
  const directResult = await lookupAuleteEntry(requestedWord, lookupWord);

  if (
    directResult.status === "found" &&
    isAcceptedAuleteCanonical(
      requestedWord,
      directResult.canonicalWord,
      candidateUniverse,
    )
  ) {
    return directResult;
  }

  for (const candidateLemma of candidateUniverse.slice(1)) {
    if (normalizeSearchText(candidateLemma) === normalizeSearchText(requestedWord)) {
      continue;
    }

    const fallbackResult = await lookupAuleteEntry(
      requestedWord,
      candidateLemma,
      candidateLemma,
    );

    if (
      fallbackResult.status === "found" &&
      isAcceptedAuleteCanonical(
        requestedWord,
        fallbackResult.canonicalWord,
        candidateUniverse,
      )
    ) {
      return fallbackResult;
    }
  }

  if (directResult.status === "unavailable") {
    return directResult;
  }

  return buildResult(
    requestedWord,
    "not_found",
    buildNotFoundNote(requestedWord, directResult.note),
    requestedWord,
  );
}
