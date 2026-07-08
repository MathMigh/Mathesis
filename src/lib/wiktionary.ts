import { load } from "cheerio";
import {
  escapeHtml,
  normalizeInlineText,
  repairMojibake,
} from "./dictionary-utils";
import type { DictionarySourceResult, LookupSection } from "./lookup-types";

const WIKTIONARY_ENDPOINT = "https://en.wiktionary.org/w/api.php";
const USER_AGENT = "Mathesis/1.0 Wiktionary";

type WiktionarySection = {
  index?: string;
  level?: string;
  line?: string;
};

type WiktionarySectionsResponse = {
  parse?: {
    sections?: WiktionarySection[];
  };
};

type WiktionaryTextResponse = {
  parse?: {
    text?: string;
    title?: string;
  };
};

type SectionPlan = {
  heading: string;
  index: string;
};

const META_HEADINGS = new Set(["alternative forms", "etymology", "pronunciation"]);
const LEXICAL_HEADINGS = new Set([
  "noun",
  "verb",
  "adjective",
  "adverb",
  "preposition",
  "conjunction",
  "interjection",
  "proper noun",
  "determiner",
  "article",
  "numeral",
  "pronoun",
]);
const STOP_HEADINGS = new Set([
  "anagrams",
  "references",
  "further reading",
  "translations",
  "descendants",
  "derived terms",
  "related terms",
  "hyponyms",
  "hypernyms",
  "quotations",
  "synonyms",
  "antonyms",
  "coordinate terms",
  "see also",
]);

function buildResult(
  requestedWord: string,
  status: DictionarySourceResult["status"],
  note: string,
  sections: LookupSection[] = [],
  canonicalWord = requestedWord,
): DictionarySourceResult {
  return {
    canonicalWord,
    label: "Wiktionary",
    note,
    sections,
    sourceId: "wiktionary",
    sourceUrl: `https://en.wiktionary.org/wiki/${encodeURIComponent(requestedWord)}`,
    status,
  };
}

function cleanWiktionaryText(value: string) {
  return normalizeInlineText(repairMojibake(value) ?? value)
    .replace(/^Lua error.*?header \(Translingual\)\.\s*/iu, "")
    .replace(/\s+([,.;:!?])/gu, "$1")
    .trim();
}

async function fetchWiktionaryJson<T>(params: Record<string, string>) {
  const url = new URL(WIKTIONARY_ENDPOINT);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT },
    next: { revalidate: 60 * 60 * 24 * 30 },
    signal: AbortSignal.timeout(18000),
  });

  if (!response.ok) {
    throw new Error(`Wiktionary respondeu com status ${response.status}.`);
  }

  return (await response.json()) as T;
}

async function fetchEnglishSectionPlan(word: string) {
  const payload = await fetchWiktionaryJson<WiktionarySectionsResponse>({
    action: "parse",
    format: "json",
    origin: "*",
    page: word,
    prop: "sections",
    redirects: "1",
  });

  const sections = payload.parse?.sections ?? [];
  const englishIndex = sections.findIndex(
    (section) =>
      normalizeInlineText(section.line ?? "").toLocaleLowerCase("en-US") === "english" &&
      section.level === "2",
  );

  if (englishIndex < 0) {
    return null;
  }

  const englishSections: WiktionarySection[] = [];
  for (let index = englishIndex + 1; index < sections.length; index += 1) {
    const section = sections[index];
    if (!section) {
      continue;
    }
    if (section.level === "2") {
      break;
    }
    englishSections.push(section);
  }

  const plans: SectionPlan[] = [];
  let lexicalCount = 0;

  for (const section of englishSections) {
    const heading = normalizeInlineText(section.line ?? "");
    const normalizedHeading = heading.toLocaleLowerCase("en-US");

    if (!section.index || !heading) {
      continue;
    }

    if ((section.level === "3" || section.level === "4") && STOP_HEADINGS.has(normalizedHeading)) {
      break;
    }

    if (section.level === "3" && META_HEADINGS.has(normalizedHeading)) {
      if (!plans.some((plan) => plan.heading.toLocaleLowerCase("en-US") === normalizedHeading)) {
        plans.push({ heading, index: section.index });
      }
      continue;
    }

    if ((section.level === "3" || section.level === "4") && LEXICAL_HEADINGS.has(normalizedHeading)) {
      plans.push({ heading, index: section.index });
      lexicalCount += 1;

      if (lexicalCount >= 5) {
        break;
      }
    }
  }

  return plans;
}

async function fetchSectionHtml(word: string, sectionIndex: string) {
  const payload = await fetchWiktionaryJson<WiktionaryTextResponse>({
    action: "parse",
    format: "json",
    formatversion: "2",
    origin: "*",
    page: word,
    prop: "text",
    redirects: "1",
    section: sectionIndex,
  });

  return payload.parse?.text ?? "";
}

