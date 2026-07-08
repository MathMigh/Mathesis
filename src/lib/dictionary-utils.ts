import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode, Element, Text } from "domhandler";
import iconv from "iconv-lite";

const DEFAULT_STRIP_SELECTORS = [
  "script",
  "style",
  "textarea",
  "svg",
  "noscript",
  "iframe",
  "img",
  "button",
  "input",
].join(", ");

const BROKEN_TEXT_PATTERN =
  /(?:\u00c3.|\u00c2.|\u00e2(?:\u20ac|\u20ac\u2122|\u20ac\u0153)|\u00c4.|\u00c5.|\u00ce.|\u00cf.|\uFFFD)/g;

function countMatches(value: string, pattern: RegExp) {
  return value.match(pattern)?.length ?? 0;
}

function scoreDecodedHtml(value: string) {
  return countMatches(value, /\uFFFD/g) * 8 + countMatches(value, BROKEN_TEXT_PATTERN) * 4;
}

function pickBestDecodedValue(values: string[]) {
  return values.reduce((best, current) =>
    scoreDecodedHtml(current) < scoreDecodedHtml(best) ? current : best,
  );
}

function unwrapElement($: CheerioAPI, element: AnyNode) {
  $(element).replaceWith($(element).contents());
}

function stripUnsafeAttributes($: CheerioAPI, selection: Cheerio<AnyNode>) {
  selection.add(selection.find("*")).each((_, node) => {
    if (node.type !== "tag") {
      return;
    }

    const element = node as Element;
    const current = $(element);
    const attributes = Object.keys(element.attribs ?? {});

    for (const name of attributes) {
      if (name !== "class") {
        current.removeAttr(name);
      }
    }

    if (
      element.tagName === "a" ||
      element.tagName === "form" ||
      element.tagName === "font"
    ) {
      unwrapElement($, element);
      return;
    }

    if (element.tagName === "div" && !current.attr("class")) {
      unwrapElement($, element);
    }
  });
}

function repairTextNodes(selection: Cheerio<AnyNode>) {
  selection.add(selection.find("*")).contents().each((_, node) => {
    if (node.type !== "text") {
      return;
    }

    const textNode = node as Text;
    const repaired = repairMojibake(textNode.data);

    if (repaired && repaired !== textNode.data) {
      textNode.data = repaired;
    }
  });
}

