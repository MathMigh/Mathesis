import { load } from "cheerio";
import {
  escapeHtml,
  normalizeLineText,
  normalizeInlineText,
  repairMojibake,
} from "./dictionary-utils";
import { lookupClassicalCorpus } from "./classical-corpus";
import { detectLookupLanguage } from "./lookup-language";
import { lookupEnglishCorpus } from "./english-corpus";
import type {
  DictionarySourceResult,
  LookupContext,
  LookupSection,
} from "./lookup-types";
import { lookupLocalPortugueseCorpus } from "./local-portuguese-corpus";

const WIKISOURCE_API_ENDPOINT = "https://pt.wikisource.org/w/api.php";
const WIKISOURCE_PAGE_ENDPOINT = "https://pt.wikisource.org/wiki/";
const WIKISOURCE_SEARCH_ENDPOINT =
  "https://pt.wikisource.org/w/index.php?title=Especial:Pesquisar&ns0=1&search=";
const USER_AGENT =
  "AuleteKindleReader/0.1 private-study corpus lookup";
const SEARCH_LIMIT = 24;
const RESULT_LIMIT = 3;
const MAX_PAGE_TEXT_FETCHES = 3;
const MAX_HITS_PER_AUTHOR = 3;
const MAX_HITS_PER_WORK = 2;
const PAGE_TEXT_CACHE_TTL_MS = 1000 * 60 * 60 * 6;

type CorpusTradition = "lusofono";

type CanonAuthor = {
  family: CorpusTradition;
  label: string;
  patterns: string[];
  weight: number;
};

type CanonWork = {
  author: string;
  family: CorpusTradition;
  titlePrefix: string;
  weight: number;
};

type WikisourceSearchItem = {
  pageid: number;
  size: number;
  snippet: string;
  timestamp: string;
  title: string;
  wordcount: number;
};

type WikisourceSearchResponse = {
  query?: {
    search?: WikisourceSearchItem[];
  };
};

type WikisourceParseResponse = {
  parse?: {
    text?: string;
    title?: string;
  };
};

type RankedCorpusHit = {
  authorLabel: string | null;
  family: CorpusTradition | null;
  index: number;
  isDirectAuthorHit: boolean;
  isPreferredAuthor: boolean;
  isTranslatorOnly: boolean;
  pageId: number;
  pageUrl: string;
  score: number;
  snippetHtml: string;
  snippetText: string;
  title: string;
  workKey: string;
};

type DerivedLookupAuthor = {
  authorAliases: string[];
  authorLabel: string | null;
};

type PageTextCacheEntry = {
  expiresAt: number;
  value: string | null;
};

declare global {
  var __wikisourcePageTextCache: Map<number, PageTextCacheEntry> | undefined;
}

const CANON_AUTHORS: CanonAuthor[] = [
  {
    family: "lusofono",
    label: "Luis de Camoes",
    patterns: [
      "luis de camoes",
      "luis vaz de camoes",
      "camoes",
    ],
    weight: 95,
  },
  {
    family: "lusofono",
    label: "Padre Antonio Vieira",
    patterns: ["padre antonio vieira", "antonio vieira"],
    weight: 92,
  },
  {
    family: "lusofono",
    label: "Machado de Assis",
    patterns: ["machado de assis", "joaquim maria machado de assis"],
    weight: 100,
  },
  {
    family: "lusofono",
    label: "Fernando Pessoa",
    patterns: [
      "fernando pessoa",
      "ricardo reis",
      "alvaro de campos",
      "alberto caeiro",
    ],
    weight: 88,
  },
  {
    family: "lusofono",
    label: "Eca de Queiros",
    patterns: ["eca de queiros", "jose maria eca de queiros"],
    weight: 88,
  },
  {
    family: "lusofono",
    label: "Almeida Garrett",
    patterns: ["almeida garrett"],
    weight: 84,
  },
  {
    family: "lusofono",
    label: "Bocage",
    patterns: ["bocage", "manuel maria barbosa du bocage"],
    weight: 82,
  },
  {
    family: "lusofono",
    label: "Gregorio de Matos",
    patterns: ["gregorio de matos"],
    weight: 82,
  },
  {
    family: "lusofono",
    label: "Camilo Castelo Branco",
    patterns: ["camilo castelo branco"],
    weight: 82,
  },
  {
    family: "lusofono",
    label: "Jose de Alencar",
    patterns: ["jose de alencar"],
    weight: 82,
  },
  {
    family: "lusofono",
    label: "Lima Barreto",
    patterns: ["lima barreto", "afonso henriques de lima barreto"],
    weight: 86,
  },
  {
    family: "lusofono",
    label: "Manuel Botelho de Oliveira",
    patterns: ["manuel botelho de oliveira"],
    weight: 78,
  },
  {
    family: "lusofono",
    label: "Maria Firmina dos Reis",
    patterns: ["maria firmina dos reis"],
    weight: 80,
  },
  {
    family: "lusofono",
    label: "Cruz e Sousa",
    patterns: ["cruz e sousa", "joao da cruz e sousa"],
    weight: 80,
  },
  {
    family: "lusofono",
    label: "Olavo Bilac",
    patterns: ["olavo bilac"],
    weight: 80,
  },
  {
    family: "lusofono",
    label: "Aluisio Azevedo",
    patterns: ["aluisio azevedo", "aluizio azevedo"],
    weight: 80,
  },
  {
    family: "lusofono",
    label: "Raul Pompeia",
    patterns: ["raul pompeia"],
    weight: 78,
  },
];

