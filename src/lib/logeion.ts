import { load } from "cheerio";
import type { Element } from "domhandler";
import {
  escapeHtml,
  htmlFromText,
  normalizeInlineText,
  repairMojibake,
  selectionToText,
} from "./dictionary-utils";
import { detectLookupLanguage } from "./lookup-language";
import type { DictionarySourceResult, LookupContext, LookupSection } from "./lookup-types";

const LOGEION_API = "https://anastrophe.uchicago.edu/logeion-api";
const USER_AGENT = "Mathesis/1.0 classical lookup";
const MAX_SECTION_TEXT = 20000;
const LOGEION_STRIP_SELECTORS = [
  "script",
  "style",
  "textarea",
  "svg",
  "noscript",
  "iframe",
  "img",
  "button",
  "input",
  "form",
].join(", ");
const LOGEION_ALLOWED_TAGS = new Set([
  "b",
  "blockquote",
  "br",
  "div",
  "em",
  "hr",
  "i",
  "li",
  "ol",
  "p",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
]);
const LOGEION_LABELS: Record<string, string> = {
  DMLBSx: "DMLBS",
  Lewis: "Lewis Elementary",
  LewisShort: "Lewis & Short",
};

type LogeionFindResponse = {
  description?: string;
  parses?: Array<{ lemma?: string; parse?: string }>;
  word?: string;
};

type LogeionDetailResponse = {
  detail?: {
    dicos?: Array<{ dname?: string; es?: string[] }>;
    headword?: string;
    shortdef?: string[];
  };
  info?: {
    frequency?: Array<{
      authorList?: Array<{ author?: string; authorSearch?: string }>;
      rank?: string;
      word?: string;
    }>;
  };
};

type LogeionFrequencyEntry = NonNullable<
  NonNullable<LogeionDetailResponse["info"]>["frequency"]
>[number];

function buildResult(
  requestedWord: string,
  status: DictionarySourceResult["status"],
  note: string,
  sections: LookupSection[] = [],
  canonicalWord = requestedWord,
): DictionarySourceResult {
  return {
    canonicalWord,
    label: "Logeion",
    note,
    sections,
    sourceId: "logeion",
    sourceUrl: `https://logeion.uchicago.edu/${encodeURIComponent(canonicalWord)}`,
    status,
  };
}

function cleanLogeionText(html: string) {
  const $ = load(`<div>${html}</div>`);
  const text = selectionToText($, $("div"));
  return (repairMojibake(text) ?? text).normalize("NFC");
}

function displayLogeionLabel(label: string) {
  return LOGEION_LABELS[label] ?? label;
}

function unwrapNode($: ReturnType<typeof load>, element: Element) {
  $(element).replaceWith($(element).contents());
}

function sanitizeLogeionHtml(html: string) {
  const $ = load(`<div class="logeionEntry">${html}</div>`);
  const root = $(".logeionEntry").first();

  root.find(LOGEION_STRIP_SELECTORS).remove();

  root.find("*").each((_, node) => {
    if (node.type !== "tag") {
      return;
    }

    const element = node as Element;
    const tagName = element.tagName.toLowerCase();
    const current = $(element);

    if (tagName === "a" || tagName === "font") {
      unwrapNode($, element);
      return;
    }

    if (!LOGEION_ALLOWED_TAGS.has(tagName)) {
      unwrapNode($, element);
      return;
    }

    const originalClasses = new Set(
      (current.attr("class") ?? "")
        .split(/\s+/u)
        .map((item) => item.trim())
        .filter(Boolean),
    );
    const isCorpusHit =
      tagName === "mark" ||
      originalClasses.has("highlight") ||
      originalClasses.has("philologic-highlight");
    const style = current.attr("style") ?? "";
    const safeClasses = new Set<string>();

    if (isCorpusHit) {
      current.replaceWith(
        `<strong class="corpusSearchHit">${escapeHtml(current.text())}</strong>`,
      );
      return;
    }

    if (originalClasses.has("bullet")) {
      safeClasses.add("logeionBullet");
    }

    if (originalClasses.has("content")) {
      safeClasses.add("logeionContent");
    }

    if (originalClasses.has("dictlink") || originalClasses.has("dicttitle")) {
      safeClasses.add("logeionDictionaryLabel");
    }

    if (/small-caps/iu.test(style)) {
      safeClasses.add("logeionSmallCaps");
    }

    for (const attr of Object.keys(element.attribs ?? {})) {
      current.removeAttr(attr);
    }

    if (safeClasses.size > 0) {
      current.attr("class", [...safeClasses].join(" "));
    }
  });

  root.find("br").replaceWith("<br>");

  const cleaned = repairMojibake(root.html()?.trim() ?? "");
  const content = cleaned && cleaned.length > 0 ? cleaned.normalize("NFC") : null;

  return content ? `<div class="logeionEntry">${content}</div>` : null;
}

