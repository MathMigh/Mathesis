import DOMPurify from "dompurify";
import { repairMojibake } from "@/lib/dictionary-utils";
import {
  createLoadingSource,
  getLookupSourceLabel,
} from "@/lib/lookup-source-config";
import { getLookupSourceIdsForWord } from "@/lib/lookup-language";
import type {
  DictionarySourceId,
  DictionarySourceResult,
  LookupContext,
  LookupPayload,
} from "@/lib/lookup-types";

const LOOKUP_ALLOWED_TAGS = [
  "a",
  "blockquote",
  "br",
  "code",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
] as const;

const LOOKUP_ALLOWED_ATTR = [
  "alt",
  "class",
  "colspan",
  "href",
  "loading",
  "referrerpolicy",
  "rel",
  "rowspan",
  "scope",
  "src",
  "target",
] as const;

function buildLookupProxyImageUrl(value: string) {
  return `/api/image-proxy?src=${encodeURIComponent(value)}`;
}

function escapeHtmlText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function cleanDisplayMarkdown(value: string) {
  return (repairMojibake(value) ?? value)
    .replace(/\r/g, "")
    .replace(/^\s*```(?:markdown|md)?\s*/iu, "")
    .replace(/\s*```\s*$/u, "")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function formatInlineDisplayMarkdown(value: string) {
  return escapeHtmlText(value)
    .replace(/`([^`]+)`/gu, "<code>$1</code>")
    .replace(/\*\*([^\n]+?)\*\*/gu, "<strong>$1</strong>")
    .replace(/__([^\n]+?)__/gu, "<strong>$1</strong>")
    .replace(/(^|[\s([{])\*([^*\n]+)\*(?=[\s,.;:!?)]|$)/gu, "$1<em>$2</em>")
    .replace(/(^|[\s([{])_([^_\n]+)_(?=[\s,.;:!?)]|$)/gu, "$1<em>$2</em>");
}

function htmlFromDisplayMarkdown(value: string) {
  const cleaned = cleanDisplayMarkdown(value);

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
      `<p>${formatInlineDisplayMarkdown(
        paragraphLines.join(" ").replace(/\s+/g, " ").trim(),
      )}</p>`,
    );
    paragraphLines.length = 0;
  };

  const flushList = () => {
    if (listItems.length === 0) {
      return;
    }

    htmlParts.push(
      `<ul class="markdownList">${listItems
        .map((item) => `<li>${formatInlineDisplayMarkdown(item)}</li>`)
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
        `<h4 class="markdownHeading">${formatInlineDisplayMarkdown(
          headingMatch[2] ?? "",
        )}</h4>`,
      );
      continue;
    }

    const quoteMatch = /^>\s?(.+)$/u.exec(line);

    if (quoteMatch) {
      flushParagraph();
      flushList();
      htmlParts.push(
        `<blockquote class="markdownQuote">${formatInlineDisplayMarkdown(
          quoteMatch[1] ?? "",
        )}</blockquote>`,
      );
      continue;
    }

    const bulletMatch = /^(?:[-*\u2022]|\d+[.)])\s+(.+)$/u.exec(line);

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