const CANON_WORKS: CanonWork[] = [
  { author: "Luis de Camoes", family: "lusofono", titlePrefix: "os lusiadas", weight: 120 },
  { author: "Luis de Camoes", family: "lusofono", titlePrefix: "sonetos", weight: 92 },
  { author: "Machado de Assis", family: "lusofono", titlePrefix: "dom casmurro", weight: 118 },
  {
    author: "Machado de Assis",
    family: "lusofono",
    titlePrefix: "memorias postumas de bras cubas",
    weight: 120,
  },
  { author: "Machado de Assis", family: "lusofono", titlePrefix: "quincas borba", weight: 112 },
  { author: "Machado de Assis", family: "lusofono", titlePrefix: "ocidentais", weight: 102 },
  { author: "Machado de Assis", family: "lusofono", titlePrefix: "occidentaes", weight: 102 },
  { author: "Eca de Queiros", family: "lusofono", titlePrefix: "os maias", weight: 114 },
  { author: "Fernando Pessoa", family: "lusofono", titlePrefix: "mensagem", weight: 108 },
  {
    author: "Almeida Garrett",
    family: "lusofono",
    titlePrefix: "viagens na minha terra",
    weight: 108,
  },
  {
    author: "Jose de Alencar",
    family: "lusofono",
    titlePrefix: "iracema",
    weight: 106,
  },
  {
    author: "Lima Barreto",
    family: "lusofono",
    titlePrefix: "vida e morte de m. j. gonzaga de sa",
    weight: 102,
  },
  {
    author: "Lima Barreto",
    family: "lusofono",
    titlePrefix: "os bruzundangas",
    weight: 102,
  },
  { author: "Maria Firmina dos Reis", family: "lusofono", titlePrefix: "ursula", weight: 98 },
  { author: "Cruz e Sousa", family: "lusofono", titlePrefix: "broqueis", weight: 98 },
  { author: "Olavo Bilac", family: "lusofono", titlePrefix: "poesias infantis", weight: 92 },
  { author: "Aluisio Azevedo", family: "lusofono", titlePrefix: "o cortico", weight: 104 },
  { author: "Raul Pompeia", family: "lusofono", titlePrefix: "o ateneu", weight: 104 },
];

const EXCLUDED_TITLE_PATTERNS = [
  "anexo:",
  "autor:",
  "categoria:",
  "dicionario",
  "galeria:",
  "glossario",
  "homero",
  "indice",
  "iliada",
  "odisseia",
  "pagina:",
  "portal:",
  "wikisource:",
];

const ARCHAIC_ORTHOGRAPHY_PATTERNS = [
  /\bph/iu,
  /\bth/iu,
  /\by/iu,
  /cc[ei]/iu,
  /ct[ei]/iu,
  /eia\b/iu,
  /elle\b/iu,
  /ella\b/iu,
  /elles\b/iu,
  /ellas\b/iu,
  /hontem\b/iu,
  /idéa\b/iu,
  /off/iu,
  /sciencia\b/iu,
  /vêr\b/iu,
];

const PORTUGUESE_DIACRITIC_PATTERN =
  /[\u00c0-\u00c3\u00c7\u00c9-\u00ca\u00cd\u00d3-\u00d5\u00da\u00e0-\u00e3\u00e7\u00e9-\u00ea\u00ed\u00f3-\u00f5\u00fa]/gu;

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR");
}