function trimSectionText(value: string) {
  const normalized = normalizeInlineText((repairMojibake(value) ?? value).replace(/\s*\n\s*/g, "\n"));

  if (normalized.length <= MAX_SECTION_TEXT) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_SECTION_TEXT).trim()}...`;
}

function buildShortDefSection(shortdefs: string[] | undefined): LookupSection | null {
  if (!shortdefs?.length) {
    return null;
  }

  const text = trimSectionText(shortdefs.map((item) => repairMojibake(item) ?? item).join("\n"));

  return {
    html: htmlFromText(text),
    label: "Definição rápida",
    text,
  };
}

function buildMorphologySection(
  parses: Array<{ lemma?: string; parse?: string }> | undefined,
): LookupSection | null {
  if (!parses?.length) {
    return null;
  }

  const text = trimSectionText(
    parses
      .map((item) =>
        repairMojibake(normalizeInlineText(`${item.lemma ?? ""} ${item.parse ?? ""}`)) ?? "",
      )
      .filter(Boolean)
      .join("\n"),
  );

  if (!text) {
    return null;
  }

  return {
    html: htmlFromText(text),
    label: "Forma",
    text,
  };
}

function buildExamplesCorpusSection(
  entry: { dname?: string; es?: string[] },
): LookupSection | null {
  const label = normalizeInlineText(entry.dname ?? "");

  if (!label || label !== "Examples from the corpus") {
    return null;
  }

  const $ = load(`<div>${(entry.es ?? []).join("")}</div>`);
  const items = $("li")
    .toArray()
    .map((item) => {
      const node = $(item);
      const author = normalizeInlineText(node.find("as").first().text());
      const work = normalizeInlineText(node.find("ws").first().text());
      const excerptNode = node.clone();

      excerptNode.find("as, ws").remove();

      const rawText =
        repairMojibake(normalizeInlineText(excerptNode.text())) ?? "";
      const excerptHtml = sanitizeLogeionHtml(excerptNode.html() ?? "");

      if (!rawText) {
        return null;
      }

      const lines = [
        rawText,
        author ? `Autor: ${author}` : null,
        work ? `Obra: ${work}` : null,
      ].filter(Boolean) as string[];

      const metadataHtml = [
        author ? `<p class="lookupEntryMeta">Autor: ${escapeHtml(author)}</p>` : null,
        work ? `<p class="lookupEntryMeta">Obra: ${escapeHtml(work)}</p>` : null,
      ]
        .filter(Boolean)
        .join("");

      return {
        html: `<article class="lookupEntry corpusHitCard">${
          excerptHtml ?? htmlFromText(rawText) ?? ""
        }${metadataHtml}</article>`,
        text: lines.join("\n"),
      };
    })
    .filter((value): value is { html: string; text: string } => Boolean(value));

  if (items.length === 0) {
    return null;
  }

  const text = trimSectionText(items.map((item) => item.text).join("\n\n"));
  const html = items.map((item) => item.html).join("");

  return {
    html,
    label,
    text,
  };
}

function buildDictionarySections(
  dicos: Array<{ dname?: string; es?: string[] }> | undefined,
): LookupSection[] {
  if (!dicos?.length) {
    return [];
  }

  return dicos
    .map((entry): LookupSection | null => {
      const label = normalizeInlineText(entry.dname ?? "");
      const corpusExamplesSection = buildExamplesCorpusSection(entry);

      if (corpusExamplesSection) {
        return corpusExamplesSection;
      }

      const text = trimSectionText(
        (entry.es ?? [])
          .map((item) => cleanLogeionText(item))
          .filter(Boolean)
          .join("\n\n"),
      );
      const html = sanitizeLogeionHtml((entry.es ?? []).join("\n"));

      if (!label || !text) {
        return null;
      }

      return {
        html: html ?? htmlFromText(text),
        label: displayLogeionLabel(label),
        text,
      };
    })
    .filter((section): section is LookupSection => section !== null);
}

function buildFrequencySection(
  frequency: LogeionFrequencyEntry[] | undefined,
): LookupSection | null {
  const first = frequency?.[0];

  if (!first) {
    return null;
  }

  const lines = [
    first.rank ? `Frequencia: ${repairMojibake(first.rank) ?? first.rank}.` : null,
    first.authorList?.length
      ? `Autores recorrentes: ${first.authorList
          .map((item) => repairMojibake(item.author?.trim() ?? "") ?? "")
          .filter(Boolean)
          .slice(0, 6)
          .join(", ")}.`
      : null,
  ].filter(Boolean) as string[];

  if (lines.length === 0) {
    return null;
  }

  const text = trimSectionText(lines.join("\n"));

  return {
    html: htmlFromText(text),
    label: "Frequência",
    text,
  };
}

async function fetchJson<T>(url: URL) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
    },
    next: { revalidate: 60 * 60 * 24 * 30 },
  });

  if (!response.ok) {
    throw new Error(`Logeion respondeu com status ${response.status}.`);
  }

  return (await response.json()) as T;
}

async function fetchDetail(word: string) {
  const detailUrl = new URL(`${LOGEION_API}/detail`);
  detailUrl.searchParams.set("w", word);
  detailUrl.searchParams.set("type", "normal");
  return fetchJson<LogeionDetailResponse>(detailUrl);
}

function scoreDetailPayload(payload: LogeionDetailResponse) {
  const dicoCount = payload.detail?.dicos?.length ?? 0;
  const shortdefCount = payload.detail?.shortdef?.length ?? 0;
  const frequencyCount = payload.info?.frequency?.length ?? 0;
  return dicoCount * 100 + shortdefCount * 10 + frequencyCount;
}

export async function lookupLogeion(
  word: string,
  context?: LookupContext,
): Promise<DictionarySourceResult> {
  const requestedWord = normalizeInlineText(word.normalize("NFC"));
  const preferredLanguage = detectLookupLanguage(requestedWord, context);

  if (preferredLanguage === "portuguese") {
    return buildResult(
      requestedWord,
      "not_found",
      "Digite uma forma latina para consultar o Logeion.",
    );
  }

  const findUrl = new URL(`${LOGEION_API}/find`);
  findUrl.searchParams.set("w", requestedWord);

  const findPayload = await fetchJson<LogeionFindResponse>(findUrl);
  const lemmaCandidate =
    normalizeInlineText(findPayload.parses?.[0]?.lemma ?? requestedWord) || requestedWord;

  const requestedDetailPromise = fetchDetail(requestedWord);
  const lemmaDetailPromise =
    lemmaCandidate !== requestedWord ? fetchDetail(lemmaCandidate) : null;

  const [requestedDetailPayload, lemmaDetailPayload] = await Promise.all([
    requestedDetailPromise,
    lemmaDetailPromise,
  ]);

  const detailPayload =
    lemmaDetailPayload && scoreDetailPayload(lemmaDetailPayload) > scoreDetailPayload(requestedDetailPayload)
      ? lemmaDetailPayload
      : requestedDetailPayload;

  const canonicalWord =
    normalizeInlineText(
      detailPayload.detail?.headword ??
        lemmaCandidate ??
        requestedWord,
    ) || requestedWord;

  const sections = [
    ...buildDictionarySections(detailPayload.detail?.dicos),
    buildShortDefSection(detailPayload.detail?.shortdef),
    buildMorphologySection(findPayload.parses),
    buildFrequencySection(detailPayload.info?.frequency),
  ].filter((section): section is LookupSection => section !== null);

  if (sections.length === 0) {
    return buildResult(
      requestedWord,
      "not_found",
      `O Logeion nao encontrou um verbete direto para "${requestedWord}".`,
      [],
      canonicalWord,
    );
  }

  return buildResult(
    requestedWord,
    "found",
    "Verbete lexical do Logeion para latim.",
    sections,
    canonicalWord,
  );
}
