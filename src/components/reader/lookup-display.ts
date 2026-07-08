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

function sanitizeEtymologySectionText(value: string) {
  return cleanDisplayMarkdown(value)
    .replace(/^\s*\*\*(?:Origem imediata|Origem)\*\*\s*:?\s*/gimu, "")
    .replace(/^\s*(?:Origem imediata|Origem)\s*:?\s*/gimu, "")
    .replace(/^\s*\*\*Grau de certeza:\*\*.*$/gimu, "")
    .replace(/^\s*Grau de certeza\s*:.*$/gimu, "")
    .replace(/\n{3,}/gu, "\n\n")
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
  const repairedNote = source.note ? repairMojibake(source.note) ?? source.note : source.note;

  if (source.status === "found") {
    if (source.sourceId === "etimologia") {
      return repairedNote ?? "Nota etimológica para apoiar a leitura.";
    }

    if (source.sourceId === "gramatica") {
      return "Verbete gramatical organizado a partir da Nova gramática do português contemporâneo, de Celso Cunha e Lindley Cintra.";
    }

    if (source.sourceId === "wikipedia") {
      return "Panorama enciclopédico da Wikipedia para apoiar a leitura.";
    }

    if (
      source.sourceId === "mitologico" &&
      (!source.note || /^nota mitol[oó]gica gerada por ia/i.test(source.note))
    ) {
      return "Nota mitológica gerada por IA para apoiar a leitura.";
    }
  }

  return repairedNote;
}

function getDisplaySections(source: DictionarySourceResult) {
  return source.sections.map((section) => {
    const repairedLabel = repairMojibake(section.label) ?? section.label;
    const repairedText = section.text ? repairMojibake(section.text) ?? section.text : section.text;
    const repairedHtml = section.html ? repairMojibake(section.html) ?? section.html : section.html;

    if (source.sourceId === "etimologia" && repairedText) {
      const text = sanitizeEtymologySectionText(repairedText);

      return {
        ...section,
        label: repairedLabel,
        html: htmlFromDisplayMarkdown(text),
        text,
      };
    }

    if (source.sourceId === "gramatica" && repairedText) {
      const text = cleanDisplayMarkdown(repairedText).replace(/\*/gu, "");

      return {
        ...section,
        label: repairedLabel,
        html: htmlFromDisplayMarkdown(text),
        text,
      };
    }

    if (source.sourceId === "tabelas" && repairedText) {
      const text = cleanDisplayMarkdown(repairedText).replace(/\*\*([^\n]+?)\*\*/gu, "$1");

      return {
        ...section,
        label: repairedLabel,
        html: repairedHtml ?? htmlFromDisplayMarkdown(text),
        text,
      };
    }

    return {
      ...section,
      html: repairedHtml ?? (repairedText ? htmlFromDisplayMarkdown(repairedText) : section.html),
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
    return "Disponível";
  }

  if (status === "loading") {
    return "Consultando";
  }

  if (status === "not_found") {
    return "Sem verbete";
  }

  return "Indisponível";
}

export function getVisibleSections(source: DictionarySourceResult) {
  return source.sections.filter(
    (section) => Boolean(section.html) || Boolean(section.text),
  );
}

export function buildSectionKey(sourceId: DictionarySourceId, sectionLabel: string) {
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

export function buildLoadingPayload(word: string, context?: LookupContext): LookupPayload {
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
