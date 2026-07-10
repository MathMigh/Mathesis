import { escapeHtml, normalizeInlineText, repairMojibake } from "./dictionary-utils";
import type { DictionarySourceResult, LookupSection } from "./lookup-types";

type ParsedEntry = {
  canonicalWord: string;
  html: string;
  text: string;
};

const BASE_URL = "https://www.infopedia.pt/dicionarios/ingles-portugues/";
const MIRROR_URL =
  "https://r.jina.ai/http://https://www.infopedia.pt/dicionarios/ingles-portugues/";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0 Safari/537.36";

const ENTRY_HINT_RE =
  /\b(?:noun|verb|adjective|adverb|preposition|conjunction|pronoun|interjection|determiner|proper noun|adjetivo|advérbio|advérbio|nome|substantivo|verbo|pronome)\b/iu;
const PART_OF_SPEECH_RE =
  /^(?:noun|verb|adjective|adverb|preposition|conjunction|pronoun|interjection|determiner|proper noun|adjetivo|advérbio|nome|substantivo|verbo|pronome)(?:\s*,\s*(?:noun|verb|adjective|adverb|preposition|conjunction|pronoun|interjection|determiner|proper noun|adjetivo|advérbio|nome|substantivo|verbo|pronome))*$/iu;
const STOP_LINE_RE =
  /^(?:Outros exemplos de uso|Como referenciar|Partilhar|Ver mais|Examples of use|Related words|Outras sugestões)$/iu;
const IGNORE_LINE_RE =
  /^(?:Markdown Content:?|URL Source:|Entrar|Favoritos|Audio\s*\d*|conjugação|conjugacao|-->)$/iu;
