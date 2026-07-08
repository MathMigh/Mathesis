import { load } from "cheerio";
import {
  decodeHtmlBuffer,
  escapeHtml,
  normalizeInlineText,
  repairMojibake,
  selectionToText,
} from "./dictionary-utils";
import type { DictionarySourceResult, LookupSection } from "./lookup-types";

const JOHNSON_SEARCH_ENDPOINT =
  "https://johnsonsdictionaryonline.com/ajax/search_mysql_new.php";
const JOHNSON_DISPLAY_ENDPOINT =
  "https://johnsonsdictionaryonline.com/ajax/displayWord.php";
const JOHNSON_SOURCE_URL = "https://johnsonsdictionaryonline.com/views/search.php";
const USER_AGENT = "Mathesis/1.0 Johnson dictionary";
const MAX_ENTRIES = 4;

type JohnsonSearchResponse = {
  filenames?: string[];
  headwords?: string[];
  labels?: string[];
  pageimages?: string[];
  permalinks?: string[];
};

type JohnsonCandidate = {
  filename: string;
  headword: string;
  index: number;
  label: string;
  permalink: string;
};

function buildResult(
  requestedWord: string,
  status: DictionarySourceResult["status"],
  note: string,
  sections: LookupSection[] = [],
  canonicalWord = requestedWord,
): DictionarySourceResult {
  return {
    canonicalWord,
    label: "Johnson",
    note,
    sections,
    sourceId: "johnson",
    sourceUrl: `${JOHNSON_SOURCE_URL}?term=${encodeURIComponent(requestedWord)}`,
    status,
  };
}

async function postForm(url: string, data: Record<string, string>) {
  const response = await fetch(url, {
    body: new URLSearchParams(data),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": USER_AGENT,
    },
    method: "POST",
    next: { revalidate: 60 * 60 * 24 * 30 },
    signal: AbortSignal.timeout(14000),
  });

  if (!response.ok) {
    throw new Error(`Johnson respondeu com status ${response.status}.`);
  }

  return decodeHtmlBuffer(Buffer.from(await response.arrayBuffer()));
}

