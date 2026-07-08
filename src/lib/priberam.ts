import { execFileSync } from "node:child_process";
import { load, type Cheerio, type CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import {
  decodeHtmlBuffer,
  escapeHtml,
  normalizeInlineText,
  normalizeLineText,
} from "./dictionary-utils";
import type { DictionarySourceResult } from "./lookup-types";

const PRIBERAM_ENDPOINT = "https://dicionario.priberam.org/";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0 Safari/537.36";

function isPriberamBlocked(html: string) {
  return /Just a moment|Enable JavaScript and cookies to continue|__cf_chl|challenge-platform/i.test(
    html,
  );
}

function buildResult(
  requestedWord: string,
  status: DictionarySourceResult["status"],
  note: string | null,
  canonicalWord = requestedWord,
  html: string | null = null,
  text: string | null = null,
): DictionarySourceResult {
  return {
    canonicalWord,
    label: "Priberam",
    note,
    sections:
      html || text
        ? [
            {
              html,
              label: "Verbete",
              text,
            },
          ]
        : [],
    sourceId: "priberam",
    sourceUrl: `${PRIBERAM_ENDPOINT}${encodeURIComponent(requestedWord)}`,
    status,
  };
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR");
}

function stripSenseNumber(value: string) {
  return value.replace(/\s*\d+$/, "").trim();
}

function formatSenseTitle(value: string) {
  return value.replace(/(\D)(\d+)$/, "$1 $2").trim();
}

function unwrapElement($: CheerioAPI, selection: Cheerio<AnyNode>) {
  selection.each((_, element) => {
    $(element).replaceWith($(element).contents());
  });
}

function preferPriberamVariant($: CheerioAPI, root: Cheerio<AnyNode>) {
  const hasBrazilianText = normalizeInlineText(root.find(".varpb").text()).length > 0;
  const variantToKeep = hasBrazilianText ? ".varpb" : ".varpt";
  const variantToDrop = hasBrazilianText ? ".varpt" : ".varpb";

  root.find(variantToDrop).remove();
  unwrapElement($, root.find(variantToKeep));
}

function prepareCard($: CheerioAPI, card: Cheerio<AnyNode>) {
  const clone = card.clone();

  preferPriberamVariant($, clone);
  clone.find("script, style, svg, img, input, button, .sr-only, .word_wrap").remove();
  unwrapElement($, clone.find("a"));

  return clone;
}

function extractCardWord($: CheerioAPI, card: Cheerio<AnyNode>) {
  const clone = prepareCard($, card);
  const headerWord = clone.find(".dp-definicao-header > div").first().text();
  return normalizeInlineText(headerWord.replace(/\s+/g, " "));
}

function buildEntryHtml(
  title: string,
  syllables: string | null,
  grammar: string | null,
  lines: string[],
  origin: string | null,
) {
  const metaParts = [syllables, grammar].filter(Boolean);
  const definitionLines = lines
    .map((line) => `<p class="lookupLine">${escapeHtml(line)}</p>`)
    .join("");

  return `
    <article class="lookupEntry">
      <p class="lookupEntryTitle">${escapeHtml(title)}</p>
      ${
        metaParts.length > 0
          ? `<p class="lookupEntryMeta">${escapeHtml(metaParts.join("  "))}</p>`
          : ""
      }
      <div class="lookupLineList">${definitionLines}</div>
      ${
        origin
          ? `<p class="lookupOrigin"><strong>Origem:</strong> ${escapeHtml(origin)}</p>`
          : ""
      }
    </article>
  `;
}

function buildEntryText(
  title: string,
  syllables: string | null,
  grammar: string | null,
  lines: string[],
  origin: string | null,
) {
  const parts = [title];

  if (syllables) {
    parts.push(syllables);
  }

  if (grammar) {
    parts.push(grammar);
  }

  parts.push(...lines);

  if (origin) {
    parts.push(`Origem: ${origin}`);
  }

  return parts.filter(Boolean).join("\n");
}

function fetchWithCurl(url: string) {
  const binary = process.platform === "win32" ? "curl.exe" : "curl";
  const stdout = execFileSync(
    binary,
    [
      "-L",
      "-s",
      "--max-time",
      "20",
      "-A",
      USER_AGENT,
      "-H",
      "Accept-Language: pt-BR,pt;q=0.9,en;q=0.8",
      "-H",
      "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      url,
    ],
    {
      encoding: "buffer",
      maxBuffer: 5 * 1024 * 1024,
      timeout: 25000,
    },
  );

  return decodeHtmlBuffer(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
}

export async function lookupPriberam(word: string): Promise<DictionarySourceResult> {
  const requestedWord = normalizeInlineText(word.normalize("NFC"));
  const lookupUrl = `${PRIBERAM_ENDPOINT}${encodeURIComponent(requestedWord)}`;
  let html: string | null = null;

  try {
    const response = await fetch(lookupUrl, {
      cache: "no-store",
      headers: {
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
        "user-agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(15000),
    });

    if (response.ok) {
      html = decodeHtmlBuffer(Buffer.from(await response.arrayBuffer()));
    }
  } catch {
    html = null;
  }

  if (!html || isPriberamBlocked(html)) {
    try {
      html = fetchWithCurl(lookupUrl);
    } catch {
      html = html ?? "";
    }
  }

  if (!html) {
    return buildResult(
      requestedWord,
      "unavailable",
      "O Priberam nao respondeu como esperado nesta consulta.",
    );
  }

  if (isPriberamBlocked(html)) {
    return buildResult(
      requestedWord,
      "unavailable",
      "O Priberam bloqueou esta consulta automatizada.",
    );
  }

  const $ = load(html);
  const leftColumnText = normalizeInlineText($(".dp-conteudo__esquerda").first().text());

  if (/palavra nao encontrada/i.test(normalizeSearchText(leftColumnText))) {
    return buildResult(
      requestedWord,
      "not_found",
      "O Priberam devolveu uma pagina sem verbete para esta palavra na configuracao ortografica consultada."
        .replace("pagina", "página")
        .replace("configuracao", "configuração")
        .replace("ortografica", "ortográfica"),
    );
  }

  const cards = $(".dp-conteudo__esquerda .dp-definicao");

  if (!cards.length) {
    return buildResult(
      requestedWord,
      "unavailable",
      "Nao consegui extrair o verbete do Priberam desta vez.",
    );
  }

  const firstWord = stripSenseNumber(extractCardWord($, cards.first()) || requestedWord);
  const matchingCards: string[] = [];
  const matchingTexts: string[] = [];

  cards.each((index, element) => {
    const card = $(element);
    const cardWord = extractCardWord($, card);
    const cardBaseWord = stripSenseNumber(cardWord);

    if (index > 0 && cardBaseWord !== firstWord) {
      return false;
    }

    const prepared = prepareCard($, card);
    const title = cardWord ? formatSenseTitle(cardWord) : firstWord;
    const syllables = normalizeInlineText(prepared.find(".dp-divisao-silabica").first().text());
    const grammar = normalizeLineText(
      prepared.children("p").find("strong").first().text() ||
        prepared.find("p strong").first().text(),
    );
    const lines = prepared
      .find(".dp-definicao-linha")
      .map((_, line) => normalizeLineText($(line).text()))
      .get()
      .filter(Boolean);
    const originText = normalizeLineText(
      prepared
        .find(".dp-seccao-icon")
        .first()
        .text()
        .replace(/^Origem:\s*/i, ""),
    );

    matchingCards.push(
      buildEntryHtml(title, syllables || null, grammar || null, lines, originText || null),
    );
    matchingTexts.push(
      buildEntryText(title, syllables || null, grammar || null, lines, originText || null),
    );
  });

  return buildResult(
    requestedWord,
    "found",
    null,
    firstWord,
    matchingCards.join(""),
    matchingTexts.join("\n\n"),
  );
}
