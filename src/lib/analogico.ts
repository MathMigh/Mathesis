import { load } from "cheerio";
import {
  escapeHtml,
  normalizeInlineText,
  repairMojibake,
} from "./dictionary-utils";
import { lookupAulete } from "./aulete";
import iconv from "iconv-lite";
import { buildPortugueseLookupCandidates } from "./portuguese-word-candidates";
import type { DictionarySourceResult, LookupSection } from "./lookup-types";

const ANALOGICO_ENDPOINT = "https://www.aulete.com.br/analogico/";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0 Safari/537.36";
const LOOKUPABLE_WORD_PATTERN = /^[\p{L}\p{M}]+(?:[-'][\p{L}\p{M}]+)*$/u;
const MAX_CANDIDATES = 8;

type AnalogicoTerm = {
  kind: "analogico" | "digital";
  label: string;
  lookupWord: string | null;
};

type AnalogicoCategory = {
  label: string;
  terms: AnalogicoTerm[];
};

type AnalogicoConcept = {
  categories: AnalogicoCategory[];
  title: string;
};

type ParsedAnalogicoPage =
  | {
      canonicalWord: string;
      concepts: AnalogicoConcept[];
      lookupWord: string;
      status: "found";
    }
  | {
      canonicalWord: string | null;
      concepts: [];
      lookupWord: string;
      status: "not_found";
    };

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR");
}

function uniqueValues(values: string[]) {
  return [...new Set(values)];
}

function cleanText(value: string | null | undefined) {
  return repairMojibake(normalizeInlineText(value ?? "")) ?? "";
}

async function candidateAnalogicoWords(word: string) {
  const requestedWord = normalizeInlineText(word.normalize("NFC"));
  const candidates = uniqueValues(buildPortugueseLookupCandidates(requestedWord));
  const shouldAskAuleteFirst = /(?:a|as|s|ei|ou|ava|avam|ia|iam|ndo|ada|ido)$/iu.test(
    requestedWord,
  );

  if (!shouldAskAuleteFirst) {
    return candidates.slice(0, MAX_CANDIDATES);
  }

  try {
    const auleteResult = await lookupAulete(requestedWord);
    const canonicalWord = normalizeInlineText(auleteResult.canonicalWord ?? "");
    const canonicalKey = normalizeSearchText(canonicalWord);

    if (
      canonicalWord &&
      canonicalKey !== normalizeSearchText(requestedWord) &&
      candidates.some((candidate) => normalizeSearchText(candidate) === canonicalKey)
    ) {
      return uniqueValues([requestedWord, canonicalWord, ...candidates]).slice(
        0,
        MAX_CANDIDATES,
      );
    }
  } catch {
    // A consulta analógica deve continuar mesmo sem o alinhamento com o Aulete.
  }

  return candidates.slice(0, MAX_CANDIDATES);
}

function extractCanonicalWord($: ReturnType<typeof load>) {
  const titleText = cleanText($("title").first().text());
  const titleMatch = titleText.match(/^Palavras an\u00e1logas de\s+(.+)$/i);

  if (titleMatch?.[1]) {
    return normalizeInlineText(titleMatch[1]);
  }

  const graphMatch = $.html()?.match(
    /"id":"center_word","name":"([^"]+)","data":"\{\}","children":/u,
  );

  if (graphMatch?.[1]) {
    return cleanText(graphMatch[1]);
  }

  return cleanText($("#nocab").first().text()) || null;
}

function buildTerm(label: string, kind: AnalogicoTerm["kind"]) {
  const normalizedLabel = cleanText(label);

  if (!normalizedLabel) {
    return null;
  }

  const lookupWord = LOOKUPABLE_WORD_PATTERN.test(normalizedLabel)
    ? normalizedLabel
    : null;

  return {
    kind,
    label: normalizedLabel,
    lookupWord,
  } satisfies AnalogicoTerm;
}

function dedupeTerms(terms: AnalogicoTerm[]) {
  const seen = new Set<string>();
  const deduped: AnalogicoTerm[] = [];

  for (const term of terms) {
    const key = `${term.kind}:${normalizeSearchText(term.label)}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(term);
  }

  return deduped;
}

function parseConcepts($: ReturnType<typeof load>) {
  return $(".keyword")
    .map((_, element) => {
      const root = $(element);
      const title = cleanText(root.find("h2.conceito").first().text());

      if (!title) {
        return null;
      }

      const categories: AnalogicoCategory[] = [];
      let currentCategory: AnalogicoCategory | null = null;

      root.children().each((__, node) => {
        const current = $(node);

        if (current.is("h2.conceito")) {
          return;
        }

        if (current.is("h3.categoria")) {
          const categoryLabel = cleanText(current.text());

          if (!categoryLabel) {
            currentCategory = null;
            return;
          }

          currentCategory = {
            label: categoryLabel,
            terms: [],
          };
          categories.push(currentCategory);
          return;
        }

        if (!currentCategory) {
          return;
        }

        const activeCategory = currentCategory;

        current.find(".word a").each((___, anchor) => {
          const href = $(anchor).attr("href");
          const kind = href?.startsWith("/analogico/") ? "analogico" : "digital";
          const term = buildTerm($(anchor).text(), kind);

          if (term) {
            activeCategory.terms.push(term);
          }
        });
      });

      const normalizedCategories = categories
        .map((category) => ({
          ...category,
          terms: dedupeTerms(category.terms),
        }))
        .filter((category) => category.terms.length > 0);

      if (normalizedCategories.length === 0) {
        return null;
      }

      return {
        categories: normalizedCategories,
        title,
      } satisfies AnalogicoConcept;
    })
    .get()
    .filter(Boolean) as AnalogicoConcept[];
}

function parseAnalogicoPage(html: string, lookupWord: string): ParsedAnalogicoPage {
  const $ = load(html);
  const concepts = parseConcepts($);

  if (concepts.length === 0) {
    return {
      canonicalWord: extractCanonicalWord($),
      concepts: [],
      lookupWord,
      status: "not_found",
    };
  }

  return {
    canonicalWord: extractCanonicalWord($) ?? lookupWord,
    concepts,
    lookupWord,
    status: "found",
  };
}

function buildTermHtml(term: AnalogicoTerm) {
  const className =
    term.kind === "analogico"
      ? "lookupPill lookupPillAnalogico"
      : "lookupPill lookupPillDigital";

  if (!term.lookupWord) {
    return `<span class="${className} lookupPillStatic">${escapeHtml(term.label)}</span>`;
  }

  return `<button type="button" class="${className}" data-lookup-word="${escapeHtml(
    term.lookupWord,
  )}">${escapeHtml(term.label)}</button>`;
}

