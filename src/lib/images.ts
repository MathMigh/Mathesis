import { load } from "cheerio";
import { escapeHtml, normalizeInlineText } from "./dictionary-utils";
import { getGeminiApiKeys } from "./gemini-keys";
import { detectLookupLanguage } from "./lookup-language";
import { buildPortugueseLookupCandidates } from "./portuguese-word-candidates";
import type { DictionarySourceResult, LookupContext, LookupSection } from "./lookup-types";

const GOOGLE_CSE_ENDPOINT = "https://www.googleapis.com/customsearch/v1";
const GOOGLE_IMAGES_SEARCH_ENDPOINT = "https://www.google.com/search?tbm=isch&q=";
const GEMINI_IMAGE_ENDPOINT = "https://generativelanguage.googleapis.com";
const GEMINI_INTERACTIONS_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/interactions";
const NANO_BANANA_SOURCE_URL = "https://ai.google.dev/gemini-api/docs/image-generation";
const GEMINI_IMAGE_API_VERSIONS = ["v1", "v1beta"] as const;
const GEMINI_TEXT_API_VERSIONS = ["v1beta", "v1"] as const;
const PEXELS_IMAGE_ENDPOINT = "https://api.pexels.com/v1/search";
const PIXABAY_IMAGE_ENDPOINT = "https://pixabay.com/api/";
const UNSPLASH_IMAGE_ENDPOINT = "https://api.unsplash.com/search/photos";
const OPENVERSE_IMAGE_ENDPOINT = "https://api.openverse.org/v1/images/";
const DUCKDUCKGO_IMAGE_PAGE_ENDPOINT = "https://duckduckgo.com/";
const DUCKDUCKGO_IMAGE_ENDPOINT = "https://duckduckgo.com/i.js";
const WIKIPEDIA_SEARCH_ENDPOINT = "https://pt.wikipedia.org/w/api.php";
const WIKIPEDIA_SUMMARY_ENDPOINT = "https://pt.wikipedia.org/api/rest_v1/page/summary/";
const DEFAULT_NANO_BANANA_MODELS = [
  "gemini-3.1-flash-image",
  "gemini-2.5-flash-image",
] as const;
const DEFAULT_IMAGE_TRANSLATION_MODELS = [
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
] as const;
const GOOGLE_HEADERS = {
  "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
  "user-agent":
    "Mozilla/5.0 (compatible; Mathesis/0.1; +https://mathesis-app.vercel.app)",
};

const PROXYABLE_IMAGE_HOSTS = [
  ".duckduckgo.com",
  ".openverse.engineering",
  ".openverse.org",
  ".pexels.com",
  ".pixabay.com",
  ".unsplash.com",
  ".wikimedia.org",
  ".wikipedia.org",
  "cdn.pixabay.com",
  "duckduckgo.com",
  "external-content.duckduckgo.com",
  "images.openverse.engineering",
  "images.pexels.com",
  "images.unsplash.com",
  "openverse.org",
  "pixabay.com",
  "plus.unsplash.com",
].map((host) => host.toLocaleLowerCase("en-US"));

type GeminiImagePart = {
  inlineData?: {
    data?: string;
    mimeType?: string;
  };
  inline_data?: {
    data?: string;
    mime_type?: string;
  };
  text?: string;
};

type GeminiImageResponse = {
  candidates?: Array<{
    content?: {
      parts?: GeminiImagePart[];
    };
  }>;
  error?: {
    message?: string;
  };
};

type GoogleImageSearchResponse = {
  items?: Array<{
    displayLink?: string;
    image?: {
      contextLink?: string;
      thumbnailLink?: string;
    };
    link?: string;
    title?: string;
  }>;
};

type ImageTranslationPayload = {
  queries?: string[];
};

type PexelsImageResponse = {
  photos?: Array<{
    alt?: string | null;
    photographer?: string | null;
    src?: {
      landscape?: string;
      large?: string;
      medium?: string;
    };
    url?: string;
  }>;
};

type PixabayImageResponse = {
  hits?: Array<{
    largeImageURL?: string;
    pageURL?: string;
    tags?: string;
    user?: string;
    webformatURL?: string;
  }>;
};

type UnsplashImageResponse = {
  results?: Array<{
    alt_description?: string | null;
    description?: string | null;
    links?: {
      html?: string;
    };
    urls?: {
      regular?: string;
      small?: string;
      thumb?: string;
    };
    user?: {
      name?: string;
    };
  }>;
};

type OpenverseImageResponse = {
  results?: Array<{
    creator?: string | null;
    foreign_landing_url?: string | null;
    license?: string | null;
    thumbnail?: string | null;
    title?: string | null;
    url?: string | null;
  }>;
};

type DuckDuckGoImageResponse = {
  results?: Array<{
    image?: string;
    source?: string;
    thumbnail?: string;
    title?: string;
    url?: string;
  }>;
};

type WikipediaSearchResponse = [
  string,
  string[] | undefined,
  string[] | undefined,
  string[] | undefined,
];

type WikipediaSummaryResponse = {
  content_urls?: {
    desktop?: {
      page?: string;
    };
  };
  description?: string;
  extract?: string;
  thumbnail?: {
    source?: string;
  };
  title?: string;
  type?: string;
};

type ImageHit = {
  author: string | null;
  license: string | null;
  pageUrl: string;
  thumbUrl: string;
  title: string;
};

type StockImageProvider = "Pexels" | "Pixabay" | "Unsplash";
type OpenImageProvider = "DuckDuckGo" | "Openverse";

type RankedImageHit = ImageHit & {
  provider: StockImageProvider | OpenImageProvider;
  query: string;
  score: number;
};

type NanoBananaResult = {
  failure: string | null;
  hit: ImageHit | null;
};

const IMAGE_PROVIDER_FETCH_LIMIT = 4;
const IMAGE_PROVIDER_TIMEOUT_MS = 4500;
const IMAGE_QUERY_LIMIT = 2;
const IMAGE_TRANSLATED_QUERY_LIMIT = 2;
const IMAGE_RESULT_LIMIT = 4;
const STOCK_PROVIDER_PRIORITY: Record<StockImageProvider, number> = {
  Pexels: 40,
  Unsplash: 34,
  Pixabay: 28,
};

type ConceptVariant =
  | "above"
  | "action"
  | "anatomy"
  | "between"
  | "book"
  | "house"
  | "island"
  | "kinship"
  | "mountain"
  | "ordinal"
  | "pocket";

type ImageSearchPlan = {
  concepts: Array<{ subtitle: string; variant: ConceptVariant }>;
  conceptOnly?: boolean;
  promptHint?: string;
  queries: string[];
};

const IMAGE_QUERY_TRANSLATION_GLOSSARY: Record<string, string[]> = {
  febo: ["apollo greek god statue", "phoebus apollo sculpture"],
  urutau: ["potoo bird", "common potoo", "nyctibius griseus"],
};

declare global {
  var __imageQueryTranslationCache: Map<string, string[]> | undefined;
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR");
}

