import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  htmlFromText,
  normalizeInlineText,
  normalizeLineText,
  repairMojibake,
} from "./dictionary-utils";
import type {
  DictionarySourceResult,
  LookupContext,
  LookupSection,
} from "./lookup-types";

const PORTO_INDEX_PATH = join(process.cwd(), "data", "porto", "ocr-index.json");
const PORTO_STOP_TEXT_MARKERS = [
  /\bAutor que abona o exemplo\b/iu,
  /\bContexto\b/iu,
  /\bConsultar\b/iu,
  /\bDisting[aã]o de categorias gramaticais\b/iu,
  /\bDisting[aã]o de palavras hom[oó]grafas\b/iu,
  /\bDisting[aã]o de acep[cç][oõ]es\b/iu,
  /\bObserva[cç][oõ]es gramaticais\b/iu,
  /\bTradug[aã]o do exemplo\b/iu,
  /\bSilaba breve\b/iu,
  /\bSilaba longa\b/iu,
  /\bA\. Gei\.\b/u,
  /\bAulo Gelio\b/iu,
];
const PORTO_METADATA_NOISE_RE =
  /\b(?:pagina|traducao|exemplo|buscar|consulta|verbete|dicionario|tempo real|autor que abona|observacoes gramaticais|tradugao do exemplo)\b/u;
const PORTO_SUGGESTION_NOISE_RE =
  /\b(?:cidade|provincia|rio|ilha|monte|rei|rainha|povo|sobrenome|nome de familia|nome de dois|habitantes de)\b/iu;
const PORTO_PROPER_NAME_RE =
  /\b(?:nome de|familia romana|imperador|consul|soldados de|habitantes de|mulher de|deusa da|territorio de)\b/iu;
const PORTO_LABEL_NOISE_RE =
  /\b(?:ou|sincop|pagina|contexto|consultar|traducao|exemplo)\b/iu;

type PortoIndexEntry = {
  headword: string;
  label: string;
  page: number;
  tail: string | null;
  text: string;
};

type PortoIndexPayload = {
  entries: PortoIndexEntry[];
  source?: string;
  version?: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __portoIndexPromise: Promise<PortoIndexEntry[]> | undefined;
}

function buildResult(
  requestedWord: string,
  status: DictionarySourceResult["status"],
  note: string,
  sections: LookupSection[] = [],
  canonicalWord = requestedWord,
): DictionarySourceResult {
  return {
    canonicalWord,
    label: "Porto Editora",
    note: repairMojibake(note) ?? note,
    sections,
    sourceId: "porto",
    sourceUrl: null,
    status,
  };
}

function stripAccents(value: string) {
  return value.normalize("NFD").replace(/\p{Mark}+/gu, "");
}