function cleanText(value: string | null | undefined) {
  return repairMojibake(normalizeInlineText(value ?? "")) ?? "";
}

function uniqueValues(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildPageUrl(title: string) {
  return `${WIKISOURCE_PAGE_ENDPOINT}${encodeURIComponent(title.replace(/ /g, "_"))}`;
}

function getWikisourcePageTextCache() {
  if (!globalThis.__wikisourcePageTextCache) {
    globalThis.__wikisourcePageTextCache = new Map<number, PageTextCacheEntry>();
  }

  return globalThis.__wikisourcePageTextCache;
}

function wikicodeHtmlToText(html: string) {
  if (!html) {
    return null;
  }

  const $ = load(html);
  const content = $(".mw-parser-output").first();

  if (!content.length) {
    return null;
  }

  content
    .find(
      [
        ".headertemplate",
        ".metadata",
        ".mw-editsection",
        ".noprint",
        ".printfooter",
        ".reference",
        ".searchaux",
        ".ws-noexport",
        "figure",
        "noscript",
        "script",
        "style",
        "sup",
        "table",
      ].join(", "),
    )
    .remove();
  content.find("br").replaceWith("\n");
  content
    .find("p, div, li, h1, h2, h3, h4, h5, h6, section, article")
    .each((_, element) => {
      $(element).append("\n");
    });

  const text = normalizeLineText(repairMojibake(content.text()) ?? content.text());
  const cleanedLines = text
    .split("\n")
    .map((line) => cleanText(line))
    .filter(Boolean)
    .filter((line) => !/^\[\s*editar\s*\]$/iu.test(line))
    .filter((line) => !/^categorias?:/iu.test(line));
  const cleanedText = cleanedLines.join("\n").trim();

  return cleanedText.length > 0 ? cleanedText : null;
}

async function fetchWikisourcePageText(pageId: number) {
  const cache = getWikisourcePageTextCache();
  const cached = cache.get(pageId);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const url = new URL(WIKISOURCE_API_ENDPOINT);
  url.searchParams.set("action", "parse");
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  url.searchParams.set("origin", "*");
  url.searchParams.set("pageid", String(pageId));
  url.searchParams.set("prop", "text");

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
        "user-agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      cache.set(pageId, {
        expiresAt: Date.now() + PAGE_TEXT_CACHE_TTL_MS,
        value: null,
      });
      return null;
    }

    const payload = (await response.json()) as WikisourceParseResponse;
    const text = wikicodeHtmlToText(payload.parse?.text ?? "");

    cache.set(pageId, {
      expiresAt: Date.now() + PAGE_TEXT_CACHE_TTL_MS,
      value: text,
    });

    return text;
  } catch {
    return null;
  }
}

function sanitizeSnippetText(rawSnippet: string) {
  const $ = load(`<div>${rawSnippet}</div>`);
  const text = cleanText($("div").text())
    .replace(/\b\d{4,8}\b/g, " ")
    .replace(/Uma versao para impressao de .*? esta disponivel\.?/gi, " ")
    .replace(/Uma versao para impressão de .*? esta disponivel\.?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return text || "Ocorrencia localizada no corpus classico.";
}

function compactSnippetText(text: string, title: string, authorAliases: string[]) {
  const aliases = uniqueValues(authorAliases);
  const cleanupPatterns = [
    new RegExp(`^${escapeRegExp(title)}\\s*`, "iu"),
    ...aliases.flatMap((alias) => [
      new RegExp(`^${escapeRegExp(title)}\\s+por\\s+${escapeRegExp(alias)}\\s*`, "iu"),
      new RegExp(`^${escapeRegExp(title)}\\s*${escapeRegExp(alias)}\\s*`, "iu"),
      new RegExp(`^por\\s+${escapeRegExp(alias)}\\s*`, "iu"),
      new RegExp(`^${escapeRegExp(alias)}\\s*`, "iu"),
    ]),
  ];

  let current = text;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let changed = false;

    for (const pattern of cleanupPatterns) {
      const next = current.replace(pattern, "").replace(/^\d+\s*/, "").trim();

      if (next && next !== current) {
        current = next;
        changed = true;
      }
    }

    if (!changed) {
      break;
    }
  }

  return current.length >= 48 ? current : text;
}

function highlightWord(text: string, requestedWord: string) {
  const expression = new RegExp(`(${escapeRegExp(requestedWord)})`, "giu");
  const escapedText = escapeHtml(text);
  return escapedText.replace(expression, "<mark>$1</mark>");
}