async function searchHeadword(requestedWord: string) {
  const raw = await postForm(JOHNSON_SEARCH_ENDPOINT, {
    andOr: "and",
    groupname: "",
    query: "headword",
    searchNumber: "0",
    searchYear: "1755",
    searchterm: requestedWord.replace(/'/gu, ""),
  });

  if (!raw.trim()) {
    return null;
  }

  return JSON.parse(raw) as JohnsonSearchResponse;
}

function getDirectoryForFilename() {
  return `/db/apps/sjd/data/1755/`;
}

async function fetchEntryHtml(filename: string) {
  return postForm(JOHNSON_DISPLAY_ENDPOINT, {
    directory: getDirectoryForFilename(),
    filename,
    folio: "1755",
    ip: "",
    query: "display-word.xq",
  });
}

function scoreJohnsonCandidate(requestedWord: string, candidate: JohnsonCandidate) {
  const requested = requestedWord.toLocaleLowerCase("en-US");
  const label = candidate.label.toLocaleLowerCase("en-US");
  const headword = candidate.headword.toLocaleLowerCase("en-US");
  let score = 0;

  if (label === `${requested}, n.s.` || label === `${requested}, v.a.` || label === `${requested}, v.n.`) {
    score += 120;
  }

  if (label.startsWith(`${requested},`)) {
    score += 95;
  }

  if (headword === requested) {
    score += 70;
  }

  if (label === requested) {
    score += 50;
  }

  if (candidate.permalink === requested) {
    score += 25;
  }

  return score - candidate.index;
}

function buildCandidates(payload: JohnsonSearchResponse) {
  const filenames = payload.filenames ?? [];
  const labels = payload.labels ?? [];
  const headwords = payload.headwords ?? [];
  const permalinks = payload.permalinks ?? [];

  return filenames.map((filename, index) => ({
    filename,
    headword: normalizeInlineText(headwords[index] ?? ""),
    index,
    label: normalizeInlineText(labels[index] ?? ""),
    permalink: normalizeInlineText(permalinks[index] ?? ""),
  }));
}

function dedupeHeadword(value: string) {
  const cleaned = normalizeInlineText(repairMojibake(value) ?? value);
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

function stripRepeatedSenseNumber(number: string, definition: string) {
  if (!number || !definition) {
    return definition;
  }

  const normalizedNumber = number.replace(/\./gu, "\\.");
  return definition.replace(new RegExp(`^${normalizedNumber}\\s*`, "u"), "").trim();
}

function cleanEntryHtml(rawHtml: string) {
  const $ = load(rawHtml);
  $("script, style, svg, img, button, input, nav, form").remove();
  $("a").each((_, element) => {
    $(element).replaceWith($(element).contents());
  });
  $("br").replaceWith("\n");

  const root = $("body div").last();

  if (!root.length) {
    return null;
  }

  const heading = dedupeHeadword(root.find("headword").first().text())
    .replace(/\s+/gu, " ")
    .trim();
  const partOfSpeech = normalizeInlineText(root.find(".gramGrp").first().text());
  const etymology = normalizeInlineText(repairMojibake(root.find(".etym").first().text()) ?? "");

  const senses = root
    .find("sense")
    .toArray()
    .map((element) => {
      const sense = $(element);
      const number = normalizeInlineText(sense.find("num").first().text());
      const usage = normalizeInlineText(sense.find(".usg").first().text());
      const rawDefinition = normalizeInlineText(
        repairMojibake(sense.find("sjddef").first().text()) ??
          sense.find("sjddef").first().text(),
      );
      const definition = stripRepeatedSenseNumber(number, rawDefinition);
      const quotations = sense
        .find("quotebibl")
        .toArray()
        .map((quoteElement) =>
          normalizeInlineText(
            repairMojibake(selectionToText($, $(quoteElement))) ??
              selectionToText($, $(quoteElement)),
          ),
        )
        .filter(Boolean);
      const fallback = normalizeInlineText(
        repairMojibake(selectionToText($, sense)) ?? selectionToText($, sense),
      );

      return {
        definition,
        fallback,
        number,
        quotations,
        usage,
      };
    })
    .filter((sense) => sense.definition || sense.fallback);

  if (!heading && senses.length === 0) {
    return null;
  }

  const textParts = [heading];
  const htmlParts = [`<article class="lookupEntry lookupEntry--johnson">`];

  if (heading) {
    htmlParts.push(`<p class="lookupEntryTitle">${escapeHtml(heading)}</p>`);
  }

  if (partOfSpeech || etymology) {
    htmlParts.push(
      `<p class="lookupEntryMeta">${escapeHtml(
        [partOfSpeech, etymology].filter(Boolean).join(" "),
      )}</p>`,
    );
    textParts.push([partOfSpeech, etymology].filter(Boolean).join(" "));
  }

  for (const sense of senses) {
    const mainLine = normalizeInlineText(
      [sense.number, sense.usage, sense.definition].filter(Boolean).join(" "),
    );
    const fallbackLine = sense.fallback && sense.fallback !== mainLine ? sense.fallback : "";

    if (mainLine) {
      const match = /^(\d+\.)\s*(.+)$/u.exec(mainLine);

      if (match) {
        htmlParts.push(
          `<p class="lookupLine"><strong>${escapeHtml(match[1] ?? "")}</strong> ${escapeHtml(
            match[2] ?? "",
          )}</p>`,
        );
      } else {
        htmlParts.push(`<p class="lookupLine">${escapeHtml(mainLine)}</p>`);
      }

      textParts.push(mainLine);
    } else if (fallbackLine) {
      htmlParts.push(`<p class="lookupLine">${escapeHtml(fallbackLine)}</p>`);
      textParts.push(fallbackLine);
    }

    for (const quotation of sense.quotations) {
      htmlParts.push(
        `<blockquote class="markdownQuote">${escapeHtml(quotation).replace(/\n/gu, "<br/>")}</blockquote>`,
      );
      textParts.push(quotation);
    }
  }

  htmlParts.push(`</article>`);

  return {
    html: htmlParts.join(""),
    text: textParts.filter(Boolean).join("\n\n"),
  };
}

export async function lookupJohnson(word: string): Promise<DictionarySourceResult> {
  const requestedWord = normalizeInlineText(word.normalize("NFC")).toLocaleLowerCase("en-US");

  if (!requestedWord) {
    return buildResult(
      requestedWord,
      "not_found",
      "Digite uma palavra inglesa para consultar Johnson.",
    );
  }

  let searchPayload: JohnsonSearchResponse | null = null;

  try {
    searchPayload = await searchHeadword(requestedWord);
  } catch {
    return buildResult(
      requestedWord,
      "unavailable",
      "Não consegui consultar o dicionário de Samuel Johnson agora.",
    );
  }

  const candidates = buildCandidates(searchPayload ?? {}).sort(
    (left, right) =>
      scoreJohnsonCandidate(requestedWord, right) - scoreJohnsonCandidate(requestedWord, left),
  );

  if (candidates.length === 0) {
    return buildResult(
      requestedWord,
      "not_found",
      `Não encontrei um verbete direto para "${requestedWord}" em Samuel Johnson.`,
    );
  }

  const sections: LookupSection[] = [];

  for (const candidate of candidates.slice(0, MAX_ENTRIES)) {
    try {
      const entry = cleanEntryHtml(await fetchEntryHtml(candidate.filename));

      if (!entry) {
        continue;
      }

      sections.push({
        html: entry.html,
        label: candidate.label || String(sections.length + 1),
        text: entry.text,
      });
    } catch {
      continue;
    }
  }

  if (sections.length === 0) {
    return buildResult(
      requestedWord,
      "unavailable",
      "Encontrei o verbete em Johnson, mas nao consegui extrair a transcricao desta vez.",
      [],
      candidates[0]?.headword ?? requestedWord,
    );
  }

  return buildResult(
    requestedWord,
    "found",
    "Verbete extraído do dicionário de Samuel Johnson.",
    sections,
    candidates[0]?.headword ?? requestedWord,
  );
}