function extractListItems($: ReturnType<typeof load>, elementHtml: string, limit: number) {
  const element = load(elementHtml).root();

  return element
    .find("li")
    .toArray()
    .map((li) => {
      const item = load("<div></div>")("div");
      item.append(load(li).root().html() ?? "");
      item.find("ul, ol, dl, blockquote, .citation-whole, .h-usage-example, .h-quotation").remove();
      return cleanWiktionaryText(item.text());
    })
    .filter((text) => Boolean(text) && !/^Lua error/iu.test(text))
    .slice(0, limit);
}

function buildSectionFragment(rawHtml: string, heading: string) {
  const $ = load(rawHtml);
  $(".mw-editsection, style, script, sup.reference, table, .interproject-box, .thumb, figure, meta").remove();
  $("a").each((_, element) => {
    $(element).replaceWith($(element).contents());
  });
  $("br").replaceWith("\n");

  const root = $(".mw-parser-output").first();

  if (!root.length) {
    return null;
  }

  const htmlParts: string[] = [`<section class="lookupBlock"><h4 class="markdownHeading">${escapeHtml(heading)}</h4>`];
  const textParts: string[] = [heading];
  let collectedDefinitionCount = 0;

  for (const node of root.children().toArray()) {
    const element = $(node);
    const tagName = node.type === "tag" ? node.tagName.toLowerCase() : "";
    const text = cleanWiktionaryText(element.text());

    if (!text || /^Lua error/iu.test(text)) {
      continue;
    }

    if (tagName === "p") {
      if (text.toLocaleLowerCase("en-US") === heading.toLocaleLowerCase("en-US")) {
        continue;
      }

      htmlParts.push(`<p class="lookupLine">${escapeHtml(text).replace(/\n/gu, "<br/>")}</p>`);
      textParts.push(text);
      continue;
    }

    if (tagName === "ol") {
      const items = extractListItems($, $.html(element), 8);

      for (const item of items) {
        htmlParts.push(`<p class="lookupLine">${escapeHtml(item)}</p>`);
        textParts.push(item);
        collectedDefinitionCount += 1;
      }

      continue;
    }

    if (tagName === "ul" && heading.toLocaleLowerCase("en-US") === "pronunciation") {
      const items = extractListItems($, $.html(element), 4);

      for (const item of items) {
        htmlParts.push(`<p class="lookupLine">${escapeHtml(item)}</p>`);
        textParts.push(item);
      }
    }

    if (collectedDefinitionCount >= 8) {
      break;
    }
  }

  htmlParts.push("</section>");

  if (textParts.length <= 1) {
    return null;
  }

  return {
    html: htmlParts.join(""),
    text: textParts.join("\n\n"),
  };
}

export async function lookupWiktionary(word: string): Promise<DictionarySourceResult> {
  const requestedWord = normalizeInlineText(word.normalize("NFC")).toLocaleLowerCase("en-US");

  if (!requestedWord) {
    return buildResult(
      requestedWord,
      "not_found",
      "Digite uma palavra inglesa para consultar o Wiktionary.",
    );
  }

  try {
    const plan = await fetchEnglishSectionPlan(requestedWord);

    if (!plan || plan.length === 0) {
      return buildResult(
        requestedWord,
        "not_found",
        `Não encontrei um verbete direto para "${requestedWord}" no Wiktionary.`,
      );
    }

    const fragments = await Promise.all(
      plan.map(async (sectionPlan) => {
        const html = await fetchSectionHtml(requestedWord, sectionPlan.index);
        return buildSectionFragment(html, sectionPlan.heading);
      }),
    );

    const validFragments = fragments.filter((fragment): fragment is NonNullable<typeof fragment> =>
      Boolean(fragment),
    );

    if (validFragments.length === 0) {
      return buildResult(
        requestedWord,
        "unavailable",
        "Encontrei a pagina no Wiktionary, mas nao consegui extrair o verbete desta vez.",
      );
    }

    return buildResult(
      requestedWord,
      "found",
      "Verbete lexical em inglês extraído do Wiktionary.",
      [
        {
          html: `<article class="lookupEntry lookupEntry--wiktionary">${validFragments
            .map((fragment) => fragment.html)
            .join("")}</article>`,
          label: "English",
          text: validFragments.map((fragment) => fragment.text).join("\n\n"),
        },
      ],
      requestedWord,
    );
  } catch {
    return buildResult(
      requestedWord,
      "unavailable",
      "Não consegui consultar o Wiktionary agora.",
    );
  }
}