function containsRequestedWord(value: string, requestedWord: string) {
  const normalizedValue = normalizeSearchText(value);
  const normalizedWord = normalizeSearchText(requestedWord);
  const expression = new RegExp(
    `(^|[^\\p{L}\\p{M}])${escapeRegExp(normalizedWord)}([^\\p{L}\\p{M}]|$)`,
    "u",
  );

  return expression.test(normalizedValue);
}

function findRequestedWordOccurrence(value: string, requestedWord: string) {
  const normalizedWord = normalizeSearchText(requestedWord);
  const expression = /[\p{L}\p{M}'-]+/gu;

  for (const match of value.matchAll(expression)) {
    if (normalizeSearchText(match[0]) !== normalizedWord) {
      continue;
    }

    const start = match.index ?? 0;
    return {
      end: start + match[0].length,
      start,
    };
  }

  return null;
}

function cropTextAroundWord(value: string, requestedWord: string, maxLength = 420) {
  const compact = normalizeInlineText(value);
  const occurrence = findRequestedWordOccurrence(compact, requestedWord);

  if (!occurrence) {
    return null;
  }

  if (compact.length <= maxLength) {
    return compact;
  }

  const radius = Math.floor(maxLength / 2);
  let start = Math.max(0, occurrence.start - radius);
  let end = Math.min(compact.length, occurrence.end + radius);

  if (start > 0) {
    const nextSpace = compact.indexOf(" ", start);
    start = nextSpace > -1 && nextSpace < occurrence.start ? nextSpace + 1 : start;
  }

  if (end < compact.length) {
    const previousSpace = compact.lastIndexOf(" ", end);
    end = previousSpace > occurrence.end ? previousSpace : end;
  }

  const prefix = start > 0 ? "... " : "";
  const suffix = end < compact.length ? " ..." : "";

  return `${prefix}${compact.slice(start, end).trim()}${suffix}`;
}

function buildPageTextExcerpt(pageText: string, requestedWord: string) {
  const lines = pageText
    .split("\n")
    .map((line) => normalizeInlineText(line))
    .filter(Boolean);
  const matchIndex = lines.findIndex((line) => containsRequestedWord(line, requestedWord));

  if (matchIndex === -1) {
    return cropTextAroundWord(pageText, requestedWord);
  }

  const windowLines = [
    lines[matchIndex - 1],
    lines[matchIndex],
    lines[matchIndex + 1],
  ].filter(Boolean);
  const candidate = windowLines.join(" ");

  return cropTextAroundWord(candidate, requestedWord) ?? normalizeInlineText(candidate);
}

function isMetadataHeavySnippet(hit: RankedCorpusHit, requestedWord: string) {
  const normalizedSnippet = normalizeSearchText(hit.snippetText);
  const normalizedTitle = normalizeSearchText(hit.title);
  const normalizedAuthor = normalizeSearchText(hit.authorLabel ?? "");
  const titleCount = normalizedTitle
    ? normalizedSnippet.split(normalizedTitle).length - 1
    : 0;
  const authorCount = normalizedAuthor
    ? normalizedSnippet.split(normalizedAuthor).length - 1
    : 0;
  const requestedWordCount = normalizeSearchText(hit.snippetText)
    .split(normalizeSearchText(requestedWord))
    .length - 1;

  return (
    titleCount >= 2 ||
    (titleCount >= 1 && authorCount >= 1 && requestedWordCount >= 2) ||
    /\bpor\s+[a-z]+\s+[a-z]+/iu.test(normalizedSnippet.slice(0, 120))
  );
}

function countArchaicOrthographyHints(value: string) {
  return ARCHAIC_ORTHOGRAPHY_PATTERNS.reduce(
    (total, pattern) => total + (pattern.test(value) ? 1 : 0),
    0,
  );
}

function countPortugueseDiacritics(value: string) {
  return [...value.matchAll(PORTUGUESE_DIACRITIC_PATTERN)].length;
}

function normalizeAuthorLabel(value: string) {
  const trimmed = cleanText(value);

  if (!trimmed.includes(",")) {
    return trimmed;
  }

  const parts = trimmed
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length !== 2) {
    return trimmed;
  }

  return `${parts[1]} ${parts[0]}`.trim();
}