function upperFirst(value: string) {
  if (!value) {
    return value;
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function buildPixabayTitle(tags: string | null | undefined, fallback: string) {
  const parts = (tags ?? "")
    .split(",")
    .map((part) => normalizeInlineText(part).replace(/\s+/gu, " ").trim())
    .filter(Boolean);
  const unique: string[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    const key = normalizeSearchText(part);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(part);

    if (unique.length >= 3) {
      break;
    }
  }

  return upperFirst(
    unique.length > 0
      ? unique.join(" · ")
      : normalizeInlineText(fallback).replace(/\s+/gu, " ").trim(),
  );
}

function buildStockImageTitle(rawTitle: string | null | undefined, fallback: string) {
  const fallbackTitle = upperFirst(
    normalizeInlineText(fallback).replace(/\s+/gu, " ").trim(),
  );
  const normalized = normalizeInlineText(rawTitle ?? "")
    .replace(/\s+/gu, " ")
    .trim();

  if (!normalized) {
    return fallbackTitle;
  }

  let title = normalized
    .replace(
      /^(foto profissional gr[aá]tis de|free stock photo of|free photo of|professional photo of)\s+/iu,
      "",
    )
    .replace(/\s*\|\s*.*$/u, "")
    .trim();

  if (title.includes(",")) {
    const segments = title
      .split(",")
      .map((segment) => segment.trim())
      .filter(Boolean);

    if (segments.length > 0) {
      title = segments.slice(0, 3).join(", ");
    }
  }

  title = title.split(/[!?]/u)[0]?.trim() ?? title;

  if (title.length > 80) {
    title = `${title.slice(0, 77).trimEnd()}...`;
  }

  if (title.length < 3) {
    return fallbackTitle;
  }

  return upperFirst(title);
}

function getGoogleImageCredentials() {
  const apiKey =
    process.env.GOOGLE_CSE_API_KEY ||
    process.env.GOOGLE_CUSTOM_SEARCH_API_KEY ||
    null;
  const searchEngineId =
    process.env.GOOGLE_CSE_ID ||
    process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID ||
    null;

  return apiKey && searchEngineId ? { apiKey, searchEngineId } : null;
}

function getPexelsApiKey() {
  return process.env.PEXELS_API_KEY || null;
}

function getPixabayApiKey() {
  return process.env.PIXABAY_API_KEY || null;
}

function getUnsplashAccessKey() {
  return process.env.UNSPLASH_ACCESS_KEY || process.env.UNSPLASH_API_KEY || null;
}

function getGeminiImageApiKey() {
  return (
    process.env.AI_API_KEY ||
    process.env.IMAGE_AI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GOOGLE_AI_API_KEY ||
    null
  );
}

function getNanoBananaModels() {
  const configuredModels = [
    process.env.AI_IMAGE_MODEL,
    process.env.IMAGE_AI_MODEL,
    process.env.GEMINI_IMAGE_MODEL,
    process.env.NANO_BANANA_MODEL,
  ].filter((model): model is string => Boolean(model?.trim()));

  return Array.from(
    new Set([...configuredModels, ...DEFAULT_NANO_BANANA_MODELS]),
  );
}

function getImageTranslationModels() {
  return Array.from(
    new Set(
      [
        process.env.AI_MODEL,
        process.env.GEMINI_MODEL,
        process.env.IMAGE_TRANSLATION_MODEL,
        ...DEFAULT_IMAGE_TRANSLATION_MODELS,
      ].filter((model): model is string => Boolean(model?.trim())),
    ),
  );
}

function getImageQueryTranslationCache() {
  if (!globalThis.__imageQueryTranslationCache) {
    globalThis.__imageQueryTranslationCache = new Map<string, string[]>();
  }

  return globalThis.__imageQueryTranslationCache;
}

function extractJsonObject(value: string) {
  const cleaned = value
    .replace(/^\s*```(?:json)?\s*/iu, "")
    .replace(/\s*```\s*$/u, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start < 0 || end <= start) {
    return null;
  }

  return cleaned.slice(start, end + 1);
}

function uniqueImageQueries(values: string[]) {
  return Array.from(
    new Set(
      values
        .map((value) => normalizeInlineText(value))
        .filter(Boolean),
    ),
  );
}

function buildImageTranslationPrompt(word: string, candidates: string[]) {
  return [
    "Responda somente em JSON valido.",
    `Palavra portuguesa: ${word}`,
    candidates.length ? `Candidatas auxiliares: ${candidates.join(" | ")}` : "Candidatas auxiliares:",
    "",
    "Tarefa:",
    "- Gere ate 2 consultas curtas para bancos de imagens.",
    "- Traduza a palavra portuguesa para a forma inglesa ou internacional mais util para busca visual.",
    "- Se o termo for animal, planta, objeto, figura mitologica ou nome classico, use o nome internacional mais buscavel.",
    "- Para substantivos concretos, prefira a forma inglesa comum do referente.",
    "- Se houver plural em portugues, voce pode usar singular ou plural em ingles, conforme a busca visual ficar melhor.",
    "- Nao explique nada; so devolva as consultas.",
    "- Nao repita a palavra portuguesa se houver traducao claramente melhor.",
    "",
    'Formato obrigatorio: {"queries":["...","..."]}',
  ].join("\n");
}

async function fetchHiddenImageTranslationQueries(
  requestedWord: string,
  candidates: string[],
) {
  const normalizedWord = normalizeSearchText(requestedWord);
  const cache = getImageQueryTranslationCache();
  const cacheKey = uniqueImageQueries([requestedWord, ...candidates])
    .map((value) => normalizeSearchText(value))
    .join("|");
  const cached = cache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const glossaryQueries = IMAGE_QUERY_TRANSLATION_GLOSSARY[normalizedWord] ?? [];

  if (glossaryQueries.length > 0) {
    const direct = uniqueImageQueries(glossaryQueries).slice(0, IMAGE_TRANSLATED_QUERY_LIMIT);
    cache.set(cacheKey, direct);
    return direct;
  }

  const apiKeys = getGeminiApiKeys();

  if (apiKeys.length === 0) {
    const fallback = uniqueImageQueries(glossaryQueries);
    cache.set(cacheKey, fallback);
    return fallback;
  }

  const body = JSON.stringify({
    contents: [
      {
        parts: [
          {
            text: buildImageTranslationPrompt(
              requestedWord,
              uniqueImageQueries([requestedWord, ...candidates]).slice(0, 6),
            ),
          },
        ],
        role: "user",
      },
    ],
    generationConfig: {
      maxOutputTokens: 220,
      temperature: 0.1,
      topP: 0.5,
    },
  });

  for (const model of getImageTranslationModels()) {
    for (const version of GEMINI_TEXT_API_VERSIONS) {
      for (const apiKey of apiKeys) {
        const url = new URL(
          `${GEMINI_IMAGE_ENDPOINT}/${version}/models/${encodeURIComponent(
            model,
          )}:generateContent`,
        );
        url.searchParams.set("key", apiKey);

        try {
          const response = await fetch(url, {
            body,
            cache: "no-store",
            headers: {
              "content-type": "application/json",
            },
            method: "POST",
            signal: AbortSignal.timeout(12000),
          });

          if (!response.ok) {
            continue;
          }

          const payload = (await response.json()) as GeminiImageResponse;
          const rawText =
            payload.candidates?.[0]?.content?.parts
              ?.map((part) => part.text ?? "")
              .join("\n") ?? "";
          const jsonText = extractJsonObject(rawText);

          if (!jsonText) {
            continue;
          }

          const parsed = JSON.parse(jsonText) as ImageTranslationPayload;
          const queries = uniqueImageQueries([
            ...glossaryQueries,
            ...(parsed.queries ?? []),
          ]).slice(0, IMAGE_TRANSLATED_QUERY_LIMIT);
          cache.set(cacheKey, queries);
          return queries;
        } catch {
          continue;
        }
      }
    }
  }

  const fallback = uniqueImageQueries(glossaryQueries);
  cache.set(cacheKey, fallback);
  return fallback;
}

function buildOrderedImageQueries(translatedQueries: string[], visibleQueries: string[]) {
  if (translatedQueries.length === 0) {
    return uniqueImageQueries(visibleQueries);
  }

  return uniqueImageQueries([
    translatedQueries[0] ?? "",
    visibleQueries[0] ?? "",
    ...translatedQueries.slice(1),
    ...visibleQueries.slice(1),
  ]);
}

function hasConfidentImageHit(hits: RankedImageHit[]) {
  return (hits[0]?.score ?? Number.NEGATIVE_INFINITY) >= 86;
}

function conceptualSvg(title: string, subtitle: string, variant: ConceptVariant) {
  const escapedTitle = escapeHtml(title);
  const escapedSubtitle = escapeHtml(subtitle);
  const elementsByVariant: Record<ConceptVariant, string> = {
    above: `
      <rect x="78" y="36" width="124" height="58" rx="18" fill="#f2c98d"/>
      <rect x="78" y="154" width="124" height="58" rx="18" fill="#d8e7cd"/>
      <path d="M140 104v38" stroke="#7e5633" stroke-width="7" stroke-linecap="round"/>
      <path d="M126 128l14 16 14-16" fill="none" stroke="#7e5633" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
    `,
    action: `
      <circle cx="88" cy="128" r="30" fill="#d8e7cd"/>
      <circle cx="192" cy="128" r="30" fill="#f2c98d"/>
      <path d="M116 128h48" stroke="#7e5633" stroke-width="8" stroke-linecap="round"/>
      <path d="M150 110l20 18-20 18" fill="none" stroke="#7e5633" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M70 88c34-28 105-29 140 0" fill="none" stroke="#b97a47" stroke-width="5" stroke-linecap="round" stroke-dasharray="1 13"/>
      <path d="M72 168c38 24 98 24 136 0" fill="none" stroke="#7b9b69" stroke-width="5" stroke-linecap="round" stroke-dasharray="1 13"/>
    `,
    anatomy: `
      <path d="M96 178c6-48 14-78 44-96 30 18 38 48 44 96" fill="#f2c98d"/>
      <path d="M118 86c4-20 14-30 22-30s18 10 22 30" fill="none" stroke="#7e5633" stroke-width="7" stroke-linecap="round"/>
      <path d="M102 142c16-10 30-15 38-15s22 5 38 15" fill="none" stroke="#b97a47" stroke-width="7" stroke-linecap="round"/>
      <path d="M114 112c7 9 16 13 26 13s19-4 26-13" fill="none" stroke="#7b9b69" stroke-width="6" stroke-linecap="round"/>
      <circle cx="140" cy="95" r="7" fill="#8f5b36"/>
    `,
    between: `
      <rect x="34" y="92" width="82" height="72" rx="18" fill="#d8e7cd"/>
      <rect x="164" y="92" width="82" height="72" rx="18" fill="#f2c98d"/>
      <circle cx="140" cy="128" r="18" fill="#8f5b36"/>
    `,
    book: `
      <path d="M74 58h64c18 0 32 9 38 24 6-15 20-24 38-24h30v116h-38c-14 0-25 5-30 16-5-11-16-16-30-16H74V58z" fill="#fffaf0" stroke="#7e5633" stroke-width="6" stroke-linejoin="round"/>
      <path d="M176 82v108" stroke="#b97a47" stroke-width="5" stroke-linecap="round"/>
      <path d="M96 86h52M96 110h48M96 134h42M198 86h26M198 110h24M198 134h28" stroke="#7b6a5b" stroke-width="5" stroke-linecap="round"/>
      <rect x="50" y="72" width="34" height="92" rx="8" fill="#d8e7cd" stroke="#7b9b69" stroke-width="5"/>
      <rect x="228" y="72" width="34" height="92" rx="8" fill="#f2c98d" stroke="#b97a47" stroke-width="5"/>
    `,
    house: `
      <path d="M54 120 140 54l86 66" fill="none" stroke="#7e5633" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="76" y="116" width="128" height="70" rx="12" fill="#f2c98d"/>
      <rect x="121" y="142" width="38" height="44" rx="8" fill="#8f5b36"/>
      <rect x="91" y="132" width="24" height="22" rx="5" fill="#fffaf0"/>
      <rect x="166" y="132" width="24" height="22" rx="5" fill="#fffaf0"/>
      <path d="M64 188h152" stroke="#7b9b69" stroke-width="7" stroke-linecap="round"/>
    `,
    island: `
      <rect x="30" y="120" width="220" height="46" rx="23" fill="#b9d6df"/>
      <path d="M80 132c34-38 77-45 123 0 11 11 1 25-18 24l-90-1c-24-1-30-7-15-23z" fill="#d8c28d"/>
      <path d="M132 120c4-30 15-48 36-61" stroke="#7e5633" stroke-width="6" stroke-linecap="round"/>
      <path d="M161 66c-29-6-48 1-64 18 26-3 47 3 64-18z" fill="#7b9b69"/>
      <path d="M166 62c10 25 8 45-6 64-4-24-14-42 6-64z" fill="#8fb37a"/>
    `,
    kinship: `
      <circle cx="104" cy="74" r="24" fill="#8f5b36"/>
      <circle cx="176" cy="74" r="24" fill="#b97a47"/>
      <path d="M68 166c7-42 28-64 36-64s29 22 36 64" fill="#d8e7cd"/>
      <path d="M140 166c7-42 28-64 36-64s29 22 36 64" fill="#f2c98d"/>
      <path d="M122 116h36" stroke="#7e5633" stroke-width="7" stroke-linecap="round"/>
    `,
    mountain: `
      <path d="M28 168 96 70l42 58 32-43 82 83H28z" fill="#d8e7cd"/>
      <path d="M96 70l20 28-20-8-18 10 18-30zM170 85l23 24-24-8-18 10 19-26z" fill="#fffaf0"/>
      <path d="M32 168h216" stroke="#7e5633" stroke-width="6" stroke-linecap="round"/>
    `,
    ordinal: `
      <circle cx="140" cy="118" r="58" fill="#f2c98d" stroke="#7e5633" stroke-width="7"/>
      <path d="M82 174c34 18 82 20 116 0" fill="none" stroke="#7b9b69" stroke-width="6" stroke-linecap="round"/>
      <text x="140" y="128" text-anchor="middle" font-family="Georgia, serif" font-size="40" font-weight="700" fill="#2d221b">nº</text>
      <path d="M112 62c18-14 38-14 56 0" fill="none" stroke="#b97a47" stroke-width="6" stroke-linecap="round"/>
    `,
    pocket: `
      <path d="M72 56h136v86c0 42-27 68-68 68s-68-26-68-68V56z" fill="#f2c98d" stroke="#7e5633" stroke-width="7" stroke-linejoin="round"/>
      <path d="M91 82h98v55c0 30-19 49-49 49s-49-19-49-49V82z" fill="#fffaf0" opacity=".78" stroke="#b97a47" stroke-width="5" stroke-linejoin="round"/>
      <path d="M92 102c30 19 66 19 96 0" fill="none" stroke="#7b9b69" stroke-width="6" stroke-linecap="round"/>
      <circle cx="112" cy="74" r="5" fill="#8f5b36"/>
      <circle cx="168" cy="74" r="5" fill="#8f5b36"/>
    `,
  };

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="280" height="220" viewBox="0 0 280 220" role="img" aria-label="${escapedTitle}">
      <rect width="280" height="220" rx="26" fill="#fffaf0"/>
      ${elementsByVariant[variant]}
      <text x="140" y="28" text-anchor="middle" font-family="Georgia, serif" font-size="18" fill="#2d221b">${escapedTitle}</text>
      <text x="140" y="206" text-anchor="middle" font-family="Georgia, serif" font-size="14" fill="#7b6a5b">${escapedSubtitle}</text>
    </svg>
  `.trim();

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function buildConceptHit(
  word: string,
  concept: { subtitle: string; variant: ConceptVariant },
): ImageHit {
  return {
    author: "Mathesis",
    license: "esquema conceitual",
    pageUrl: "#",
    thumbUrl: conceptualSvg(word, concept.subtitle, concept.variant),
    title: word,
  };
}

function buildImageProxyUrl(url: string) {
  if (url.startsWith("data:")) {
    return url;
  }

  try {
    const parsed = new URL(url);

    if (!/^https?:$/i.test(parsed.protocol)) {
      return url;
    }

    const normalizedHost = parsed.hostname.trim().toLocaleLowerCase("en-US");
    const isProxyable = PROXYABLE_IMAGE_HOSTS.some((allowedHost) =>
      allowedHost.startsWith(".")
        ? normalizedHost === allowedHost.slice(1) ||
          normalizedHost.endsWith(allowedHost)
        : normalizedHost === allowedHost,
    );

    return isProxyable
      ? `/api/image-proxy?src=${encodeURIComponent(url)}`
      : url;
  } catch {
    return url;
  }
}

function buildImageSearchPlan(word: string, candidates: string[]): ImageSearchPlan {
  const normalized = normalizeSearchText(word);
  const lookupCandidates = [...new Set([word, ...candidates])]
    .map((candidate) => normalizeInlineText(candidate))
    .filter(Boolean);
  const firstCandidate =
    lookupCandidates.find((candidate) => normalizeSearchText(candidate) !== normalized) ??
    lookupCandidates[0] ??
    word;
  const verbLemma = candidates.find(
    (candidate) =>
      normalizeSearchText(candidate) !== normalized &&
      /(?:ar|er|ir|por|pôr)$/iu.test(candidate),
  );
  const basePlan: ImageSearchPlan = {
    concepts: [],
    conceptOnly: false,
    queries: lookupCandidates.length > 0 ? lookupCandidates.slice(0, 5) : [firstCandidate],
  };
  const plans: Record<string, Partial<ImageSearchPlan>> = {
    livro: {
      concepts: [{ subtitle: "obra escrita em volume", variant: "book" }],
      promptHint:
        "Represente livros físicos como volumes encadernados ou abertos para leitura; nao represente apenas letras soltas, estantes vazias ou resultados de busca.",
      queries: ["livro", "livros", "book", "books", "open book"],
    },
    livros: {
      concepts: [{ subtitle: "volumes de leitura", variant: "book" }],
      promptHint:
        "Represente livros físicos, vários volumes claros e reconhecíveis; nao represente apenas letras soltas, estantes vazias ou resultados de busca.",
      queries: ["livro", "livros", "book", "books", "open books"],
    },
    casa: {
      concepts: [{ subtitle: "moradia, lar, edificacao", variant: "house" }],
      promptHint:
        "Represente uma casa como moradia ou lar, com fachada simples e reconhecivel.",
      queries: ["casa", "casa moradia fachada", "house exterior home"],
    },
    bolso: {
      concepts: [{ subtitle: "pequeno compartimento de roupa", variant: "pocket" }],
      promptHint:
        "Represente um bolso de roupa, como um bolso costurado em camisa, calca ou casaco. Nao represente bolsa, mercado financeiro ou ato de embolsar.",
      queries: ["clothing pocket", "trouser pocket", "shirt pocket", "bolso de roupa"],
    },
    peito: {
      concepts: [{ subtitle: "parte frontal do torso humano", variant: "anatomy" }],
      promptHint:
        "Represente peito como torso ou caixa toracica humana. Nao represente mala, bau, correio, arrecadacao ou metaforas comerciais.",
      queries: ["peito humano", "torso humano", "human chest", "upper torso person"],
    },
    entre: {
      concepts: [{ subtitle: "um elemento entre dois outros", variant: "between" }],
      conceptOnly: true,
      promptHint:
        "A palavra e uma relacao espacial: mostre um objeto central posicionado entre dois objetos laterais.",
      queries: ["entre", "between objects illustration"],
    },
    filha: {
      concepts: [{ subtitle: "relacao familiar", variant: "kinship" }],
      promptHint: "Represente a relacao familiar de filha sem usar retratos identificaveis.",
      queries: ["filha", "filha familia", "daughter family portrait"],
    },
    filho: {
      concepts: [{ subtitle: "relacao familiar", variant: "kinship" }],
      promptHint: "Represente a relacao familiar de filho sem usar retratos identificaveis.",
      queries: ["filho", "filho familia", "son family portrait"],
    },
    ilha: {
      concepts: [{ subtitle: "terra cercada de agua", variant: "island" }],
      promptHint:
        "Represente uma ilha como porcao de terra cercada por agua; nao represente navios militares nem lugares com nomes parecidos.",
      queries: ["ilha", "ilha tropical praia", "tropical island beach"],
    },
    homem: {
      concepts: [{ subtitle: "pessoa do sexo masculino", variant: "kinship" }],
      promptHint:
        "Represente um homem como pessoa humana adulta, em retrato ou figura clara, sem marcas, sem capas de livro e sem resultados de busca.",
      queries: ["homem retrato", "homem pessoa", "man portrait"],
    },
    irma: {
      concepts: [{ subtitle: "relacao de parentesco", variant: "kinship" }],
      conceptOnly: true,
      promptHint: "Represente a relacao de irmandade sem usar lugares chamados Dois Irmaos.",
      queries: ["irma", "irmas familia", "sisters family portrait"],
    },
    irmao: {
      concepts: [{ subtitle: "relacao de parentesco", variant: "kinship" }],
      conceptOnly: true,
      promptHint: "Represente a relacao de irmandade sem usar lugares chamados Dois Irmaos.",
      queries: ["irmao", "irmaos familia", "brothers family portrait"],
    },
    monte: {
      concepts: [{ subtitle: "elevacao de terra", variant: "mountain" }],
      promptHint:
        "Represente monte como elevacao natural de terra; nao use cidades, placas, bairros ou lugares chamados Monte.",
      queries: ["monte", "monte montanha paisagem", "mountain landscape"],
    },
    marte: {
      promptHint:
        "Represente Marte como deus romano da guerra em estatua, pintura ou ilustracao classica; nao represente o planeta.",
      queries: ["Marte deus romano", "Marte mitologia romana", "Mars roman god"],
    },
    montanha: {
      concepts: [{ subtitle: "elevacao de terra", variant: "mountain" }],
      promptHint: "Represente uma montanha real ou uma silhueta clara de montanha.",
      queries: ["montanha", "montanha paisagem", "mountain landscape"],
    },
    sobre: {
      concepts: [{ subtitle: "um elemento acima de outro", variant: "above" }],
      conceptOnly: true,
      promptHint:
        "A palavra e uma preposicao de posicao: mostre um objeto claramente acima de outro, sem animais, sem passaros e sem paisagem natural.",
      queries: ["sobre", "object above another illustration"],
    },
    urutau: {
      promptHint:
        "Represente a ave urutau, tambem chamada mae-da-lua, pousada camuflada em um galho.",
      queries: ["urutau", "urutau ave", "Nyctibius griseus"],
    },
  };
  const override = plans[normalized] ?? {};

  if (
    !override.queries &&
    /(?:quadragesim|vigesim|trigesim|quinquagesim|sexagesim|septuagesim|octogesim|nonagesim|centesim|esim[ao])$/iu.test(
      normalized,
    )
  ) {
    return {
      concepts: [{ subtitle: "ordem numerica ou posicao ordinal", variant: "ordinal" }],
      conceptOnly: true,
      promptHint:
        "A palavra e um ordinal. Represente a ideia de posicao em uma sequencia numerica, sem capas de livro, sem texto longo e sem resultados de busca.",
      queries: [`${firstCandidate} ordinal`],
    };
  }

  if (
    !override.queries &&
    verbLemma &&
    /(?:ndo|ei|ou|ava|avam|aria|ariam|asse|assem|ize|izo)$/iu.test(normalized)
  ) {
    return {
      concepts: [{ subtitle: `acao verbal ligada a ${verbLemma}`, variant: "action" }],
      conceptOnly: true,
      promptHint: `A palavra selecionada parece uma forma verbal. Represente a ideia de acao/processo ligada ao verbo "${verbLemma}", sem letras nem resultados de busca.`,
      queries: [`${verbLemma} conceito visual`],
    };
  }

  return {
    concepts: override.concepts ?? basePlan.concepts,
    conceptOnly: override.conceptOnly ?? basePlan.conceptOnly,
    promptHint: override.promptHint ?? basePlan.promptHint,
    queries: override.queries ?? basePlan.queries,
  };
}

function buildNanoBananaPrompt(word: string, plan: ImageSearchPlan) {
  const hint = plan.promptHint
    ? `Dica semantica obrigatoria: ${plan.promptHint}`
    : "Se houver ambiguidade, escolha o sentido lexical mais comum em portugues.";

  return [
    `Crie uma unica imagem original para representar a palavra portuguesa "${word}".`,
    hint,
    `O assunto visual principal deve ser exatamente "${word}", nao uma palavra parecida nem uma consulta anterior.`,
    "A imagem deve nascer somente desta palavra atual; ignore qualquer consulta, animal, objeto, cenario ou imagem anterior.",
    "Evite falsos positivos: nao represente homonimos, nomes de cidade, sobrenomes, marcas, capas de livro, placas, mapas ou resultados de busca que apenas contenham a palavra.",
    "Nao inclua texto, legenda, letras, logotipo, marca d'agua, interface, moldura ou a propria palavra escrita na imagem.",
    "Se a palavra for concreta, gere uma imagem clara, realista e centralizada do referente principal, sem metaforas nem elementos irrelevantes.",
    "Se a palavra for abstrata, relacional, adverbial ou preposicional, gere uma composicao conceitual simples com formas geometricas, luz e posicao espacial.",
    "Composicao elegante, limpa, fundo neutro quente, proporcao horizontal 16:9, sem duplicacoes desnecessarias.",
  ].join("\n");
}

function parseGeminiImage(payload: GeminiImageResponse) {
  for (const candidate of payload.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const inlineData = part.inlineData ?? part.inline_data;
      const data = inlineData?.data;

      if (!data) {
        continue;
      }

      const mimeType =
        (inlineData as { mimeType?: string }).mimeType ??
        (inlineData as { mime_type?: string }).mime_type;

      return {
        data,
        mimeType: mimeType ?? "image/png",
      };
    }
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readImageObject(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  const data = value.data;
  const mimeType = value.mimeType ?? value.mime_type;

  if (typeof data === "string" && data.length > 100) {
    return {
      data,
      mimeType:
        typeof mimeType === "string" && mimeType.startsWith("image/")
          ? mimeType
          : "image/png",
    };
  }

  return null;
}

function findInteractionImage(value: unknown, depth = 0): { data: string; mimeType: string } | null {
  if (depth > 8) {
    return null;
  }

  const image = readImageObject(value);

  if (image) {
    return image;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findInteractionImage(item, depth + 1);

      if (found) {
        return found;
      }
    }

    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const likelyImage =
    findInteractionImage(value.output_image, depth + 1) ??
    findInteractionImage(value.outputImage, depth + 1) ??
    findInteractionImage(value.generated_image, depth + 1) ??
    findInteractionImage(value.generatedImage, depth + 1) ??
    findInteractionImage(value.inlineData, depth + 1) ??
    findInteractionImage(value.inline_data, depth + 1);

  if (likelyImage) {
    return likelyImage;
  }

  for (const nested of Object.values(value)) {
    const found = findInteractionImage(nested, depth + 1);

    if (found) {
      return found;
    }
  }

  return null;
}

function buildGeneratedHit(word: string, image: { data: string; mimeType: string }): ImageHit {
  return {
    author: "Gerador de imagens",
    license: "SynthID",
    pageUrl: NANO_BANANA_SOURCE_URL,
    thumbUrl: `data:${image.mimeType};base64,${image.data}`,
    title: `Imagem gerada para "${word}"`,
  };
}

async function fetchNanoBananaInteractionImage(
  word: string,
  plan: ImageSearchPlan,
  model: string,
  apiKey: string,
) {
  const response = await fetch(GEMINI_INTERACTIONS_ENDPOINT, {
    body: JSON.stringify({
      input: [{ text: buildNanoBananaPrompt(word, plan), type: "text" }],
      model,
      response_format: {
        aspect_ratio: "16:9",
        image_size: "1K",
        mime_type: "image/png",
        type: "image",
      },
    }),
    cache: "no-store",
    headers: {
      "Api-Revision": "2026-05-20",
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
    },
    method: "POST",
    signal: AbortSignal.timeout(45000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return {
      error: `${response.status} ${errorText.slice(0, 180)}`,
      image: null,
    };
  }

  const payload = (await response.json()) as unknown;
  const image = findInteractionImage(payload);

  return {
    error: image ? null : "resposta sem imagem",
    image,
  };
}

async function fetchNanoBananaImage(word: string, plan: ImageSearchPlan) {
  const apiKey = getGeminiImageApiKey();
  const failures: string[] = [];

  if (!apiKey) {
    return {
      failure: "sem chave de imagem no ambiente",
      hit: null,
    } satisfies NanoBananaResult;
  }

  for (const model of getNanoBananaModels()) {
    try {
      const interactionResult = await fetchNanoBananaInteractionImage(
        word,
        plan,
        model,
        apiKey,
      );

      if (interactionResult.image) {
        return {
          failure: null,
          hit: buildGeneratedHit(word, interactionResult.image),
        } satisfies NanoBananaResult;
      }

      failures.push(`${model}/interactions: ${interactionResult.error}`);
    } catch {
      failures.push(`${model}/interactions: falha de rede ou timeout`);
    }

    for (const version of GEMINI_IMAGE_API_VERSIONS) {
      const url = new URL(
        `${GEMINI_IMAGE_ENDPOINT}/${version}/models/${encodeURIComponent(
          model,
        )}:generateContent`,
      );
      url.searchParams.set("key", apiKey);

      try {
        const response = await fetch(url, {
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text: buildNanoBananaPrompt(word, plan) }],
                role: "user",
              },
            ],
            generationConfig: {
              responseModalities: ["IMAGE"],
              responseFormat: {
                image: {
                  aspectRatio: "16:9",
                },
              },
            },
          }),
          cache: "no-store",
          headers: {
            "content-type": "application/json",
          },
          method: "POST",
          signal: AbortSignal.timeout(28000),
        });

        if (!response.ok) {
          const errorText = await response.text();
          let errorMessage = errorText.slice(0, 180);

          try {
            const payload = JSON.parse(errorText) as GeminiImageResponse;
            errorMessage = payload.error?.message?.slice(0, 180) ?? errorMessage;
          } catch {
            // Keep the plain status text; diagnostics must never block fallback.
          }

          failures.push(`${model}/${version}: ${response.status} ${errorMessage}`);
          continue;
        }

        const payload = (await response.json()) as GeminiImageResponse;
        const image = parseGeminiImage(payload);

        if (!image) {
          const textFallback = payload.candidates?.[0]?.content?.parts
            ?.map((part) => part.text ?? "")
            .filter(Boolean)
            .join(" ")
            .slice(0, 180);
          failures.push(
            `${model}/${version}: resposta sem imagem${
              textFallback ? ` (${textFallback})` : ""
            }`,
          );
          continue;
        }

        return {
          failure: null,
          hit: buildGeneratedHit(word, image),
        } satisfies NanoBananaResult;
      } catch {
        failures.push(`${model}/${version}: falha de rede ou timeout`);
        continue;
      }
    }
  }

  return {
    failure: failures[0] ?? "modelo indisponivel nesta consulta",
    hit: null,
  } satisfies NanoBananaResult;
}

async function fetchGoogleImagesWithApi(query: string) {
  const credentials = getGoogleImageCredentials();

  if (!credentials) {
    return [];
  }

  const url = new URL(GOOGLE_CSE_ENDPOINT);
  url.searchParams.set("key", credentials.apiKey);
  url.searchParams.set("cx", credentials.searchEngineId);
  url.searchParams.set("q", query);
  url.searchParams.set("searchType", "image");
  url.searchParams.set("num", "8");
  url.searchParams.set("safe", "active");

  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(9000),
  });

  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as GoogleImageSearchResponse;

  return (payload.items ?? [])
    .map((item): ImageHit | null => {
      const thumbUrl = item.image?.thumbnailLink ?? item.link;
      const pageUrl = item.image?.contextLink ?? item.link;

      if (!thumbUrl || !pageUrl) {
        return null;
      }

      return {
        author: item.displayLink ?? "Google Imagens",
        license: null,
        pageUrl,
        thumbUrl,
        title: normalizeInlineText(item.title ?? query),
      };
    })
    .filter((hit): hit is ImageHit => Boolean(hit));
}

function isGoogleBlockedText(value: string) {
  return /tr[aá]fego incomum|unusual traffic|captcha|sorry\/index|enablejs|atualize o navegador/i.test(
    value,
  );
}

// Disabled: scraping Google Images is unstable and prone to false positives.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function fetchGoogleImagesWithoutApi(query: string) {
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("q", query);
  url.searchParams.set("tbm", "isch");
  url.searchParams.set("hl", "pt-BR");
  url.searchParams.set("gl", "BR");

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: GOOGLE_HEADERS,
      signal: AbortSignal.timeout(IMAGE_PROVIDER_TIMEOUT_MS),
    });
    const html = await response.text();

    if (!response.ok || isGoogleBlockedText(html)) {
      return [];
    }

    const $ = load(html);
    const hits: ImageHit[] = [];

    $("img").each((_, image) => {
      const src = $(image).attr("src");
      const alt = normalizeInlineText($(image).attr("alt") ?? query);

      if (!src || src.startsWith("data:") || !/^https?:\/\//iu.test(src)) {
        return;
      }

      hits.push({
        author: "Google experimental",
        license: null,
        pageUrl: `${GOOGLE_IMAGES_SEARCH_ENDPOINT}${encodeURIComponent(query)}`,
        thumbUrl: src,
        title: alt || query,
      });
    });

    return hits.slice(0, 8);
  } catch {
    return [];
  }
}

async function fetchPixabayImages(query: string, language: "pt" | "en" = "pt") {
  const apiKey = getPixabayApiKey();

  if (!apiKey) {
    return [];
  }

  const url = new URL(PIXABAY_IMAGE_ENDPOINT);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("q", query);
  url.searchParams.set("image_type", "photo");
  url.searchParams.set("safesearch", "true");
  url.searchParams.set("per_page", String(IMAGE_PROVIDER_FETCH_LIMIT));
  url.searchParams.set("lang", language);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(IMAGE_PROVIDER_TIMEOUT_MS),
    });

    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as PixabayImageResponse;

    return (payload.hits ?? [])
      .map((item): ImageHit | null => {
        const thumbUrl = item.webformatURL ?? item.largeImageURL;
        const pageUrl = item.pageURL;

        if (!thumbUrl || !pageUrl) {
          return null;
        }

        return {
          author: item.user ?? "Pixabay",
          license: "Pixabay",
          pageUrl,
          thumbUrl,
          title: buildPixabayTitle(item.tags, query),
        };
      })
      .filter((hit): hit is ImageHit => Boolean(hit));
  } catch {
    return [];
  }
}

async function fetchPexelsImages(
  query: string,
  locale: "pt-BR" | "en-US" = "pt-BR",
) {
  const apiKey = getPexelsApiKey();

  if (!apiKey) {
    return [];
  }

  const url = new URL(PEXELS_IMAGE_ENDPOINT);
  url.searchParams.set("query", query);
  url.searchParams.set("per_page", String(IMAGE_PROVIDER_FETCH_LIMIT));
  url.searchParams.set("locale", locale);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        Authorization: apiKey,
      },
      signal: AbortSignal.timeout(IMAGE_PROVIDER_TIMEOUT_MS),
    });

    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as PexelsImageResponse;

    return (payload.photos ?? [])
      .map((item): ImageHit | null => {
        const thumbUrl = item.src?.medium ?? item.src?.landscape ?? item.src?.large;
        const pageUrl = item.url;

        if (!thumbUrl || !pageUrl) {
          return null;
        }

        return {
          author: item.photographer ?? "Pexels",
          license: "Pexels",
          pageUrl,
          thumbUrl,
          title: buildStockImageTitle(item.alt ?? query, query),
        };
      })
      .filter((hit): hit is ImageHit => Boolean(hit));
  } catch {
    return [];
  }
}

async function fetchUnsplashImages(query: string, language: "pt" | "en" = "pt") {
  const accessKey = getUnsplashAccessKey();

  if (!accessKey) {
    return [];
  }

  const url = new URL(UNSPLASH_IMAGE_ENDPOINT);
  url.searchParams.set("query", query);
  url.searchParams.set("per_page", String(IMAGE_PROVIDER_FETCH_LIMIT));
  url.searchParams.set("content_filter", "high");
  url.searchParams.set("orientation", "landscape");
  url.searchParams.set("lang", language);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        Authorization: `Client-ID ${accessKey}`,
      },
      signal: AbortSignal.timeout(9000),
    });

    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as UnsplashImageResponse;

    return (payload.results ?? [])
      .map((item): ImageHit | null => {
        const thumbUrl = item.urls?.small ?? item.urls?.regular ?? item.urls?.thumb;
        const pageUrl = item.links?.html;

        if (!thumbUrl || !pageUrl) {
          return null;
        }

        return {
          author: item.user?.name ?? "Unsplash",
          license: "Unsplash",
          pageUrl,
          thumbUrl,
          title: buildStockImageTitle(
            item.alt_description ?? item.description ?? query,
            query,
          ),
        };
      })
      .filter((hit): hit is ImageHit => Boolean(hit));
  } catch {
    return [];
  }
}

async function fetchOpenverseImages(query: string) {
  const url = new URL(OPENVERSE_IMAGE_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("page_size", "8");
  url.searchParams.set("mature", "false");

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: GOOGLE_HEADERS,
      signal: AbortSignal.timeout(9000),
    });

    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as OpenverseImageResponse;

    return (payload.results ?? [])
      .map((item): ImageHit | null => {
        const thumbUrl = item.thumbnail ?? item.url;
        const pageUrl = item.foreign_landing_url ?? item.url;

        if (!thumbUrl || !pageUrl) {
          return null;
        }

        return {
          author: item.creator ?? "Openverse",
          license: item.license ?? "Openverse",
          pageUrl,
          thumbUrl,
          title: normalizeInlineText(item.title ?? query),
        };
      })
      .filter((hit): hit is ImageHit => Boolean(hit));
  } catch {
    return [];
  }
}

async function fetchDuckDuckGoImages(query: string) {
  try {
    const pageUrl = new URL(DUCKDUCKGO_IMAGE_PAGE_ENDPOINT);
    pageUrl.searchParams.set("q", query);
    pageUrl.searchParams.set("iax", "images");
    pageUrl.searchParams.set("ia", "images");

    const pageResponse = await fetch(pageUrl, {
      cache: "no-store",
      headers: GOOGLE_HEADERS,
      signal: AbortSignal.timeout(9000),
    });
    const pageHtml = await pageResponse.text();

    if (!pageResponse.ok) {
      return [];
    }

    const vqd = /vqd=["']?([^"'\s&]+)/u.exec(pageHtml)?.[1];

    if (!vqd) {
      return [];
    }

    const apiUrl = new URL(DUCKDUCKGO_IMAGE_ENDPOINT);
    apiUrl.searchParams.set("q", query);
    apiUrl.searchParams.set("vqd", vqd);
    apiUrl.searchParams.set("l", "br-pt");
    apiUrl.searchParams.set("o", "json");
    apiUrl.searchParams.set("f", ",,,");
    apiUrl.searchParams.set("p", "1");

    const response = await fetch(apiUrl, {
      cache: "no-store",
      headers: {
        ...GOOGLE_HEADERS,
        referer: pageUrl.toString(),
      },
      signal: AbortSignal.timeout(9000),
    });

    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as DuckDuckGoImageResponse;

    return (payload.results ?? [])
      .map((item): ImageHit | null => {
        const thumbUrl = item.thumbnail ?? item.image;
        const resultPageUrl = item.url ?? item.image;

        if (!thumbUrl || !resultPageUrl) {
          return null;
        }

        return {
          author: item.source ?? "DuckDuckGo Images",
          license: null,
          pageUrl: resultPageUrl,
          thumbUrl,
          title: normalizeInlineText(item.title ?? query),
        };
      })
      .filter((hit): hit is ImageHit => Boolean(hit));
  } catch {
    return [];
  }
}

function scoreWikipediaSummary(query: string, summary: WikipediaSummaryResponse) {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedTitle = normalizeSearchText(summary.title ?? "");
  const normalizedDescription = normalizeSearchText(summary.description ?? "");
  const normalizedExtract = normalizeSearchText(summary.extract ?? "");
  const haystack = `${normalizedTitle} ${normalizedDescription} ${normalizedExtract}`;
  const isExactTitle = normalizedTitle === normalizedQuery;
  const looksLikePopCulture =
    /\b(filme|personagem|album|álbum|cancao|canção|jogo|serie|série|empresa|marca|desambiguacao|desambiguação)\b/iu.test(
      `${summary.description ?? ""} ${summary.extract ?? ""}`,
    ) && !isExactTitle;

  if (!summary.thumbnail?.source || summary.type === "disambiguation" || looksLikePopCulture) {
    return -1;
  }

  let score = 0;

  if (isExactTitle) {
    score += 12;
  } else if (normalizedTitle.startsWith(normalizedQuery)) {
    score += 5;
  }

  if (haystack.includes(normalizedQuery)) {
    score += 3;
  }

  if (
    /\b(estrutura|habitação|animal|planta|ave|mamifero|mamífero|ser humano|objeto|alimento|instrumento|local|fenomeno|fenômeno)\b/iu.test(
      `${summary.description ?? ""} ${summary.extract ?? ""}`,
    )
  ) {
    score += 2;
  }

  return score;
}

async function fetchWikipediaLeadImages(query: string) {
  const searchUrl = new URL(WIKIPEDIA_SEARCH_ENDPOINT);
  searchUrl.searchParams.set("action", "opensearch");
  searchUrl.searchParams.set("format", "json");
  searchUrl.searchParams.set("limit", "5");
  searchUrl.searchParams.set("namespace", "0");
  searchUrl.searchParams.set("origin", "*");
  searchUrl.searchParams.set("search", query);

  try {
    const searchResponse = await fetch(searchUrl, {
      cache: "no-store",
      headers: {
        "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
        "user-agent": "Mathesis/0.1 private-study image lookup",
      },
      signal: AbortSignal.timeout(9000),
    });

    if (!searchResponse.ok) {
      return [];
    }

    const payload = (await searchResponse.json()) as WikipediaSearchResponse;
    const titles = [...new Set(payload[1] ?? [])].slice(0, 4);
    const hits: Array<ImageHit & { score: number }> = [];

    for (const title of titles) {
      const summaryResponse = await fetch(
        `${WIKIPEDIA_SUMMARY_ENDPOINT}${encodeURIComponent(title)}`,
        {
          cache: "no-store",
          headers: {
            "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
            "user-agent": "Mathesis/0.1 private-study image lookup",
          },
          signal: AbortSignal.timeout(9000),
        },
      );

      if (!summaryResponse.ok) {
        continue;
      }

      const summary = (await summaryResponse.json()) as WikipediaSummaryResponse;
      const score = scoreWikipediaSummary(query, summary);

      if (score < 3 || !summary.thumbnail?.source) {
        continue;
      }

      hits.push({
        author: "Wikipedia",
        license: "imagem principal",
        pageUrl:
          summary.content_urls?.desktop?.page ??
          `https://pt.wikipedia.org/wiki/${encodeURIComponent(title).replace(/%20/gu, "_")}`,
        score,
        thumbUrl: summary.thumbnail.source,
        title: normalizeInlineText(summary.title ?? title),
      });
    }

    const sortedHits = hits.sort((left, right) => right.score - left.score);
    const exactHits = sortedHits.filter(
      (hit) => normalizeSearchText(hit.title) === normalizeSearchText(query),
    );
    const selectedHits = exactHits.slice(0, 1);

    return selectedHits
      .map((hit) => ({
        author: hit.author,
        license: hit.license,
        pageUrl: hit.pageUrl,
        thumbUrl: hit.thumbUrl,
        title: hit.title,
      }))
  } catch {
    return [];
  }
}

