import {
  htmlFromMarkdown,
  normalizeInlineText,
} from "./dictionary-utils";
import { getGeminiApiKeys } from "./gemini-keys";
import type {
  DictionarySourceResult,
  LookupContext,
  LookupSection,
} from "./lookup-types";

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com";
const GEMINI_API_VERSIONS = ["v1beta", "v1"] as const;
const DEFAULT_GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
] as const;

type WikipediaSearchResponse = {
  query?: {
    search?: Array<{
      snippet?: string;
      title?: string;
    }>;
  };
};

type WikipediaSummaryResponse = {
  content_urls?: {
    desktop?: {
      page?: string;
    };
  };
  description?: string;
  extract?: string;
  title?: string;
};

type WikipediaExtractResponse = {
  query?: {
    pages?: Record<
      string,
      {
        extract?: string;
        title?: string;
      }
    >;
  };
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

type WikipediaLanguage = "pt" | "es" | "en";

type WikipediaSummaryMatch = {
  extract: string;
  language: WikipediaLanguage;
  summary: WikipediaSummaryResponse;
};

const WIKIPEDIA_FALLBACK_LANGUAGES: WikipediaLanguage[] = ["pt", "es", "en"];

const HISTORICAL_TITLE_ALIASES: Record<string, string[]> = {
  alexandro: ["Alexandre, o Grande", "Alexandre"],
};

function getGeminiModels() {
  return Array.from(
    new Set(
      [process.env.AI_MODEL, process.env.GEMINI_MODEL, ...DEFAULT_GEMINI_MODELS].filter(
        (model): model is string => Boolean(model?.trim()),
      ),
    ),
  );
}

function wikipediaBaseUrl(language: WikipediaLanguage) {
  return `https://${language}.wikipedia.org`;
}

function getWikipediaFallbackLanguages(context?: LookupContext): WikipediaLanguage[] {
  if (/\b(?:en|eng|english|ingles|inglesa|ingl[êe]s)\b/iu.test(context?.documentLanguage ?? "")) {
    return ["en", "pt", "es"];
  }

  return WIKIPEDIA_FALLBACK_LANGUAGES;
}

function buildSection(text: string): LookupSection {
  return {
    html: htmlFromMarkdown(text),
    label: "Panorama",
    text,
  };
}

function buildResult(
  requestedWord: string,
  status: DictionarySourceResult["status"],
  note: string | null,
  sections: LookupSection[],
  sourceUrl: string | null,
): DictionarySourceResult {
  return {
    canonicalWord: requestedWord,
    label: "Wikipedia",
    note,
    sections,
    sourceId: "wikipedia",
    sourceUrl,
    status,
  };
}

function cleanWikipediaParagraph(value: string) {
  return normalizeInlineText(value)
    .replace(/\(\s+/gu, "(")
    .replace(/\s+\)/gu, ")")
    .replace(/\s+([,.;:!?])/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeWikipediaKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function stripLeadingRepeatedTitle(extract: string, title: string) {
  const normalizedExtract = extract.trim();
  const normalizedTitle = title.trim();

  if (!normalizedExtract || !normalizedTitle) {
    return normalizedExtract;
  }

  const escapedTitle = normalizedTitle.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return normalizedExtract.replace(
    new RegExp(`^${escapedTitle}(?=\\s|[(:,-])`, "iu"),
    "",
  ).trimStart();
}

function trimWikipediaExtract(value: string) {
  const paragraphs = value
    .replace(/\r/g, "")
    .split(/\n\s*\n/gu)
    .map(cleanWikipediaParagraph)
    .filter(Boolean);

  const normalized = paragraphs.join("\n\n");

  if (!normalized) {
    return "";
  }

  const paragraphSelection: string[] = [];
  let paragraphLength = 0;

  for (const paragraph of paragraphs.slice(0, 5)) {
    const nextLength = paragraphLength + paragraph.length + (paragraphSelection.length ? 2 : 0);

    if (nextLength > 2200 && paragraphSelection.length > 0) {
      break;
    }

    paragraphSelection.push(paragraph);
    paragraphLength = nextLength;

    if (paragraphLength >= 1500) {
      break;
    }
  }

  if (paragraphSelection.length > 0) {
    return paragraphSelection.join("\n\n");
  }

  const sentences = cleanWikipediaParagraph(normalized).match(/[^.!?]+[.!?]+|[^.!?]+$/gu) ?? [
    cleanWikipediaParagraph(normalized),
  ];
  let assembled = "";

  for (const sentence of sentences.slice(0, 10)) {
    const candidate = normalizeInlineText(`${assembled} ${sentence}`);

    if (candidate.length > 2200 && assembled) {
      break;
    }

    assembled = candidate;
  }

  return assembled || cleanWikipediaParagraph(normalized).slice(0, 2200).trim();
}

function buildWikipediaSearchQueries(
  requestedWord: string,
  context?: LookupContext,
) {
  const queries = [
    requestedWord,
    [requestedWord, context?.documentAuthor].filter(Boolean).join(" "),
    [requestedWord, context?.documentTitle].filter(Boolean).join(" "),
  ]
    .map((query) => normalizeInlineText(query))
    .filter(Boolean);

  return Array.from(new Set(queries));
}

function shouldKeepWikipediaOriginal(
  language: WikipediaLanguage,
  context?: LookupContext,
) {
  if (language === "pt") {
    return true;
  }

  return /\b(?:en|eng|english|ingles|inglesa|ingl[Ãªe]s)\b/iu.test(
    context?.documentLanguage ?? "",
  );
}

async function translateWikipediaExtract(
  text: string,
  title: string,
  language: WikipediaLanguage,
) {
  if (language === "pt") {
    return text;
  }

  const apiKeys = getGeminiApiKeys();

  if (apiKeys.length === 0) {
    return text;
  }

  const body = JSON.stringify({
    contents: [
      {
        parts: [
          {
            text: [
              "Traduza o trecho enciclopédico a seguir para português do Brasil.",
              "Mantenha nomes próprios, datas, topônimos e títulos.",
              "Não acrescente fatos, comentários nem introduções.",
              `Idioma de origem: ${language}.`,
              `Título do verbete: ${title}.`,
              "",
              text,
            ].join("\n"),
          },
        ],
        role: "user",
      },
    ],
    generationConfig: {
      maxOutputTokens: 520,
      temperature: 0.05,
      topP: 0.5,
    },
  });

  for (const model of getGeminiModels()) {
    for (const version of GEMINI_API_VERSIONS) {
      for (const apiKey of apiKeys) {
        const url = new URL(
          `${GEMINI_ENDPOINT}/${version}/models/${encodeURIComponent(
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
            signal: AbortSignal.timeout(16000),
          });

          if (!response.ok) {
            continue;
          }

          const payload = (await response.json()) as GeminiResponse;
          const translated = normalizeInlineText(
            payload.candidates?.[0]?.content?.parts
              ?.map((part) => part.text ?? "")
              .join("\n") ?? "",
          );

          if (translated) {
            return translated;
          }
        } catch {
          continue;
        }
      }
    }
  }

  return text;
}

async function searchWikipediaTitles(language: WikipediaLanguage, query: string) {
  const searchUrl = new URL(`${wikipediaBaseUrl(language)}/w/api.php`);
  searchUrl.searchParams.set("action", "query");
  searchUrl.searchParams.set("format", "json");
  searchUrl.searchParams.set("list", "search");
  searchUrl.searchParams.set("srlimit", "6");
  searchUrl.searchParams.set("srsearch", query);

  const searchResponse = await fetch(searchUrl, {
    cache: "no-store",
    headers: {
      "user-agent": "Mathesis/0.1 wikipedia lookup",
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!searchResponse.ok) {
    throw new Error(`Wikipedia search failed with status ${searchResponse.status}.`);
  }

  const searchPayload = (await searchResponse.json()) as WikipediaSearchResponse;
  return searchPayload.query?.search ?? [];
}

function scoreWikipediaSearchResult(
  requestedWord: string,
  context: LookupContext | undefined,
  result: { snippet?: string; title?: string },
) {
  const title = normalizeWikipediaKey(result.title ?? "");
  const snippet = normalizeWikipediaKey(result.snippet ?? "");
  const requested = normalizeWikipediaKey(requestedWord);
  const contextText = normalizeWikipediaKey(
    [context?.documentAuthor, context?.documentTitle].filter(Boolean).join(" "),
  );
  let score = 0;

  if (title === requested) {
    score += 120;
  }

  if (title.startsWith(`${requested} `) || title.includes(` ${requested}`)) {
    score += 80;
  }

  if (snippet.includes(requested)) {
    score += 24;
  }

  if (contextText) {
    for (const token of contextText.split(" ").filter((part) => part.length >= 4)) {
      if (title.includes(token)) {
        score += 8;
      }

      if (snippet.includes(token)) {
        score += 4;
      }
    }
  }

  return score;
}

async function fetchWikipediaSummaryByTitle(language: WikipediaLanguage, title: string) {
  const summaryUrl = new URL(
    `${wikipediaBaseUrl(language)}/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
  );
  const summaryResponse = await fetch(summaryUrl, {
    cache: "no-store",
    headers: {
      "user-agent": "Mathesis/0.1 wikipedia lookup",
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!summaryResponse.ok) {
    throw new Error(`Wikipedia summary failed with status ${summaryResponse.status}.`);
  }

  return (await summaryResponse.json()) as WikipediaSummaryResponse;
}

async function fetchWikipediaIntroExtract(language: WikipediaLanguage, title: string) {
  const extractUrl = new URL(`${wikipediaBaseUrl(language)}/w/api.php`);
  extractUrl.searchParams.set("action", "query");
  extractUrl.searchParams.set("format", "json");
  extractUrl.searchParams.set("prop", "extracts");
  extractUrl.searchParams.set("exintro", "1");
  extractUrl.searchParams.set("explaintext", "1");
  extractUrl.searchParams.set("redirects", "1");
  extractUrl.searchParams.set("titles", title);

  const extractResponse = await fetch(extractUrl, {
    cache: "no-store",
    headers: {
      "user-agent": "Mathesis/0.1 wikipedia lookup",
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!extractResponse.ok) {
    throw new Error(`Wikipedia extract failed with status ${extractResponse.status}.`);
  }

  const extractPayload = (await extractResponse.json()) as WikipediaExtractResponse;
  const page = Object.values(extractPayload.query?.pages ?? {}).find(
    (entry) => entry?.title?.trim(),
  );

  return page?.extract ?? "";
}

async function fetchWikipediaSummary(
  requestedWord: string,
  context?: LookupContext,
) {
  const normalizedWord = normalizeWikipediaKey(requestedWord);
  const directTitleCandidates = Array.from(
    new Set([
      requestedWord,
      ...(HISTORICAL_TITLE_ALIASES[normalizedWord] ?? []),
    ]),
  );

  for (const language of getWikipediaFallbackLanguages(context)) {
    for (const titleCandidate of directTitleCandidates) {
      try {
        const summary = await fetchWikipediaSummaryByTitle(language, titleCandidate);
        const introExtract = summary?.title
          ? await fetchWikipediaIntroExtract(language, summary.title)
          : "";
        const bestRawExtract =
          introExtract.length > (summary?.extract?.length ?? 0) + 40 ||
          (summary?.extract?.length ?? 0) < 220
            ? introExtract
            : (summary?.extract ?? "");
        const extract = trimWikipediaExtract(bestRawExtract);

        if (summary?.title?.trim() && extract) {
          return {
            extract,
            language,
            summary,
          } satisfies WikipediaSummaryMatch;
        }
      } catch {
        // Try the next title candidate.
      }
    }

    const searchResults = (
      await Promise.all(
        buildWikipediaSearchQueries(requestedWord, context).map((query) =>
          searchWikipediaTitles(language, query),
        ),
      )
    ).flat();

    const bestTitle = searchResults
      .filter((result) => result.title?.trim())
      .sort(
        (left, right) =>
          scoreWikipediaSearchResult(requestedWord, context, right) -
          scoreWikipediaSearchResult(requestedWord, context, left),
      )[0]?.title;

    if (!bestTitle) {
      continue;
    }

    try {
      const summary = await fetchWikipediaSummaryByTitle(language, bestTitle);
      const introExtract = summary?.title
        ? await fetchWikipediaIntroExtract(language, summary.title)
        : "";
      const bestRawExtract =
        introExtract.length > (summary?.extract?.length ?? 0) + 40 ||
        (summary?.extract?.length ?? 0) < 220
          ? introExtract
          : (summary?.extract ?? "");
      const extract = trimWikipediaExtract(bestRawExtract);

      if (summary?.title?.trim() && extract) {
        return {
          extract,
          language,
          summary,
        } satisfies WikipediaSummaryMatch;
      }
    } catch {
      continue;
    }
  }

  return null;
}

export async function lookupWikipedia(
  word: string,
  context?: LookupContext,
): Promise<DictionarySourceResult> {
  const requestedWord = normalizeInlineText(word.normalize("NFC"));

  try {
    const match = await fetchWikipediaSummary(requestedWord, context);

    if (!match?.summary?.title || !match.extract) {
      return buildResult(
        requestedWord,
        "not_found",
        `Não encontrei um resumo enciclopédico aproveitável para "${requestedWord}" na Wikipedia.`,
        [],
        null,
      );
    }

    const localizedExtract = shouldKeepWikipediaOriginal(match.language, context)
      ? match.extract
      : await translateWikipediaExtract(
          match.extract,
          match.summary.title,
          match.language,
        );
    const cleanedExtract = stripLeadingRepeatedTitle(
      localizedExtract,
      match.summary.title,
    );
    const extractParagraphs = cleanedExtract
      .split(/\n\s*\n/gu)
      .map((paragraph) => cleanWikipediaParagraph(paragraph))
      .filter(Boolean)
      .slice(0, 4);
    const headingLine = [
      match.language === "pt" && match.summary.description
        ? `**${match.summary.title}:** *${match.summary.description}*. ${extractParagraphs[0] ?? ""}`
        : `**${match.summary.title}:** ${extractParagraphs[0] ?? ""}`,
      ...extractParagraphs.slice(1),
    ]
      .filter(Boolean)
      .join("\n\n");

    return buildResult(
      requestedWord,
      "found",
      "Panorama enciclopédico da Wikipedia para apoiar a leitura.",
      [buildSection(headingLine)],
      match.summary.content_urls?.desktop?.page ?? null,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.warn(`WIKIPEDIA_LOOKUP_FAIL detail=${message.slice(0, 160)}`);

    return buildResult(
      requestedWord,
      "unavailable",
      "A consulta à Wikipedia não respondeu bem nesta tentativa.",
      [],
      null,
    );
  }
}