function inferWorkProfile(value: string) {
  const normalizedValue = normalizeSearchText(value);

  return (
    CANON_WORKS.find((work) => normalizedValue.includes(normalizeSearchText(work.titlePrefix))) ??
    null
  );
}

function inferAuthorProfile(value: string) {
  const normalizedValue = normalizeSearchText(value);
  let bestMatch: CanonAuthor | null = null;

  for (const author of CANON_AUTHORS) {
    if (!author.patterns.some((pattern) => normalizedValue.includes(normalizeSearchText(pattern)))) {
      continue;
    }

    if (!bestMatch || author.weight > bestMatch.weight) {
      bestMatch = author;
    }
  }

  return bestMatch;
}

function containsAlias(haystack: string, aliases: string[]) {
  const normalizedHaystack = normalizeSearchText(haystack);
  return aliases.some((alias) => normalizedHaystack.includes(normalizeSearchText(alias)));
}

function isTranslatorOnlyHit(title: string, snippetText: string, authorAliases: string[]) {
  const haystack = normalizeSearchText(`${title} ${snippetText}`);
  return authorAliases.some((alias) => {
    const normalizedAlias = normalizeSearchText(alias);
    return (
      haystack.includes(`traduzido por ${normalizedAlias}`) ||
      haystack.includes(`traducao de ${normalizedAlias}`) ||
      haystack.includes(`traducao brasileira de`) ||
      haystack.includes(`vertido por ${normalizedAlias}`)
    );
  });
}

function isDirectAuthorHit(title: string, snippetText: string, authorAliases: string[]) {
  const normalizedTitle = normalizeSearchText(title);
  const haystack = normalizeSearchText(`${title} ${snippetText}`);
  const snippetStart = normalizeSearchText(snippetText).slice(0, 110);

  return authorAliases.some((alias) => {
    const normalizedAlias = normalizeSearchText(alias);
    return (
      haystack.includes(`${normalizedTitle} por ${normalizedAlias}`) ||
      haystack.includes(`${normalizedTitle}${normalizedAlias}`) ||
      haystack.includes(`por ${normalizedAlias}`) ||
      haystack.includes(`feito por ${normalizedAlias}`) ||
      snippetStart.includes(normalizedAlias)
    );
  });
}

function deriveLookupAuthor(context?: LookupContext): DerivedLookupAuthor {
  const explicitAuthor = context?.documentAuthor
    ? normalizeAuthorLabel(context.documentAuthor)
    : "";
  const contextPool = [
    explicitAuthor,
    cleanText(context?.documentTitle),
    cleanText(context?.documentLabel),
  ].filter(Boolean);
  const explicitAuthorProfile = explicitAuthor
    ? inferAuthorProfile(explicitAuthor)
    : null;
  const workProfile = contextPool.map(inferWorkProfile).find(Boolean) ?? null;
  const authorProfile = contextPool.map(inferAuthorProfile).find(Boolean) ?? null;
  const authorLabel =
    explicitAuthorProfile?.label ||
    workProfile?.author ||
    authorProfile?.label ||
    null;

  return {
    authorAliases: uniqueValues([
      authorLabel ?? "",
      ...(explicitAuthorProfile?.patterns ?? []),
      ...(authorProfile?.patterns ?? []),
    ]),
    authorLabel,
  };
}

function isExcludedTitle(title: string) {
  const normalizedTitle = normalizeSearchText(title);
  return EXCLUDED_TITLE_PATTERNS.some((pattern) =>
    normalizedTitle.includes(normalizeSearchText(pattern)),
  );
}