function scoreStockImageHit(
  requestedWord: string,
  query: string,
  provider: StockImageProvider,
  hit: ImageHit,
) {
  const normalizedWord = normalizeSearchText(requestedWord);
  const normalizedQuery = normalizeSearchText(query);
  const normalizedTitle = normalizeSearchText(hit.title);
  const normalizedPage = normalizeSearchText(hit.pageUrl);
  const normalizedAuthor = normalizeSearchText(hit.author ?? "");
  const haystack = `${normalizedTitle} ${normalizedPage}`;
  let score = STOCK_PROVIDER_PRIORITY[provider];

  if (normalizedTitle === normalizedWord || normalizedTitle === normalizedQuery) {
    score += 40;
  } else if (
    normalizedTitle.startsWith(normalizedWord) ||
    normalizedTitle.startsWith(normalizedQuery)
  ) {
    score += 22;
  }

  if (haystack.includes(normalizedWord)) {
    score += 16;
  }

  if (haystack.includes(normalizedQuery)) {
    score += 10;
  }

  if (normalizedAuthor.includes("wikimedia") || normalizedAuthor.includes("wikipedia")) {
    score -= 12;
  }

  if (
    /\b(icon|logo|banner|template|poster|wallpaper|vector|mockup|clipart|sign|text)\b/iu.test(
      haystack,
    )
  ) {
    score -= 18;
  }

  if (
    /\b(stock|collection|gallery|portfolio|download|free image|wall art)\b/iu.test(
      haystack,
    )
  ) {
    score -= 8;
  }

  if (normalizedWord === "peito") {
    if (
      /\b(mala|bagagem|viagem|correio|enviar|advocacia|apoio|arrecadacao|assistencia|bravura)\b/iu.test(
        haystack,
      )
    ) {
      score -= 30;
    }

    if (/\b(chest|torso|upper body|mamilo|mama|peito humano|anatomia)\b/iu.test(haystack)) {
      score += 26;
    }
  }

  if (normalizedWord === "marte") {
    if (/\b(planet|planeta|rover|space|espaco|nasa)\b/iu.test(haystack)) {
      score -= 28;
    }

    if (/\b(god|deus|roman god|mitologia|mythology|statue|estatua)\b/iu.test(haystack)) {
      score += 22;
    }
  }

  return score;
}