function buildConceptSection(concept: AnalogicoConcept): LookupSection {
  const html = concept.categories
    .map(
      (category) => `
        <article class="analogCategoryCard">
          <h4 class="analogCategoryTitle">${escapeHtml(category.label)}</h4>
          <div class="analogPillList">
            ${category.terms.map(buildTermHtml).join("")}
          </div>
        </article>
      `,
    )
    .join("");

  const text = concept.categories
    .map(
      (category) =>
        `${category.label}\n${category.terms.map((term) => term.label).join(" · ")}`,
    )
    .join("\n\n");

  return {
    html,
    label: concept.title,
    text,
  };
}

function buildResult(
  requestedWord: string,
  status: DictionarySourceResult["status"],
  note: string | null,
  canonicalWord = requestedWord,
  sections: LookupSection[] = [],
  lookupWord = requestedWord,
): DictionarySourceResult {
  return {
    canonicalWord,
    label: "Analogia",
    note,
    sections,
    sourceId: "analogico",
    sourceUrl: `${ANALOGICO_ENDPOINT}${encodeURIComponent(lookupWord)}`,
    status,
  };
}

async function fetchAnalogicoPage(lookupWord: string) {
  const response = await fetch(`${ANALOGICO_ENDPOINT}${encodeURIComponent(lookupWord)}`, {
    cache: "no-store",
    headers: {
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
      "user-agent": USER_AGENT,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    return null;
  }

  return iconv.decode(Buffer.from(await response.arrayBuffer()), "win1252");
}

export async function lookupAnalogico(word: string): Promise<DictionarySourceResult> {
  const requestedWord = normalizeInlineText(word.normalize("NFC"));
  const queuedCandidates = await candidateAnalogicoWords(requestedWord);
  const attempted = new Set<string>();
  let bestFallbackWord = requestedWord;

  while (queuedCandidates.length > 0 && attempted.size < MAX_CANDIDATES) {
    const lookupWord = queuedCandidates.shift();

    if (!lookupWord) {
      continue;
    }

    const normalizedLookupKey = normalizeSearchText(lookupWord);

    if (attempted.has(normalizedLookupKey)) {
      continue;
    }

    attempted.add(normalizedLookupKey);

    if (
      normalizeSearchText(lookupWord) !== normalizeSearchText(requestedWord) &&
      normalizeSearchText(bestFallbackWord) === normalizeSearchText(requestedWord)
    ) {
      bestFallbackWord = lookupWord;
    }

    const html = await fetchAnalogicoPage(lookupWord);

    if (!html) {
      continue;
    }

    const parsed = parseAnalogicoPage(html, lookupWord);

    if (parsed.status === "found") {
      const note =
        normalizeSearchText(parsed.lookupWord) !== normalizeSearchText(requestedWord)
          ? `O Aulete Analogia aproximou "${requestedWord}" pelo conceito "${parsed.canonicalWord}".`
          : `O Aulete Analogia abriu ${parsed.concepts.length} conceito(s) laterais para esta palavra.`;

      return buildResult(
        requestedWord,
        "found",
        note,
        parsed.canonicalWord,
        parsed.concepts.map(buildConceptSection),
        parsed.lookupWord,
      );
    }

    if (
      parsed.canonicalWord &&
      normalizeSearchText(parsed.canonicalWord) !== normalizedLookupKey
    ) {
      queuedCandidates.push(parsed.canonicalWord);
    }
  }

  return buildResult(
    requestedWord,
    "not_found",
    normalizeSearchText(bestFallbackWord) !== normalizeSearchText(requestedWord)
      ? `O Aulete Analogia tambem tentou "${bestFallbackWord}", mas nao encontrou uma entrada conceitual direta.`
      : `O Aulete Analogia nao trouxe uma entrada conceitual direta para "${requestedWord}".`,
    bestFallbackWord,
    [],
    bestFallbackWord,
  );
}