const PRONUNCIATION_RE = /(?:^[/[]|[ˈˌəɛɪɔʊæɑðθʃʒŋœɒʌɐɨ])/u;
const SENSE_INDEX_RE = /^\d+\.$/u;

function buildFallbackSection(message: string): LookupSection {
  return {
    html: `<article class="lookupEntry"><p class="lookupLine">${escapeHtml(message)}</p></article>`,
    label: "Inglês-Português",
    text: message,
  };
}

function cleanLine(value: string) {
  const withoutImages = value.replace(/!\[[^\]]*\]\([^)]*\)/gu, " ");
  const withoutLinks = withoutImages.replace(/\[([^\]]*)\]\(([^)]*)\)/gu, "$1");
  const repaired = repairMojibake(withoutLinks) ?? withoutLinks;

  return normalizeInlineText(
    repaired
      .replace(/^#+\s*/u, "")
      .replace(/\bAudio\s*\d+\b/giu, " ")
      .replace(/[*_`]/gu, " ")
      .replace(/\u200b/gu, " ")
      .replace(/\(\s*\)/gu, " "),
  );
}

function dedupeHeadword(value: string) {
  const cleaned = normalizeInlineText(value);
  const exactMatch = /^(.+?)\s+\1$/iu.exec(cleaned);

  if (exactMatch?.[1]) {
    return exactMatch[1].trim();
  }

  const tokens = cleaned.split(/\s+/u).filter(Boolean);

  if (tokens.length >= 2) {
    const [first, second] = tokens;

    if (
      first &&
      second &&
      first.toLocaleLowerCase("en-US") === second.toLocaleLowerCase("en-US")
    ) {
      return first;
    }
  }

  return cleaned;
}

function cleanHeadword(value: string, fallback: string) {
  return (
    dedupeHeadword(
      cleanLine(value)
        .replace(/[|]+$/gu, "")
        .replace(/\bAudio\s*\d+\b/giu, " ")
        .trim(),
    ) || fallback
  );
}

function looksLikePartOfSpeech(line: string) {
  return PART_OF_SPEECH_RE.test(line);
}

function looksLikePronunciation(line: string) {
  return (
    line.length > 0 &&
    line.length <= 48 &&
    (line.startsWith("/") || line.startsWith("[") || PRONUNCIATION_RE.test(line))
  );
}

function looksLikeExpression(line: string) {
  if (!line || line.length > 120) {
    return false;
  }

  if (looksLikePartOfSpeech(line) || looksLikePronunciation(line) || SENSE_INDEX_RE.test(line)) {
    return false;
  }

  return /[a-z]/iu.test(line) && !/[.;:]$/u.test(line);
}

function isLikelyEntryHeading(line: string, requestedWord: string) {
  const normalizedLine = line.toLocaleLowerCase("en-US");
  const normalizedWord = requestedWord.toLocaleLowerCase("en-US");

  return (
    normalizedLine === normalizedWord ||
    normalizedLine === `${normalizedWord}:` ||
    normalizedLine.startsWith(`${normalizedWord} `) ||
    normalizedLine.includes(`${normalizedWord},`)
  );
}

function findEntryStart(lines: string[], requestedWord: string) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    if (isLikelyEntryHeading(line, requestedWord)) {
      return index;
    }

    if (line.toLocaleLowerCase("en-US").includes(requestedWord.toLocaleLowerCase("en-US"))) {
      const lookahead = lines.slice(index, index + 10).join(" ");

      if (
        ENTRY_HINT_RE.test(lookahead) ||
        lines.slice(index, index + 8).some((candidate) => looksLikePartOfSpeech(candidate ?? ""))
      ) {
        return index;
      }
    }
  }

  return -1;
}

function buildStyledEntry(lines: string[]) {
  const htmlParts = [`<article class="lookupEntry lookupEntry--infopedia">`];
  const textParts: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const nextLine = lines[index + 1] ?? "";

    if (index === 0) {
      htmlParts.push(`<p class="lookupEntryTitle">${escapeHtml(line)}</p>`);
      textParts.push(line);
      continue;
    }

    if (looksLikePronunciation(line)) {
      htmlParts.push(`<p class="lookupPronunciation">${escapeHtml(line)}</p>`);
      textParts.push(line);
      continue;
    }

    if (looksLikePartOfSpeech(line)) {
      htmlParts.push(
        `<p class="lookupEntryMeta lookupEntryMeta--infopedia">${escapeHtml(line)}</p>`,
      );
      textParts.push(line);
      continue;
    }

    if (SENSE_INDEX_RE.test(line)) {
      htmlParts.push(`<p class="lookupSenseIndex">${escapeHtml(line)}</p>`);
      textParts.push(line);
      continue;
    }

    if (
      looksLikeExpression(line) &&
      nextLine &&
      !looksLikeExpression(nextLine) &&
      !looksLikePartOfSpeech(nextLine) &&
      !looksLikePronunciation(nextLine) &&
      !SENSE_INDEX_RE.test(nextLine)
    ) {
      htmlParts.push(
        `<div class="lookupPair"><p class="lookupTerm">${escapeHtml(line)}</p><p class="lookupTranslation">${escapeHtml(nextLine)}</p></div>`,
      );
      textParts.push(line, nextLine);
      index += 1;
      continue;
    }

    htmlParts.push(`<p class="lookupLine">${escapeHtml(line)}</p>`);
    textParts.push(line);
  }

  htmlParts.push("</article>");

  return {
    html: htmlParts.join(""),
    text: textParts.join("\n"),
  };
}

function buildSectionFromMirror(markdown: string, requestedWord: string): ParsedEntry | null {
  const rawLines = markdown
    .split("\n")
    .map(cleanLine)
    .filter(Boolean);
  const startIndex = findEntryStart(rawLines, requestedWord);

  if (startIndex < 0) {
    return null;
  }

  const collected: string[] = [];

  for (let index = startIndex; index < rawLines.length; index += 1) {
    const line = rawLines[index] ?? "";

    if (IGNORE_LINE_RE.test(line)) {
      continue;
    }

    if (index > startIndex && STOP_LINE_RE.test(line)) {
      break;
    }

    if (
      index > startIndex &&
      isLikelyEntryHeading(line, requestedWord) &&
      collected.length >= 24 &&
      looksLikePartOfSpeech(rawLines[index + 1] ?? "")
    ) {
      break;
    }

    collected.push(line);

    if (collected.length >= 320) {
      break;
    }
  }

  if (collected.length === 0) {
    return null;
  }

  const canonicalWord = cleanHeadword(collected[0] ?? requestedWord, requestedWord);
  const cleaned = collected
    .map((line, index) => (index === 0 ? canonicalWord : line))
    .filter(Boolean);
  const rendered = buildStyledEntry(cleaned);

  return {
    canonicalWord,
    html: rendered.html,
    text: rendered.text,
  };
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
    label: "Infopédia",
    note,
    sections,
    sourceId: "infopedia_enpt",
    sourceUrl: `${BASE_URL}${encodeURIComponent(requestedWord)}`,
    status,
  };
}

export async function lookupInfopediaEnPt(word: string): Promise<DictionarySourceResult> {
  const requestedWord = normalizeInlineText(word.normalize("NFC")).toLocaleLowerCase("en-US");

  if (!requestedWord) {
    return buildResult(
      requestedWord,
      "not_found",
      'Digite uma palavra para consultar a Infopédia.',
      [buildFallbackSection("Digite uma palavra para consultar a Infopédia.")],
    );
  }

  try {
    const response = await fetch(`${MIRROR_URL}${encodeURIComponent(requestedWord)}`, {
      cache: "no-store",
      headers: {
        "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
        "user-agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(22000),
    });

    if (!response.ok) {
      return buildResult(
        requestedWord,
        "unavailable",
        "Não consegui consultar a Infopédia agora.",
        [buildFallbackSection("Não consegui consultar a Infopédia agora.")],
      );
    }

    const rawText = repairMojibake(await response.text()) ?? "";
    const entry = buildSectionFromMirror(rawText, requestedWord);

    if (!entry) {
      return buildResult(
        requestedWord,
        "not_found",
        `Não encontrei verbete direto para "${requestedWord}" na Infopédia.`,
        [buildFallbackSection(`Não encontrei verbete direto para "${requestedWord}" na Infopédia.`)],
      );
    }

    return buildResult(
      requestedWord,
      "found",
      "Consulta reunida da Infopédia em inglês-português.",
      [
        {
          html: entry.html,
          label: "Inglês-Português",
          text: entry.text,
        },
      ],
      entry.canonicalWord,
    );
  } catch {
    return buildResult(
      requestedWord,
      "unavailable",
      "Não consegui consultar a Infopédia agora.",
      [buildFallbackSection("Não consegui consultar a Infopédia agora.")],
    );
  }
}