function uniqueRankedImageHits(hits: RankedImageHit[]) {
  const seen = new Map<string, RankedImageHit>();

  for (const hit of hits) {
    const key = `${hit.pageUrl}|${hit.thumbUrl}`;
    const current = seen.get(key);

    if (!current || hit.score > current.score) {
      seen.set(key, hit);
    }
  }

  return [...seen.values()].sort((left, right) => right.score - left.score);
}

function scoreOpenImageHit(requestedWord: string, query: string, hit: ImageHit) {
  const normalizedWord = normalizeSearchText(requestedWord);
  const normalizedQuery = normalizeSearchText(query);
  const normalizedTitle = normalizeSearchText(hit.title);
  const normalizedPage = normalizeSearchText(hit.pageUrl);
  let score = 20;

  if (normalizedTitle === normalizedWord || normalizedTitle === normalizedQuery) {
    score += 40;
  } else if (
    normalizedTitle.includes(normalizedWord) ||
    normalizedTitle.includes(normalizedQuery)
  ) {
    score += 20;
  }

  if (normalizedPage.includes(normalizedWord) || normalizedPage.includes(normalizedQuery)) {
    score += 10;
  }

  if (/\b(icon|logo|banner|template|poster|vector|clipart|text)\b/iu.test(normalizedTitle)) {
    score -= 18;
  }

  return score;
}