function sanitizeEtymologySectionText(value: string) {
  return cleanDisplayMarkdown(value)
    .replace(/^\s*\*\*(?:Origem imediata|Origem)\*\*\s*:?\s*/gimu, "")
    .replace(/^\s*(?:Origem imediata|Origem)\s*:?\s*/gimu, "")
    .replace(/^\s*\*\*Grau de certeza:\*\*.*$/gimu, "")
    .replace(/^\s*Grau de certeza\s*:.*$/gimu, "")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function basicSanitizeLookupHtml(value: string) {
  const allowedTagsPattern = LOOKUP_ALLOWED_TAGS.join("|");

  return value
    .replace(
      /<\s*(audio|canvas|form|iframe|input|object|script|style|textarea|video)\b[\s\S]*?<\s*\/\s*\1\s*>/giu,
      "",
    )
    .replace(
      /<\s*(audio|canvas|form|iframe|input|object|script|style|textarea|video)\b[^>]*\/?\s*>/giu,
      "",
    )
    .replace(/\s+on[a-z-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/giu, "")
    .replace(/\s+style\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/giu, "")
    .replace(
      /\s+(href|src)\s*=\s*(["'])\s*(?:javascript:|vbscript:|data:text\/html|\/\/)[\s\S]*?\2/giu,
      "",
    )
    .replace(
      /<img\b(?:(?!>).)*\bsrc\s*=\s*(["'])(?!\/api\/image-proxy\?src=|data:image\/|blob:)[\s\S]*?\1(?:(?!>).)*>/giu,
      "",
    )
    .replace(
      new RegExp(
        `<(?!/?(?:${allowedTagsPattern})(?:\\s|>|/))/?[^>]+>`,
        "giu",
      ),
      "",
    )
    .trim();
}

export function getDisplaySourceLabel(source: DictionarySourceResult) {
  const repairedLabel = repairMojibake(source.label) ?? source.label;

  if (source.sourceId === "analogico") {
    return "Analogia";
  }

  if (source.sourceId === "mitologico") {
    return "Mitologia";
  }

  return repairedLabel;
}

function getDisplaySourceNote(source: DictionarySourceResult) {
  const repairedNote = source.note
    ? repairMojibake(source.note) ?? source.note
    : source.note;

  if (source.status === "found") {
    if (source.sourceId === "etimologia") {
      return repairedNote ?? "Nota etimol\u00f3gica para apoiar a leitura.";
    }

    if (source.sourceId === "gramatica") {
      return "Verbete gramatical organizado a partir da Nova gram\u00e1tica do portugu\u00eas contempor\u00e2neo, de Celso Cunha e Lindley Cintra.";
    }

    if (source.sourceId === "wikipedia") {
      return "Panorama enciclop\u00e9dico da Wikipedia para apoiar a leitura.";
    }

    if (
      source.sourceId === "mitologico" &&
      (!source.note || /^nota mitol[o\u00f3]gica gerada por ia/i.test(source.note))
    ) {
      return "Nota mitol\u00f3gica gerada por IA para apoiar a leitura.";
    }
  }

  return repairedNote;
}

function sanitizeLookupHtml(value: string | null) {
  if (!value) {
    return null;
  }

  const repaired = repairMojibake(value) ?? value;
  const purifyCandidate = DOMPurify as unknown as {
    default?: { sanitize?: (dirty: string, config: object) => string };
    sanitize?: (dirty: string, config: object) => string;
  };
  const sanitizable =
    typeof purifyCandidate.sanitize === "function"
      ? purifyCandidate
      : typeof purifyCandidate.default?.sanitize === "function"
        ? purifyCandidate.default
        : null;

  if (!sanitizable || typeof window === "undefined") {
    return basicSanitizeLookupHtml(repaired);
  }

  const sanitize = sanitizable.sanitize;

  if (typeof sanitize !== "function") {
    return basicSanitizeLookupHtml(repaired);
  }

  const sanitized = sanitize(repaired, {
    ALLOWED_ATTR: [...LOOKUP_ALLOWED_ATTR],
    ALLOWED_TAGS: [...LOOKUP_ALLOWED_TAGS],
    FORBID_ATTR: ["style"],
    FORBID_TAGS: [
      "audio",
      "canvas",
      "form",
      "iframe",
      "input",
      "object",
      "script",
      "style",
      "textarea",
      "video",
    ],
    USE_PROFILES: { html: true },
  });
  const template = window.document.createElement("template");
  template.innerHTML = sanitized;

  template.content.querySelectorAll("a[href]").forEach((anchor) => {
    const href = anchor.getAttribute("href")?.trim() ?? "";

    if (!/^(?:https?:|\/|#)/iu.test(href)) {
      anchor.removeAttribute("href");
      anchor.removeAttribute("target");
      anchor.removeAttribute("rel");
      return;
    }

    if (/^https?:/iu.test(href) || anchor.getAttribute("target") === "_blank") {
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noreferrer noopener");
    }
  });

  template.content.querySelectorAll("img[src]").forEach((image) => {
    const src = image.getAttribute("src")?.trim() ?? "";

    if (/^https?:/iu.test(src)) {
      image.setAttribute("src", buildLookupProxyImageUrl(src));
    } else if (!/^(?:\/api\/image-proxy\?src=|data:image\/|blob:)/iu.test(src)) {
      image.remove();
      return;
    }

    image.setAttribute("loading", "lazy");
    image.setAttribute("referrerpolicy", "no-referrer");
  });

  return template.innerHTML.trim() || null;
}

function getDisplaySections(source: DictionarySourceResult) {
  return source.sections.map((section) => {
    const repairedLabel = repairMojibake(section.label) ?? section.label;
    const repairedText = section.text
      ? repairMojibake(section.text) ?? section.text
      : section.text;
    const repairedHtml = section.html
      ? repairMojibake(section.html) ?? section.html
      : section.html;

    if (source.sourceId === "etimologia" && repairedText) {
      const text = sanitizeEtymologySectionText(repairedText);

      return {
        ...section,
        label: repairedLabel,
        html: sanitizeLookupHtml(htmlFromDisplayMarkdown(text)),
        text,
      };
    }

    if (source.sourceId === "gramatica" && repairedText) {
      const text = cleanDisplayMarkdown(repairedText).replace(/\*/gu, "");

      return {
        ...section,
        label: repairedLabel,
        html: sanitizeLookupHtml(htmlFromDisplayMarkdown(text)),
        text,
      };
    }

    if (source.sourceId === "tabelas" && repairedText) {
      const text = cleanDisplayMarkdown(repairedText).replace(
        /\*\*([^\n]+?)\*\*/gu,
        "$1",
      );

      return {
        ...section,
        label: repairedLabel,
        html: sanitizeLookupHtml(repairedHtml ?? htmlFromDisplayMarkdown(text)),
        text,
      };
    }

    return {
      ...section,
      html: sanitizeLookupHtml(
        repairedHtml ??
          (repairedText ? htmlFromDisplayMarkdown(repairedText) : section.html),
      ),
      label: repairedLabel,
      text: repairedText ?? section.text,
    };
  });
}

export function getDisplaySource(
  source: DictionarySourceResult,
): DictionarySourceResult {
  return {
    ...source,
    label: getDisplaySourceLabel(source),
    note: getDisplaySourceNote(source),
    sections: getDisplaySections(source),
  };
}

export function getDisplayPayload(payload: LookupPayload): LookupPayload {
  return {
    ...payload,
    sources: payload.sources.map(getDisplaySource),
  };
}

export function sourceStatusLabel(status: DictionarySourceResult["status"]) {
  if (status === "found") {
    return "Dispon\u00edvel";
  }

  if (status === "loading") {
    return "Consultando";
  }

  if (status === "not_found") {
    return "Sem verbete";
  }

  return "Indispon\u00edvel";
}

export function getVisibleSections(source: DictionarySourceResult) {
  return source.sections.filter(
    (section) => Boolean(section.html) || Boolean(section.text),
  );
}

export function buildSectionKey(
  sourceId: DictionarySourceId,
  sectionLabel: string,
) {
  return `${sourceId}:${sectionLabel}`;
}

export function getDefaultSourceId(sources: DictionarySourceResult[]) {
  return (
    sources.find((source) => source.status === "found")?.sourceId ??
    sources[0]?.sourceId ??
    null
  );
}

export function getDefaultSectionKey(source: DictionarySourceResult) {
  const firstVisibleSection = getVisibleSections(source)[0];
  return firstVisibleSection
    ? buildSectionKey(source.sourceId, firstVisibleSection.label)
    : null;
}

export function getRelativeSourceId(
  sources: DictionarySourceResult[],
  currentSourceId: DictionarySourceId | null,
  direction: -1 | 1,
) {
  if (sources.length === 0) {
    return null;
  }

  const currentIndex = currentSourceId
    ? sources.findIndex((source) => source.sourceId === currentSourceId)
    : -1;
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (safeIndex + direction + sources.length) % sources.length;
  return sources[nextIndex]?.sourceId ?? null;
}

export function getLookupSourceIds(word: string, context?: LookupContext) {
  return getLookupSourceIdsForWord(word, context);
}

export function buildLoadingPayload(
  word: string,
  context?: LookupContext,
): LookupPayload {
  return {
    displayWord: word,
    requestedWord: word,
    sources: getLookupSourceIds(word, context).map((sourceId) =>
      createLoadingSource(word, sourceId, context),
    ),
  };
}

export function buildEmptySourceMessage(sourceId: DictionarySourceId) {
  return `Digite uma palavra para consultar ${getLookupSourceLabel(sourceId)}.`;
}