function normalizeSearchValue(value: string) {
  return stripAccents((repairMojibake(value) ?? value).toLocaleLowerCase("pt-BR"))
    .replace(/[^\p{L}\p{N}\s,/-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanPortoDisplayText(value: string) {
  return normalizeInlineText((repairMojibake(value) ?? value).normalize("NFC"))
    .replace(/\bP[aá]gina\s+\d+\b/giu, " ")
    .replace(/\bContexto\b.*$/iu, " ")
    .replace(/\bConsultar\b.*$/iu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function repairLatinDictionaryText(value: string) {
  const repaired = repairMojibake(value) ?? value;

  return repaired
    .replace(/\bexistencia\b/giu, "existência")
    .replace(/\bgenero\b/giu, "gênero")
    .replace(/\bsubsistenda\b/giu, "subsistência")
    .replace(/\baegao\b/giu, "ação")
    .replace(/\bevitagao\b/giu, "evitação")
    .replace(/\bcorrupgao\b/giu, "corrupção")
    .replace(/\bviolagao\b/giu, "violação")
    .replace(/\bforga\b/giu, "força")
    .replace(/\bimperfeigao\b/giu, "imperfeição")
    .replace(/\borgaos\b/giu, "órgãos")
    .replace(/\bprincipio\b/giu, "princípio")
    .replace(/\bsaude\b/giu, "saúde")
    .replace(/\bnectar\b/giu, "néctar")
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(value: string) {
  return value.split(/\s+/u).filter(Boolean).length;
}

function getFirstLemmaToken(value: string) {
  return normalizeLemmaBits(value).split(/[,\s]+/u).filter(Boolean)[0] ?? "";
}

function isProperNounLikeLabel(value: string) {
  const firstToken = getFirstLemmaToken(value);
  return /^[A-ZÀ-Ý]/u.test(firstToken);
}

function looksLikeLexicalEntry(entry: PortoIndexEntry) {
  const label = normalizeLemmaBits(entry.label);
  const text = cleanPortoDisplayText(entry.text);
  const firstToken = getFirstLemmaToken(label);

  if (!label || !text || !firstToken) {
    return false;
  }

  if (PORTO_SUGGESTION_NOISE_RE.test(text)) {
    return false;
  }

  if (PORTO_LABEL_NOISE_RE.test(label)) {
    return false;
  }

  if (PORTO_PROPER_NAME_RE.test(text) && !/^[a-z]/u.test(firstToken)) {
    return false;
  }

  if (/^\p{Lu}/u.test(firstToken) && !/,\s*[a-z]/u.test(label)) {
    return false;
  }

  return true;
}

function hasPortugueseNoise(value: string) {
  return /\b(?:pagina|traducao|tradução|exemplo|buscar|consulta|verbete|dicionario|dicionário|tempo real)\b/iu.test(
    value,
  );
}

function normalizeLemmaBits(value: string) {
  return cleanPortoDisplayText(value)
    .replace(/\b\d+\b/gu, " ")
    .replace(/[()[\]{}<>]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim()
    .replace(/^[,;\s]+|[,;\s]+$/g, "");
}

function isLikelyLatinLemma(value: string) {
  const cleaned = normalizeLemmaBits(value);

  if (!cleaned || cleaned.length < 2 || cleaned.length > 64) {
    return false;
  }

  if (/\b(?:pagina|traducao|exemplo|consultar|contexto|observacoes?|gramaticais)\b/iu.test(cleaned)) {
    return false;
  }

  if (/[=:*■❖]/u.test(cleaned)) {
    return false;
  }

  const firstToken = cleaned.split(/[,\s]+/u).filter(Boolean)[0] ?? "";

  if (firstToken.length < 2 || firstToken.length > 24) {
    return false;
  }

  return /^[\p{L}-]+$/u.test(firstToken);
}

function isMostlyLatinScript(value: string) {
  const cleaned = normalizeLemmaBits(value);

  if (!cleaned) {
    return false;
  }

  const tokens = cleaned
    .split(/[,\s/]+/u)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return false;
  }

  const latinish = tokens.filter((token) => /^[a-zāēīōūȳæœ-]+$/iu.test(token)).length;
  return latinish / tokens.length >= 0.75;
}

function isUsefulPortoEntryForNeedle(entry: PortoIndexEntry, needle: string) {
  const firstToken = normalizeSearchValue(getFirstLemmaToken(entry.label));
  const normalizedHeadword = normalizeSearchValue(entry.headword);

  if (!firstToken || !normalizedHeadword) {
    return false;
  }

  if (!firstToken.startsWith(needle) && !normalizedHeadword.startsWith(needle)) {
    return false;
  }

  if (
    PORTO_METADATA_NOISE_RE.test(stripAccents(entry.label.toLocaleLowerCase("pt-BR"))) ||
    PORTO_METADATA_NOISE_RE.test(stripAccents(entry.text.toLocaleLowerCase("pt-BR")))
  ) {
    return false;
  }

  return /^[\p{L}-]{2,32}$/u.test(getFirstLemmaToken(entry.label));
}

function cleanPortoLabel(headword: string, label: string, tail: string | null) {
  const cleanedHeadword = normalizeLemmaBits(headword);
  const cleanedLabel = normalizeLemmaBits(label);
  const cleanedTail = tail ? normalizeLemmaBits(tail) : "";

  const preferred =
    isLikelyLatinLemma(cleanedLabel)
      ? cleanedLabel
      : cleanedTail && isLikelyLatinLemma(`${cleanedHeadword}, ${cleanedTail}`)
        ? `${cleanedHeadword}, ${cleanedTail}`
        : cleanedHeadword;

  return preferred
    .replace(/\b(\d+)\b/gu, "")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim()
    .replace(/^[,;\s]+|[,;\s]+$/g, "");
}

function trimToPrimaryPortoSnippet(text: string, label: string) {
  const cleaned = repairLatinDictionaryText(cleanPortoDisplayText(text));

  if (!cleaned) {
    return "";
  }

  for (const marker of PORTO_STOP_TEXT_MARKERS) {
    const match = marker.exec(cleaned);

    if (match && match.index > 80) {
      return cleaned.slice(0, match.index).trim();
    }
  }

  const candidateBreaks = [
    /\s+[A-Z][a-zà-ÿ-]{2,},\s+[a-zà-ÿ-]{1,12}\b/u,
    /\s+[a-zà-ÿ-]{3,24},\s+[a-zà-ÿ-]{1,12}(?:,\s+[a-zà-ÿ-]{1,12}){0,3}\b/u,
    /\s+[A-Z][a-zÃ -Ã¿-]{2,}\s+\[[^\]]+\]/u,
  ];

  for (const pattern of candidateBreaks) {
    const match = pattern.exec(cleaned);

    if (match && match.index > 120) {
      const possibleNext = match[0].trim();

      if (!normalizeSearchValue(possibleNext).startsWith(normalizeSearchValue(label))) {
        return cleaned.slice(0, match.index).trim();
      }
    }
  }

  return cleaned;
}

function normalizeEntry(entry: PortoIndexEntry): PortoIndexEntry {
  const cleanHeadword = normalizeLemmaBits(entry.headword);
  const cleanLabel = cleanPortoLabel(entry.headword, entry.label, entry.tail);
  const cleanText = trimToPrimaryPortoSnippet(entry.text, cleanLabel || cleanHeadword);

  return {
    ...entry,
    headword: cleanHeadword,
    label: cleanLabel,
    tail: entry.tail ? normalizeLemmaBits(entry.tail) : null,
    text: cleanText,
  };
}

async function loadPortoIndex() {
  if (!globalThis.__portoIndexPromise) {
    globalThis.__portoIndexPromise = readFile(PORTO_INDEX_PATH, "utf8")
      .then((raw) => JSON.parse(raw) as PortoIndexPayload | PortoIndexEntry[])
      .then((parsed) => {
        const entries = Array.isArray(parsed) ? parsed : parsed.entries;

        return entries
          .map(normalizeEntry)
          .filter(
            (entry) =>
              entry.headword &&
              entry.label &&
              entry.text &&
              isLikelyLatinLemma(entry.headword) &&
              isLikelyLatinLemma(entry.label) &&
              isMostlyLatinScript(entry.label),
          );
      });
  }

  return globalThis.__portoIndexPromise;
}

function scoreEntryMatch(needle: string, entry: PortoIndexEntry) {
  const normalizedHeadword = normalizeSearchValue(entry.headword);
  const normalizedLabel = normalizeSearchValue(entry.label);
  const firstToken = normalizeSearchValue(getFirstLemmaToken(entry.label));
  const firstTokenLengthPenalty = Math.max(0, firstToken.length - needle.length) * 10;
  const headwordWords = countWords(normalizedHeadword);
  const labelWords = countWords(normalizedLabel);
  const isLowercaseNeedle = needle === needle.toLocaleLowerCase("pt-BR");
  const uppercasePenalty =
    isLowercaseNeedle && /^[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]/u.test(entry.headword) ? 90 : 0;
  const longPhrasePenalty = Math.max(0, headwordWords - 2) * 24;

  if (firstToken === needle) {
    return 620 - uppercasePenalty;
  }

  if (normalizedHeadword === needle) {
    return 600 - Math.max(0, headwordWords - 1) * 18 - uppercasePenalty;
  }

  if (normalizedLabel === needle) {
    return 580 - Math.max(0, labelWords - 1) * 18 - uppercasePenalty;
  }

  if (firstToken.startsWith(needle)) {
    return (
      520 -
      firstTokenLengthPenalty -
      Math.max(0, labelWords - 1) * 18 -
      uppercasePenalty
    );
  }

  if (normalizedHeadword.startsWith(needle)) {
    return (
      500 -
      firstTokenLengthPenalty -
      Math.max(0, headwordWords - 1) * 18 -
      uppercasePenalty -
      longPhrasePenalty
    );
  }

  if (normalizedLabel.startsWith(needle)) {
    return (
      470 -
      firstTokenLengthPenalty -
      Math.max(0, labelWords - 1) * 18 -
      uppercasePenalty
    );
  }

  return 0;
}

function uniqueEntries(entries: PortoIndexEntry[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = normalizeSearchValue(entry.label);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function scoreEntryQuality(entry: PortoIndexEntry, needle: string) {
  const firstToken = normalizeSearchValue(getFirstLemmaToken(entry.label));
  const labelWords = countWords(normalizeSearchValue(entry.label));
  let score = 0;

  if (firstToken === needle) {
    score += 140;
  }

  if (labelWords <= 3) {
    score += 50;
  }

  if (isProperNounLikeLabel(entry.label)) {
    score -= 180;
  }

  if (PORTO_PROPER_NAME_RE.test(entry.text)) {
    score -= 180;
  }

  if (PORTO_LABEL_NOISE_RE.test(entry.label)) {
    score -= 220;
  }

  return score;
}

function preferLowercaseLexicalEntries(entries: PortoIndexEntry[], needle: string) {
  const lowercasePrefixHits = entries.filter((entry) => {
    const firstToken = getFirstLemmaToken(entry.label);
    return (
      firstToken === firstToken.toLocaleLowerCase("pt-BR") &&
      normalizeSearchValue(firstToken).startsWith(needle) &&
      looksLikeLexicalEntry(entry)
    );
  });

  if (lowercasePrefixHits.length === 0 || needle !== needle.toLocaleLowerCase("pt-BR")) {
    return entries;
  }

  const filtered = entries.filter(
    (entry) => !isProperNounLikeLabel(entry.label) && looksLikeLexicalEntry(entry),
  );
  return filtered.length >= 1 ? filtered : entries;
}

export async function lookupPorto(
  word: string,
  _context?: LookupContext,
): Promise<DictionarySourceResult> {
  const requestedWord = normalizeInlineText(word.normalize("NFC"));
  const normalizedNeedle = normalizeSearchValue(requestedWord);

  if (!normalizedNeedle) {
    return buildResult(
      requestedWord,
      "not_found",
      "Digite uma palavra latina para pesquisar na Porto Editora.",
    );
  }

  let entries: PortoIndexEntry[];

  try {
    entries = await loadPortoIndex();
  } catch {
    return buildResult(
      requestedWord,
      "unavailable",
      "A base local da Porto Editora ainda não ficou pronta nesta implantação.",
    );
  }

  const rankedHits = uniqueEntries(
    entries
      .map((entry) => ({
        entry,
        score:
          scoreEntryMatch(normalizedNeedle, entry) +
          scoreEntryQuality(entry, normalizedNeedle),
      }))
      .filter(
        (hit) =>
          hit.score > 0 &&
          isUsefulPortoEntryForNeedle(hit.entry, normalizedNeedle) &&
          looksLikeLexicalEntry(hit.entry),
      )
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        if (left.entry.headword.length !== right.entry.headword.length) {
          return left.entry.headword.length - right.entry.headword.length;
        }

        if (left.entry.label.length !== right.entry.label.length) {
          return left.entry.label.length - right.entry.label.length;
        }

        return left.entry.page - right.entry.page;
      })
      .map((hit) => hit.entry),
  );

  const finalHits = preferLowercaseLexicalEntries(rankedHits, normalizedNeedle).slice(0, 60);

  if (finalHits.length === 0) {
    return buildResult(
      requestedWord,
      "not_found",
      `Não encontrei um lema latino aproveitável para "${requestedWord}" na base local da Porto Editora.`,
    );
  }

  const sections: LookupSection[] = finalHits.map((entry) => {
    const text = normalizeLineText(`p. ${entry.page}\n${entry.text}`);
    return {
      html: htmlFromText(text),
      label: entry.label,
      text,
    };
  });

  return buildResult(
    requestedWord,
    "found",
    "Busca lexical em tempo real no Dicionário de Latim - Português da Porto Editora.",
    sections,
    requestedWord,
  );
}