function buildImagesSection(hits: ImageHit[]): LookupSection {
  const html = `
    <div class="imageLookupGrid">
      ${hits
        .map(
          (hit) => `
            <a class="imageLookupCard" href="${escapeHtml(hit.pageUrl)}" target="_blank" rel="noreferrer noopener">
              <img src="${escapeHtml(buildImageProxyUrl(hit.thumbUrl))}" alt="${escapeHtml(
                hit.title,
              )}" loading="lazy" referrerpolicy="no-referrer"/>
              <span class="imageLookupTitle">${escapeHtml(hit.title)}</span>
              ${
                hit.license || hit.author
                  ? `<small>${escapeHtml(
                      [hit.license, hit.author].filter(Boolean).join(" · "),
                    )}</small>`
                  : ""
              }
            </a>
          `,
        )
        .join("")}
    </div>
  `;

  return {
    html,
    label: "Imagens",
    text: hits.map((hit) => hit.title).join("\n"),
  };
}

function summarizeNanoBananaFailure(failure: string | null) {
  if (!failure) {
    return "O gerador de imagens não retornou uma imagem nesta consulta";
  }

  if (/permission|forbidden|api key|not found|404|403/i.test(failure)) {
    return "O gerador de imagens não está liberado para esta chave ou modelo";
  }

  if (/timeout|rede/i.test(failure)) {
    return "O gerador de imagens demorou demais nesta consulta";
  }

  return "O gerador de imagens não trouxe uma imagem aproveitável nesta consulta";
}