export function normalizeLineText(value: string) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export function normalizeInlineText(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function htmlFromText(value: string | null) {
  if (!value) {
    return null;
  }

  return value
    .split("\n")
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
}

function repairPortugueseLabels(value: string) {
  return value
    .replace(/\bEtimologia\b/g, "Etimologia")
    .replace(/\bFormacao\b/g, "Formação")
    .replace(/\bEvolucao\b/g, "Evolução")
    .replace(/\bObservacoes\b/g, "Observações")
    .replace(/\bcomposicao\b/g, "composição")
    .replace(/\badaptacao\b/g, "adaptação")
    .replace(/\batestada\b/g, "atestada")
    .replace(/\bprovavel\b/g, "provável")
    .replace(/\bsemantica\b/g, "semântica")
    .replace(/\bfonetica\b/g, "fonética")
    .replace(/\bgrafica\b/g, "gráfica")
    .replace(/\bPortugues\b/g, "Português");
}

function repairPortugueseLabelsSafe(value: string) {
  return repairPortugueseLabels(value).replace(/\bPortugu[êę]s\b/g, "Português");
}

function formatInlineMarkdown(value: string) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/gu, "<code>$1</code>")
    .replace(/\*\*([^\n]+?)\*\*/gu, "<strong>$1</strong>")
    .replace(/__([^\n]+?)__/gu, "<strong>$1</strong>")
    .replace(/(^|[\s([{])\*([^*\n]+)\*(?=[\s,.;:!?)]|$)/gu, "$1<em>$2</em>")
    .replace(/(^|[\s([{])_([^_\n]+)_(?=[\s,.;:!?)]|$)/gu, "$1<em>$2</em>");
}

export function cleanAiMarkdown(value: string | null) {
  if (!value) {
    return "";
  }

  const repaired = repairPortugueseLabelsSafe(repairMojibake(value) ?? value)
    .replace(/^\s*```(?:markdown|md)?\s*/iu, "")
    .replace(/\s*```\s*$/u, "")
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ");

  return repaired
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .replace(/\s+([,.;:!?])/gu, "$1")
    .trim();
}

export function htmlFromMarkdown(value: string | null) {
  const cleaned = cleanAiMarkdown(value);

  if (!cleaned) {
    return null;
  }

  const htmlParts: string[] = [];
  const paragraphLines: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }

    htmlParts.push(
      `<p>${formatInlineMarkdown(paragraphLines.join(" ").replace(/\s+/g, " ").trim())}</p>`,
    );
    paragraphLines.length = 0;
  };

  const flushList = () => {
    if (listItems.length === 0) {
      return;
    }

    htmlParts.push(
      `<ul class="markdownList">${listItems
        .map((item) => `<li>${formatInlineMarkdown(item)}</li>`)
        .join("")}</ul>`,
    );
    listItems = [];
  };

  for (const rawLine of cleaned.split("\n")) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = /^(#{1,4})\s+(.+)$/u.exec(line);

    if (headingMatch) {
      flushParagraph();
      flushList();
      htmlParts.push(
        `<h4 class="markdownHeading">${formatInlineMarkdown(headingMatch[2] ?? "")}</h4>`,
      );
      continue;
    }

    const quoteMatch = /^>\s?(.+)$/u.exec(line);

    if (quoteMatch) {
      flushParagraph();
      flushList();
      htmlParts.push(
        `<blockquote class="markdownQuote">${formatInlineMarkdown(
          quoteMatch[1] ?? "",
        )}</blockquote>`,
      );
      continue;
    }

    const bulletMatch = /^(?:[-*•]|\d+[.)])\s+(.+)$/u.exec(line);

    if (bulletMatch) {
      flushParagraph();
      listItems.push(bulletMatch[1] ?? "");
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();

  return htmlParts.join("");
}

export function decodeHtmlBuffer(buffer: Buffer) {
  return pickBestDecodedValue([
    buffer.toString("utf8"),
    iconv.decode(buffer, "win1252"),
    iconv.decode(buffer, "latin1"),
  ]);
}

export function repairMojibake(value: string | null) {
  if (!value) {
    return value;
  }

  const brokenPattern = new RegExp(BROKEN_TEXT_PATTERN.source, "g");

  if (!brokenPattern.test(value)) {
    return value;
  }

  const candidates = [value];
  let current = value;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const repaired = Buffer.from(current, "latin1").toString("utf8");

    if (repaired === current) {
      break;
    }

    candidates.push(repaired);
    current = repaired;
  }

  return pickBestDecodedValue(candidates);
}

export function prepareSelection(
  $: CheerioAPI,
  selection: Cheerio<AnyNode>,
  extraStripSelectors: string[] = [],
) {
  const clone = selection.clone();
  const selectors = [...extraStripSelectors, DEFAULT_STRIP_SELECTORS]
    .filter(Boolean)
    .join(", ");

  if (selectors) {
    clone.find(selectors).remove();
  }

  repairTextNodes(clone);
  return clone;
}

export function selectionToText(
  $: CheerioAPI,
  selection: Cheerio<AnyNode>,
  extraStripSelectors: string[] = [],
) {
  const clone = prepareSelection($, selection, extraStripSelectors);

  clone.find("a, form, font").each((_, element) => {
    unwrapElement($, element);
  });

  clone.find("br").replaceWith("\n");
  clone
    .find("p, li, h1, h2, h3, h4, h5, h6, div, article, section")
    .each((_, element) => {
      $(element).append("\n");
    });

  return normalizeLineText(repairMojibake(clone.text()) ?? clone.text());
}

export function selectionToHtml(
  $: CheerioAPI,
  selection: Cheerio<AnyNode>,
  extraStripSelectors: string[] = [],
) {
  const clone = prepareSelection($, selection, extraStripSelectors);

  stripUnsafeAttributes($, clone);

  const html = repairMojibake(clone.html()?.trim() ?? "");
  return html && html.length > 0 ? html : null;
}