function scoreSearchItem(
  item: WikisourceSearchItem,
  requestedWord: string,
  index: number,
  preferredAuthorAliases: string[],
): RankedCorpusHit {
  const rawSnippetText = sanitizeSnippetText(item.snippet);
  const workProfile = inferWorkProfile(item.title);
  const authorProfile = inferAuthorProfile(rawSnippetText);
  const authorLabel = workProfile?.author ?? authorProfile?.label ?? null;
  const family = workProfile?.family ?? authorProfile?.family ?? null;
  const isPreferredAuthor =
    preferredAuthorAliases.length > 0 &&
    containsAlias(`${item.title} ${rawSnippetText}`, preferredAuthorAliases);
  const authorAliases = [
    authorLabel ?? "",
    ...(authorProfile?.patterns ?? []),
    ...preferredAuthorAliases,
  ];
  const translatorOnly = isTranslatorOnlyHit(item.title, rawSnippetText, authorAliases);
  const isDirectAuthorAttribution =
    preferredAuthorAliases.length > 0 &&
    isDirectAuthorHit(item.title, rawSnippetText, preferredAuthorAliases) &&
    !translatorOnly;
  const snippetText = compactSnippetText(rawSnippetText, cleanText(item.title), authorAliases);
  const archaicPenalty = countArchaicOrthographyHints(`${item.title} ${snippetText}`) * 24;
  const modernSpellingBonus = Math.min(96, countPortugueseDiacritics(snippetText) * 16);
  const score =
    Math.max(0, SEARCH_LIMIT - index) +
    (workProfile?.weight ?? 0) +
    (authorProfile?.weight ?? 0) +
    (isPreferredAuthor ? 320 : 0) -
    archaicPenalty +
    modernSpellingBonus;

  return {
    authorLabel,
    family,
    index,
    isDirectAuthorHit: isDirectAuthorAttribution,
    isPreferredAuthor,
    isTranslatorOnly: translatorOnly,
    pageId: item.pageid,
    pageUrl: buildPageUrl(item.title),
    score,
    snippetHtml: highlightWord(snippetText, requestedWord),
    snippetText,
    title: cleanText(item.title),
    workKey: normalizeSearchText(item.title),
  };
}

async function enrichHitWithPageText(requestedWord: string, hit: RankedCorpusHit) {
  const pageText = await fetchWikisourcePageText(hit.pageId);
  const excerpt = pageText ? buildPageTextExcerpt(pageText, requestedWord) : null;

  if (!excerpt || !containsRequestedWord(excerpt, requestedWord)) {
    return isMetadataHeavySnippet(hit, requestedWord) ? null : hit;
  }

  const pageTextScore =
    Math.min(140, countPortugueseDiacritics(excerpt) * 16) -
    countArchaicOrthographyHints(excerpt) * 24;

  return {
    ...hit,
    score: hit.score + 120 + pageTextScore,
    snippetHtml: highlightWord(excerpt, requestedWord),
    snippetText: excerpt,
  } satisfies RankedCorpusHit;
}

async function enrichHitsWithPageText(requestedWord: string, hits: RankedCorpusHit[]) {
  const enrichedHits = await Promise.all(
    hits
      .slice(0, MAX_PAGE_TEXT_FETCHES)
      .map((hit) => enrichHitWithPageText(requestedWord, hit)),
  );

  return enrichedHits
    .filter((hit): hit is RankedCorpusHit => Boolean(hit))
    .sort((left, right) => right.score - left.score || left.index - right.index);
}

function isCanonicalPortugueseAuthorHit(hit: RankedCorpusHit) {
  if (hit.family !== "lusofono" || !hit.authorLabel || hit.isTranslatorOnly) {
    return false;
  }

  const normalizedAuthor = normalizeSearchText(hit.authorLabel);
  return CANON_AUTHORS.some(
    (author) =>
      author.family === "lusofono" &&
      normalizeSearchText(author.label) === normalizedAuthor,
  );
}

function dedupeHits(hits: RankedCorpusHit[]) {
  const seen = new Set<number>();
  const deduped: RankedCorpusHit[] = [];

  for (const hit of hits) {
    if (seen.has(hit.pageId)) {
      continue;
    }

    seen.add(hit.pageId);
    deduped.push(hit);
  }

  return deduped;
}

function limitAndDiversifyHits(hits: RankedCorpusHit[]) {
  const selected: RankedCorpusHit[] = [];
  const authorCounts = new Map<string, number>();
  const workCounts = new Map<string, number>();

  for (const hit of hits) {
    const authorKey = normalizeSearchText(hit.authorLabel ?? "sem autor");
    const nextAuthorCount = authorCounts.get(authorKey) ?? 0;
    const nextWorkCount = workCounts.get(hit.workKey) ?? 0;

    if (nextAuthorCount >= MAX_HITS_PER_AUTHOR || nextWorkCount >= MAX_HITS_PER_WORK) {
      continue;
    }

    selected.push(hit);
    authorCounts.set(authorKey, nextAuthorCount + 1);
    workCounts.set(hit.workKey, nextWorkCount + 1);

    if (selected.length >= RESULT_LIMIT) {
      break;
    }
  }

  return selected;
}