async function fetchBestImageHits(
  requestedWord: string,
  query: string,
  language: "pt" | "en" = "pt",
) {
  const providers: Array<{
    fetchHits: (query: string) => Promise<ImageHit[]>;
    provider: StockImageProvider;
  }> = [
    {
      fetchHits: (term) => fetchPexelsImages(term, language === "en" ? "en-US" : "pt-BR"),
      provider: "Pexels",
    },
    {
      fetchHits: (term) => fetchUnsplashImages(term, language),
      provider: "Unsplash",
    },
    {
      fetchHits: (term) => fetchPixabayImages(term, language),
      provider: "Pixabay",
    },
  ];
  const settled = await Promise.allSettled(
    providers.map(async (provider) => {
      const hits = await provider.fetchHits(query);

      return hits.map(
        (hit): RankedImageHit => ({
          ...hit,
          provider: provider.provider,
          query,
          score: scoreStockImageHit(requestedWord, query, provider.provider, hit),
        }),
      );
    }),
  );

  return settled
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .sort((left, right) => right.score - left.score);
}

async function fetchBestEnglishImageHits(requestedWord: string, query: string) {
  const providers: Array<{
    fetchHits: (query: string) => Promise<ImageHit[]>;
    provider: OpenImageProvider;
  }> = [
    { fetchHits: fetchDuckDuckGoImages, provider: "DuckDuckGo" },
    { fetchHits: fetchOpenverseImages, provider: "Openverse" },
  ];
  const settled = await Promise.allSettled(
    providers.map(async (provider) => {
      const hits = await provider.fetchHits(query);

      return hits.map(
        (hit): RankedImageHit => ({
          ...hit,
          provider: provider.provider,
          query,
          score: scoreOpenImageHit(requestedWord, query, hit),
        }),
      );
    }),
  );

  return settled
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .sort((left, right) => right.score - left.score);
}

