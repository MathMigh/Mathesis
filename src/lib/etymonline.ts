import { load } from "cheerio";
import {
  escapeHtml,
  normalizeInlineText,
  repairMojibake,
  selectionToText,
} from "./dictionary-utils";
import type { DictionarySourceResult, LookupSection } from "./lookup-types";

const ETYMONLINE_SOURCE_URL = "https://www.etymonline.com/word/";
const USER_AGENT = "Mathesis/1.0 Etymonline etymology";

function buildResult(
  requestedWord: string,
  status: DictionarySourceResult["status"],
  note: string,
  sections: LookupSection[] = [],
  canonicalWord = requestedWord,
): DictionarySourceResult {
  return {
    canonicalWord,
    label: "Etimologia",
    note,
    sections,
    sourceId: "etimologia",
    sourceUrl: `${ETYMONLINE_SOURCE_URL}${encodeURIComponent(requestedWord)}`,
    status,
  };
}

function cleanEtymonlineText(rawText: string) {
  return (repairMojibake(rawText) ?? rawText)
    .replace(/Advertisement[\s\S]*?(?:Origin and history of|$)/iu, "")
    .replace(/Want to remove ads\?[\s\S]*?Premium Member/giu, "")
    .replace(/\nEntries linking to[\s\S]*$/iu, "")
    .replace(/\nMore to explore[\s\S]*$/iu, "")
    .replace(/\nSee All Related Words[\s\S]*$/iu, "")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function buildEtymonlineSection(rawHtml: string, requestedWord: string) {
  const $ = load(rawHtml);
  $("script, style, svg, img, button, input, nav, form, aside").remove();
  $("br").replaceWith("\n");

  const root = $("main").first();
  const text = cleanEtymonlineText(selectionToText($, root.length ? root : $("body").first()));

  if (!text || text.length < 30 || /not found|no result/iu.test(text)) {
    return null;
  }

  const lines = text
    .split("\n")
    .map((line) => normalizeInlineText(line))
    .filter(Boolean);
  const originIndex = lines.findIndex((line) => /^Origin and history of$/iu.test(line));
  const contentLines = originIndex >= 0 ? lines.slice(originIndex + 1) : lines;
  const firstWordIndex = contentLines.findIndex(
    (line) => line.toLocaleLowerCase("en-US") === requestedWord.toLocaleLowerCase("en-US"),
  );
  const selectedLines = (firstWordIndex >= 0 ? contentLines.slice(firstWordIndex) : contentLines)
    .filter((line) => !/^(Advertisement|Remove Ads|Log in)$/iu.test(line))
    .slice(0, 42);

  if (selectedLines.length < 2) {
    return null;
  }

  const html = [
    `<article class="lookupEntry">`,
    ...selectedLines.map((line, index) => {
      if (index === 0 || /^\([a-z.]+\)$/iu.test(line)) {
        return `<p class="lookupEntryTitle">${escapeHtml(line)}</p>`;
      }

      return `<p class="lookupLine">${escapeHtml(line)}</p>`;
    }),
    `</article>`,
  ].join("");

  return {
    canonicalWord: selectedLines[0] ?? requestedWord,
    html,
    text: selectedLines.join("\n"),
  };
}

export async function lookupEtymonline(word: string): Promise<DictionarySourceResult> {
  const requestedWord = normalizeInlineText(word.normalize("NFC")).toLocaleLowerCase("en-US");

  if (!requestedWord) {
    return buildResult(
      requestedWord,
      "not_found",
      "Digite uma palavra inglesa para consultar a etimologia.",
    );
  }

  try {
    const response = await fetch(
      `${ETYMONLINE_SOURCE_URL}${encodeURIComponent(requestedWord)}`,
      {
        headers: { "user-agent": USER_AGENT },
        next: { revalidate: 60 * 60 * 24 * 30 },
        signal: AbortSignal.timeout(14000),
      },
    );

    if (!response.ok) {
      return buildResult(
        requestedWord,
        "unavailable",
        "Nao consegui consultar o Online Etymology Dictionary agora.",
      );
    }

    const section = buildEtymonlineSection(await response.text(), requestedWord);

    if (!section) {
      return buildResult(
        requestedWord,
        "not_found",
        `Nao encontrei uma nota etimologica direta para "${requestedWord}" no Online Etymology Dictionary.`,
      );
    }

    return buildResult(
      requestedWord,
      "found",
      "Nota etimologica extraida do Online Etymology Dictionary.",
      [
        {
          html: section.html,
          label: "Online Etymology Dictionary",
          text: section.text,
        },
      ],
      section.canonicalWord,
    );
  } catch {
    return buildResult(
      requestedWord,
      "unavailable",
      "Nao consegui consultar o Online Etymology Dictionary agora.",
    );
  }
}