function buildOccurrenceSection(hits: RankedCorpusHit[]): LookupSection {
  const html = hits
    .map(
      (hit) => `
        <article class="lookupEntry corpusHitCard">
          <div class="corpusHitMetaRow">
            <div>
              <p class="lookupEntryMeta">${escapeHtml(hit.authorLabel ?? "Autor nao identificado")}</p>
              <p class="lookupEntryTitle">${escapeHtml(hit.title)}</p>
            </div>
            ${
              hit.family
                ? `<span class="corpusFamilyTag">Canon lusofono</span>`
                : ""
            }
          </div>
          <blockquote class="corpusSnippet">${hit.snippetHtml}</blockquote>
          <p class="lookupOrigin">
            <a href="${escapeHtml(hit.pageUrl)}" rel="noreferrer noopener" target="_blank">
              Abrir ocorrencia no Wikisource
            </a>
          </p>
        </article>
      `,
    )
    .join("");

  const text = hits
    .map(
      (hit) =>
        `${hit.authorLabel ?? "Autor nao identificado"} - ${hit.title}\n${hit.snippetText}\n${hit.pageUrl}`,
    )
    .join("\n\n");

  return {
    html,
    label: "Ocorrencias",
    text,
  };
}

function buildWorksSection(hits: RankedCorpusHit[]): LookupSection {
  const works = uniqueValues(hits.map((hit) => hit.title));
  const html = `
    <article class="analogCategoryCard">
      <h4 class="analogCategoryTitle">Obras acionadas nesta busca</h4>
      <div class="analogPillList">
        ${works
          .map(
            (work) =>
              `<span class="lookupPill lookupPillDigital lookupPillStatic">${escapeHtml(work)}</span>`,
          )
          .join("")}
      </div>
    </article>
  `;

  return {
    html,
    label: "Obras",
    text: works.join(" · "),
  };
}

function buildAuthorSection(hits: RankedCorpusHit[]): LookupSection {
  const authorMap = new Map<string, string[]>();

  for (const hit of hits) {
    const key = hit.authorLabel ?? "Autor nao identificado";
    const current = authorMap.get(key) ?? [];
    current.push(hit.title);
    authorMap.set(key, current);
  }

  const html = [...authorMap.entries()]
    .map(
      ([author, works]) => `
        <article class="analogCategoryCard">
          <h4 class="analogCategoryTitle">${escapeHtml(author)}</h4>
          <div class="analogPillList">
            ${uniqueValues(works)
              .map(
                (work) =>
                  `<span class="lookupPill lookupPillDigital lookupPillStatic">${escapeHtml(work)}</span>`,
              )
              .join("")}
          </div>
        </article>
      `,
    )
    .join("");

  const text = [...authorMap.entries()]
    .map(([author, works]) => `${author}\n${uniqueValues(works).join(" · ")}`)
    .join("\n\n");

  return {
    html,
    label: "Autores",
    text,
  };
}

function buildAcervoSection() {
  const lusofonos = CANON_AUTHORS.filter((author) => author.family === "lusofono").map(
    (author) => author.label,
  );

  const buildPills = (values: string[]) =>
    values
      .map(
        (value) =>
          `<span class="lookupPill lookupPillAnalogico lookupPillStatic">${escapeHtml(value)}</span>`,
      )
      .join("");

  return {
    html: `
      <article class="analogCategoryCard">
        <h4 class="analogCategoryTitle">Autores lusofonos priorizados</h4>
        <div class="analogPillList">${buildPills(lusofonos)}</div>
      </article>
    `,
    label: "Acervo",
    text: `Autores lusofonos priorizados:\n${lusofonos.join(" · ")}`,
  } satisfies LookupSection;
}

function buildResult(
  requestedWord: string,
  status: DictionarySourceResult["status"],
  note: string | null,
  sections: LookupSection[],
  sourceQuery: string,
) {
  return {
    canonicalWord: requestedWord,
    label: "Corpus",
    note,
    sections,
    sourceId: "corpus",
    sourceUrl: `${WIKISOURCE_SEARCH_ENDPOINT}${encodeURIComponent(sourceQuery)}`,
    status,
  } satisfies DictionarySourceResult;
}

async function fetchCorpusMatches(searchExpression: string) {
  const url = new URL(WIKISOURCE_API_ENDPOINT);
  url.searchParams.set("action", "query");
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  url.searchParams.set("list", "search");
  url.searchParams.set("origin", "*");
  url.searchParams.set("srnamespace", "0");
  url.searchParams.set("srlimit", String(SEARCH_LIMIT));
  url.searchParams.set("srprop", "snippet|size|wordcount|timestamp");
  url.searchParams.set("srsort", "relevance");
  url.searchParams.set("srwhat", "text");
  url.searchParams.set("srsearch", searchExpression);
  url.searchParams.set("utf8", "1");

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
      "user-agent": USER_AGENT,
    },
    signal: AbortSignal.timeout(12000),
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as WikisourceSearchResponse;
}