function hasStockImageProvider() {
  return Boolean(getPixabayApiKey() || getPexelsApiKey() || getUnsplashAccessKey());
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T) {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeout = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export async function lookupImages(
  word: string,
  context?: LookupContext,
): Promise<DictionarySourceResult> {
  const requestedWord = normalizeInlineText(word.normalize("NFC"));

  if (detectLookupLanguage(requestedWord, context) === "english") {
    const stockHits = hasStockImageProvider()
      ? await fetchBestImageHits(requestedWord, requestedWord, "en")
      : [];
    const openHits =
      stockHits.length === 0
        ? await fetchBestEnglishImageHits(requestedWord, requestedWord)
        : [];
    const rankedHits = uniqueRankedImageHits(
      [...stockHits, ...openHits],
    ).slice(0, IMAGE_RESULT_LIMIT);
    const hits = rankedHits.map(({ author, license, pageUrl, thumbUrl, title }) => ({
      author,
      license,
      pageUrl,
      thumbUrl,
      title,
    }));
    const providersUsed = [...new Set(rankedHits.map((hit) => hit.provider))];

    return {
      canonicalWord: requestedWord,
      label: "Imagens",
      note:
        hits.length > 0
          ? `Seleção enxuta vinda de ${providersUsed.join(", ")}.`
          : "Não encontrei imagem confiável nos bancos abertos configurados para inglês.",
      sections: hits.length > 0 ? [buildImagesSection(hits)] : [],
      sourceId: "imagens",
      sourceUrl: null,
      status: hits.length > 0 ? "found" : "not_found",
    };
  }

  const candidates = buildPortugueseLookupCandidates(requestedWord);
  const plan = buildImageSearchPlan(requestedWord, candidates);
  const primaryQueries = uniqueImageQueries(plan.queries).slice(0, IMAGE_QUERY_LIMIT);
  const fetched = await Promise.all(
    primaryQueries.map((query) => fetchBestImageHits(requestedWord, query, "pt")),
  );
  let rankedHits = uniqueRankedImageHits(fetched.flat());

  if (rankedHits.length === 0 && !plan.conceptOnly) {
    const translatedQueries = await withTimeout(
      fetchHiddenImageTranslationQueries(requestedWord, [...candidates, ...plan.queries]),
      3500,
      [],
    );
    const backupQueries = buildOrderedImageQueries(translatedQueries, plan.queries)
      .filter((query) => !primaryQueries.includes(query))
      .slice(0, IMAGE_QUERY_LIMIT);
    const backupFetched = await Promise.all(
      backupQueries.map((query) => fetchBestImageHits(requestedWord, query, "pt")),
    );
    rankedHits = uniqueRankedImageHits([...rankedHits, ...backupFetched.flat()]);
  }

  rankedHits = rankedHits.slice(0, IMAGE_RESULT_LIMIT);
  const providersUsed = [...new Set(rankedHits.map((hit) => hit.provider))];
  const hits = rankedHits.map(({ author, license, pageUrl, thumbUrl, title }) => ({
    author,
    license,
    pageUrl,
    thumbUrl,
    title,
  }));
  const hasProvider = hasStockImageProvider();

  return {
    canonicalWord: requestedWord,
    label: "Imagens",
    note:
      hits.length > 0
        ? `Seleção enxuta vinda de ${providersUsed.join(", ")}.`
        : hasProvider
          ? "Não encontrei imagem confiável nos bancos configurados nesta consulta."
          : "Para ativar imagens, configure PIXABAY_API_KEY, PEXELS_API_KEY ou UNSPLASH_ACCESS_KEY no Vercel.",
    sections: hits.length > 0 ? [buildImagesSection(hits)] : [],
    sourceId: "imagens",
    sourceUrl: null,
    status: hits.length > 0 ? "found" : hasProvider ? "not_found" : "unavailable",
  };
}
