import {
  escapeHtml,
  normalizeInlineText,
  repairMojibake,
} from "./dictionary-utils";
import type { DictionarySourceResult, LookupSection } from "./lookup-types";

const TRECCANI_BASE_URL = "https://www.treccani.it/vocabolario/";
const TRECCANI_MIRROR_BASE_URL = "https://r.jina.ai/http://https://www.treccani.it/vocabolario/";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0 Safari/537.36";

function buildResult(
  requestedWord: string,
  status: DictionarySourceResult["status"],
  note: string,
  sections: LookupSection[] = [],
  canonicalWord = requestedWord,
): DictionarySourceResult {
  return {
    canonicalWord,
    label: "Treccani",
    note,
    sections,
    sourceId: "treccani",
    sourceUrl: `${TRECCANI_BASE_URL}${encodeURIComponent(requestedWord)}/`,
    status,
  };
}

function cleanTreccaniText(value: string) {
  const repaired = repairMojibake(value) ?? value;
  return normalizeInlineText(
    repaired
      .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
      .replace(/!\[[^\]]*\]\([^)]*\)/gu, " ")
      .replace(/^#+\s*/gu, "")
      .replace(/[*_`]/gu, " "),
  );
}

function extractFromMarkdown(markdown: string, requestedWord: string) {
  const lines = markdown
    .split("\n")
    .map(cleanTreccaniText)
    .filter(Boolean)
    .filter((line) => !/^URL Source:|^Markdown Content:?|^Treccani|^Vocabolario/iu.test(line));
  const requested = requestedWord.toLocaleLowerCase("it-IT");
  const start =
    lines.findIndex((line) => line.toLocaleLowerCase("it-IT") === requested) ??
    -1;
  const offset = start >= 0 ? start : lines.findIndex((line) => line.toLocaleLowerCase("it-IT").startsWith(requested));

  if (offset < 0) {
    return null;
  }

  const collected: string[] = [];

  for (const line of lines.slice(offset, offset + 70)) {
    if (collected.length > 4 && /^(Sinonimi|Contrari|Vedi anche|Enciclopedia)$/iu.test(line)) {
      break;
    }

    if (line.length <= 2 || /^[-–—]$/u.test(line)) {
      continue;
    }

    collected.push(line);
  }

  const text = collected.join("\n").trim();

  if (text.length < 40) {
    return null;
  }

  return {
    canonicalWord: collected[0] ?? requestedWord,
    text,
  };
}

function sectionFromText(text: string): LookupSection {
  const html = [
    `<article class="lookupEntry">`,
    ...text.split("\n").map((line, index) =>
      index === 0
        ? `<p class="lookupEntryTitle">${escapeHtml(line)}</p>`
        : `<p class="lookupLine">${escapeHtml(line)}</p>`,
    ),
    `</article>`,
  ].join("");

  return {
    html,
    label: "Vocabolario",
    text,
  };
}

export async function lookupTreccani(word: string): Promise<DictionarySourceResult> {
  const requestedWord = normalizeInlineText(word.normalize("NFC")).toLocaleLowerCase("it-IT");

  if (!requestedWord) {
    return buildResult(
      requestedWord,
      "not_found",
      "Digite uma palavra italiana para consultar o Treccani.",
    );
  }

  try {
    const response = await fetch(
      `${TRECCANI_MIRROR_BASE_URL}${encodeURIComponent(requestedWord)}/`,
      {
        cache: "no-store",
        headers: {
          "accept-language": "it-IT,it;q=0.9,pt-BR;q=0.7,en;q=0.6",
          "user-agent": USER_AGENT,
        },
        signal: AbortSignal.timeout(20000),
      },
    );

    if (!response.ok) {
      return buildResult(
        requestedWord,
        "unavailable",
        "Nao consegui consultar o Treccani agora.",
      );
    }

    const raw = await response.text();
    const parsed = extractFromMarkdown(raw, requestedWord);

    if (!parsed) {
      return buildResult(
        requestedWord,
        "not_found",
        `Nao encontrei um verbete direto para "${requestedWord}" no Treccani.`,
      );
    }

    return buildResult(
      requestedWord,
      "found",
      "Verbete extraido do Vocabolario Treccani.",
      [sectionFromText(parsed.text)],
      parsed.canonicalWord,
    );
  } catch {
    return buildResult(
      requestedWord,
      "unavailable",
      "Nao consegui consultar o Treccani agora.",
    );
  }
}