function collectHits(
  requestedWord: string,
  items: WikisourceSearchItem[],
  preferredAuthorAliases: string[],
) {
  return items
    .filter((item) => !isExcludedTitle(item.title))
    .filter((item) =>
      containsRequestedWord(`${sanitizeSnippetText(item.snippet)} ${item.title}`, requestedWord),
    )
    .map((item, index) =>
      scoreSearchItem(item, requestedWord, index, preferredAuthorAliases),
    )
    .filter(isCanonicalPortugueseAuthorHit)
    .sort((left, right) => right.score - left.score || left.index - right.index);
}

export async function lookupClassicCorpus(
  word: string,
  context?: LookupContext,
): Promise<DictionarySourceResult> {
  const requestedWord = normalizeInlineText(word.normalize("NFC"));
  const language = detectLookupLanguage(requestedWord, context);

  if (language === "english") {
    return lookupEnglishCorpus(requestedWord, context);
  }

  if (language !== "portuguese") {
    return lookupClassicalCorpus(requestedWord, context);
  }

  const localCorpusResult = await lookupLocalPortugueseCorpus(requestedWord, context);

  if (localCorpusResult?.status === "found") {
    return localCorpusResult;
  }

  const lookupAuthor = deriveLookupAuthor(context);
  const targetedQuery = lookupAuthor.authorLabel
    ? `${requestedWord} "${lookupAuthor.authorLabel}"`
    : null;
  const targetedPayload = targetedQuery ? await fetchCorpusMatches(targetedQuery) : null;
  const targetedHits = targetedPayload
    ? collectHits(
        requestedWord,
        targetedPayload.query?.search ?? [],
        lookupAuthor.authorAliases,
      ).filter((hit) => hit.isPreferredAuthor)
    : [];

  const authorFirstCandidates = limitAndDiversifyHits(
    dedupeHits(
      targetedHits.filter((hit) => hit.isDirectAuthorHit),
    ),
  );
  const authorFirstHits = await enrichHitsWithPageText(requestedWord, authorFirstCandidates);

  if (lookupAuthor.authorLabel && authorFirstHits.length > 0) {
    return buildResult(
      requestedWord,
      "found",
      `Ocorrencias priorizadas do autor lido: ${lookupAuthor.authorLabel}.`,
      [
        buildOccurrenceSection(authorFirstHits),
        buildWorksSection(authorFirstHits),
        buildAcervoSection(),
      ],
      targetedQuery ?? requestedWord,
    );
  }

  const generalPayload = await fetchCorpusMatches(requestedWord);

  if (!targetedPayload && !generalPayload) {
    return buildResult(
      requestedWord,
      "unavailable",
      "Nao consegui consultar o corpus classico do Wikisource agora.",
      [buildAcervoSection()],
      requestedWord,
    );
  }

  const generalHits = generalPayload
    ? collectHits(
        requestedWord,
        generalPayload.query?.search ?? [],
        lookupAuthor.authorAliases,
      )
    : [];
  const filteredGeneralCandidates = limitAndDiversifyHits(dedupeHits(generalHits));
  const filteredGeneralHits = await enrichHitsWithPageText(
    requestedWord,
    filteredGeneralCandidates,
  );

  if (filteredGeneralHits.length === 0) {
    return buildResult(
      requestedWord,
      "not_found",
      lookupAuthor.authorLabel
        ? `Nao encontrei ocorrencias aproveitaveis de ${lookupAuthor.authorLabel} para "${requestedWord}".`
        : `Nao encontrei ocorrencias aproveitaveis para "${requestedWord}" no recorte atual do corpus.`,
      [buildAcervoSection()],
      requestedWord,
    );
  }

  return buildResult(
    requestedWord,
    "found",
    lookupAuthor.authorLabel
      ? `Nao encontrei ocorrencias suficientes do autor lido; abrindo o recorte lusofono canonico.`
      : `Sem autor identificado no arquivo; abrindo o recorte lusofono canonico.`,
    [
      buildOccurrenceSection(filteredGeneralHits),
      buildAuthorSection(filteredGeneralHits),
      buildAcervoSection(),
    ],
    requestedWord,
  );
}
