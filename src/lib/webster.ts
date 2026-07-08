import { load } from "cheerio";
import {
  decodeHtmlBuffer,
  escapeHtml,
  normalizeInlineText,
  repairMojibake,
  selectionToText,
} from "./dictionary-utils";
import type { DictionarySourceResult, LookupSection } from "./lookup-types";

const WEBSTER_SOURCE_URL = "https://www.websters1913.com/";
const USER_AGENT = "Mathesis/1.0 Webster 1913";

function buildResult(
  requestedWord: string,
  status: DictionarySourceResult["status"],
  note: string,
  sections: LookupSection[] = [],
  canonicalWord = requestedWord,
): DictionarySourceResult {
  return {
    canonicalWord,
    label: "Webster 1913",
    note,
    sections,
    sourceId: "webster",
    sourceUrl: `${WEBSTER_SOURCE_URL}words/${encodeURIComponent(requestedWord)}`,
    status,
  };
}

function cleanWebsterText(rawText: string) {
  return normalizeInlineText(repairMojibake(rawText) ?? rawText)
    .replace(/^,\s*/u, "")
    .replace(/^\u261e\s*/u, "Nota: ")
    .replace(/\s+([,.;:!?])/gu, "$1")
    .replace(/\(\?\)/gu, "")
    .replace(/\s{2,}/gu, " ")
    .trim();
}

function dedupeHeadword(value: string) {
  const cleaned = cleanWebsterText(value);
  const exactMatch = /^(.+?)\s+\1$/iu.exec(cleaned);

  if (exactMatch?.[1]) {
    return exactMatch[1].trim();
  }

  const tokens = cleaned.split(/\s+/u).filter(Boolean);

  if (tokens.length >= 2) {
    const first = tokens[0]?.toLocaleLowerCase("en-US");
    const second = tokens[1]?.toLocaleLowerCase("en-US");

    if (first && second && first === second) {
      return tokens.slice(1).join(" ").trim() || tokens[0]!;
    }
  }

  return cleaned.trim();
}

function formatSenseLine(line: string) {
  const match = /^(\d+\.)\s*(.+)$/u.exec(line);

  if (!match) {
    return `<p class="lookupLine">${escapeHtml(line)}</p>`;
  }

  return `<p class="lookupLine"><strong>${escapeHtml(match[1] ?? "")}</strong> ${escapeHtml(
    match[2] ?? "",
  )}</p>`;
}

function buildWebsterSection(rawHtml: string, requestedWord: string) {
  const $ = load(rawHtml);
  $("script, style, svg, img, button, input, nav, form").remove();
  $("a").each((_, element) => {
    $(element).replaceWith($(element).contents());
  });
  $("br").replaceWith("\n");

  const result = $(".result").first();
  const content = result.find(".result-content").first();
  const title = dedupeHeadword(result.find(".result-title").first().text()) || requestedWord;

  if (!content.length) {
    return null;
  }

  const paragraphs = content
    .find("p")
    .toArray()
    .map((element) => {
      const paragraph = $(element);
      const number = cleanWebsterText(paragraph.find("sn").first().text());
      const definition = cleanWebsterText(paragraph.find("def").first().text());
      const quote = cleanWebsterText(paragraph.find("blockquote").first().text());
      const heading = cleanWebsterText(paragraph.find("hw").first().text());
      const partOfSpeech = cleanWebsterText(paragraph.find("pos").first().text());
      const etymology = cleanWebsterText(
        paragraph
          .clone()
          .find("hw, pos, sn, def, blockquote, collocation, cd")
          .remove()
          .end()
          .text(),
      );
      const collocationText = cleanWebsterText(paragraph.find("collocation, cd").text());
      const fallback = cleanWebsterText(selectionToText($, paragraph));

      return {
        collocationText,
        definition,
        etymology,
        fallback,
        heading,
        number,
        partOfSpeech,
        quote,
      };
    })
    .filter((entry) => entry.fallback.length > 0);

  if (paragraphs.length === 0) {
    return null;
  }

  const first = paragraphs[0]!;
  const entryHeading = dedupeHeadword(first.heading || title || requestedWord);
  const entryPos = first.partOfSpeech;
  const entryEtymology = first.etymology
    .replace(new RegExp(`^${entryHeading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\.?`, "iu"), "")
    .trim();

  const htmlParts = [`<article class="lookupEntry lookupEntry--webster">`];
  htmlParts.push(`<p class="lookupEntryTitle">${escapeHtml(entryHeading)}</p>`);

  if (entryPos) {
    htmlParts.push(`<p class="lookupEntryMeta">${escapeHtml(entryPos)}</p>`);
  }

  if (entryEtymology) {
    htmlParts.push(`<p class="lookupLine"><em>${escapeHtml(entryEtymology)}</em></p>`);
  }

  const textLines = [entryHeading];

  if (entryPos) {
    textLines.push(entryPos);
  }

  if (entryEtymology) {
    textLines.push(entryEtymology);
  }

  for (const paragraph of paragraphs) {
    const senseLine = cleanWebsterText(
      [paragraph.number, paragraph.definition].filter(Boolean).join(" "),
    );

    if (senseLine) {
      htmlParts.push(formatSenseLine(senseLine));
      textLines.push(senseLine);
    } else if (paragraph.collocationText) {
      htmlParts.push(`<p class="lookupLine">${escapeHtml(paragraph.collocationText)}</p>`);
      textLines.push(paragraph.collocationText);
    } else if (
      paragraph.fallback &&
      paragraph.fallback !== entryHeading &&
      paragraph.fallback !== `${entryHeading} ${entryPos}`.trim()
    ) {
      htmlParts.push(`<p class="lookupLine">${escapeHtml(paragraph.fallback)}</p>`);
      textLines.push(paragraph.fallback);
    }

    if (paragraph.quote) {
      htmlParts.push(
        `<blockquote class="markdownQuote">${escapeHtml(paragraph.quote).replace(/\n/gu, "<br/>")}</blockquote>`,
      );
      textLines.push(paragraph.quote);
    }
  }

  htmlParts.push(`</article>`);

  return {
    canonicalWord: entryHeading,
    html: htmlParts.join(""),
    text: textLines.join("\n\n"),
  };
}

export async function lookupWebster(word: string): Promise<DictionarySourceResult> {
  const requestedWord = normalizeInlineText(word.normalize("NFC")).toLocaleLowerCase("en-US");

  if (!requestedWord) {
    return buildResult(
      requestedWord,
      "not_found",
      "Digite uma palavra inglesa para consultar Webster 1913.",
    );
  }

  try {
    const response = await fetch(
      `${WEBSTER_SOURCE_URL}words/${encodeURIComponent(requestedWord)}`,
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
        "Não consegui consultar Webster 1913 agora.",
      );
    }

    const html = decodeHtmlBuffer(Buffer.from(await response.arrayBuffer()));
    const section = buildWebsterSection(html, requestedWord);

    if (!section) {
      return buildResult(
        requestedWord,
        "not_found",
        `Não encontrei um verbete direto para "${requestedWord}" em Webster 1913.`,
      );
    }

    return buildResult(
      requestedWord,
      "found",
      "Verbete extraído do Webster's Revised Unabridged Dictionary de 1913.",
      [
        {
          html: section.html,
          label: "Webster 1913",
          text: section.text,
        },
      ],
      section.canonicalWord,
    );
  } catch {
    return buildResult(
      requestedWord,
      "unavailable",
      "Não consegui consultar Webster 1913 agora.",
    );
  }
}
