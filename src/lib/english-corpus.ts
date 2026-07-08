import { escapeHtml, normalizeInlineText } from "./dictionary-utils";
import type { DictionarySourceResult, LookupContext, LookupSection } from "./lookup-types";

const USER_AGENT = "Mathesis/1.0 English classical corpus";
const MAX_OCCURRENCES = 40;
const WORD_WINDOW = 42;

type EnglishWork = {
  author: string;
  title: string;
  url: string;
};

const ENGLISH_CANON: EnglishWork[] = [
  {
    author: "William Shakespeare",
    title: "The Complete Works",
    url: "https://www.gutenberg.org/cache/epub/100/pg100.txt",
  },
  {
    author: "John Milton",
    title: "Paradise Lost",
    url: "https://www.gutenberg.org/cache/epub/26/pg26.txt",
  },
  {
    author: "Geoffrey Chaucer",
    title: "The Canterbury Tales and Other Poems",
    url: "https://www.gutenberg.org/cache/epub/2383/pg2383.txt",
  },
  {
    author: "Jane Austen",
    title: "Pride and Prejudice",
    url: "https://www.gutenberg.org/cache/epub/1342/pg1342.txt",
  },
  {
    author: "Jane Austen",
    title: "Emma",
    url: "https://www.gutenberg.org/cache/epub/158/pg158.txt",
  },
  {
    author: "Charlotte Bronte",
    title: "Jane Eyre",
    url: "https://www.gutenberg.org/cache/epub/1260/pg1260.txt",
  },
  {
    author: "Emily Bronte",
    title: "Wuthering Heights",
    url: "https://www.gutenberg.org/cache/epub/768/pg768.txt",
  },
  {
    author: "Charles Dickens",
    title: "A Tale of Two Cities",
    url: "https://www.gutenberg.org/cache/epub/98/pg98.txt",
  },
  {
    author: "Charles Dickens",
    title: "Great Expectations",
    url: "https://www.gutenberg.org/cache/epub/1400/pg1400.txt",
  },
  {
    author: "Herman Melville",
    title: "Moby-Dick",
    url: "https://www.gutenberg.org/cache/epub/2701/pg2701.txt",
  },
  {
    author: "Mary Shelley",
    title: "Frankenstein",
    url: "https://www.gutenberg.org/cache/epub/84/pg84.txt",
  },
  {
    author: "William Blake",
    title: "Songs of Innocence and of Experience",
    url: "https://www.gutenberg.org/cache/epub/1934/pg1934.txt",
  },
  {
    author: "William Wordsworth",
    title: "Lyrical Ballads",
    url: "https://www.gutenberg.org/cache/epub/8905/pg8905.txt",
  },
  {
    author: "John Keats",
    title: "Poems",
    url: "https://www.gutenberg.org/cache/epub/23684/pg23684.txt",
  },
  {
    author: "George Eliot",
    title: "Middlemarch",
    url: "https://www.gutenberg.org/cache/epub/145/pg145.txt",
  },
  {
    author: "Jonathan Swift",
    title: "Gulliver's Travels",
    url: "https://www.gutenberg.org/cache/epub/829/pg829.txt",
  },
  {
    author: "Daniel Defoe",
    title: "Robinson Crusoe",
    url: "https://www.gutenberg.org/cache/epub/521/pg521.txt",
  },
  {
    author: "Thomas Hardy",
    title: "Tess of the d'Urbervilles",
    url: "https://www.gutenberg.org/cache/epub/110/pg110.txt",
  },
];

declare global {
  var __englishCorpusTextCache:
    | Map<string, Promise<{ text: string; work: EnglishWork } | null>>
    | undefined;
}

function buildResult(
  requestedWord: string,
  status: DictionarySourceResult["status"],
  note: string,
  sections: LookupSection[] = [],
): DictionarySourceResult {
  return {
    canonicalWord: requestedWord,
    label: "Corpus",
    note,
    sections,
    sourceId: "corpus",
    sourceUrl: "https://www.gutenberg.org/",
    status,
  };
}

function getCorpusCache() {
  if (!globalThis.__englishCorpusTextCache) {
    globalThis.__englishCorpusTextCache = new Map();
  }

  return globalThis.__englishCorpusTextCache;
}

async function fetchWork(work: EnglishWork) {
  const cache = getCorpusCache();
  const cached = cache.get(work.url);

  if (cached) {
    return cached;
  }

  const promise = fetch(work.url, {
    headers: { "user-agent": USER_AGENT },
    next: { revalidate: 60 * 60 * 24 * 30 },
    signal: AbortSignal.timeout(9000),
  })
    .then(async (response) => {
      if (!response.ok) {
        return null;
      }

      const raw = await response.text();
      return {
        text: raw
          .replace(/\r/g, "")
          .replace(/\*\*\* START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[\s\S]*?\*\*\*/iu, "")
          .replace(/\*\*\* END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[\s\S]*$/iu, "")
          .replace(/[ \t]+/gu, " ")
          .trim(),
        work,
      };
    })
    .catch(() => null);

  cache.set(work.url, promise);
  return promise;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitWords(text: string) {
  return text.match(/[\p{L}\p{M}'-]+|[^\s\p{L}\p{M}'-]+/gu) ?? [];
}

function buildSnippet(tokens: string[], index: number) {
  const start = Math.max(0, index - WORD_WINDOW);
  const end = Math.min(tokens.length, index + WORD_WINDOW + 1);
  const raw = tokens.slice(start, end).join(" ");
  return normalizeInlineText(raw)
    .replace(/\s+([,.;:!?])/gu, "$1")
    .replace(/([([{])\s+/gu, "$1")
    .replace(/\s+([)\]}])/gu, "$1");
}

function findOccurrences(requestedWord: string, text: string, work: EnglishWork) {
  const tokens = splitWords(text);
  const matcher = new RegExp(`^${escapeRegex(requestedWord)}$`, "iu");
  const sections: LookupSection[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";

    if (!matcher.test(token)) {
      continue;
    }

    const snippet = buildSnippet(tokens, index);

    if (!snippet) {
      continue;
    }

    const html = [
      `<article class="lookupEntry corpusHitCard">`,
      `<p class="lookupEntryMeta">${escapeHtml(work.author)}</p>`,
      `<p class="lookupEntryTitle">${escapeHtml(work.title)}</p>`,
      `<blockquote class="lookupQuote">${escapeHtml(snippet).replace(
        new RegExp(`\\b(${escapeRegex(requestedWord)})\\b`, "giu"),
        '<mark>$1</mark>',
      )}</blockquote>`,
      `</article>`,
    ].join("");

    sections.push({
      html,
      label: String(sections.length + 1),
      text: `${work.author}\n${work.title}\n${snippet}`,
    });

    if (sections.length >= 4) {
      break;
    }
  }

  return sections;
}

export async function lookupEnglishCorpus(
  word: string,
  _context?: LookupContext,
): Promise<DictionarySourceResult> {
  const requestedWord = normalizeInlineText(word.normalize("NFC")).toLocaleLowerCase("en-US");

  if (!requestedWord) {
    return buildResult(
      requestedWord,
      "not_found",
      "Digite uma palavra inglesa para consultar o corpus.",
    );
  }

  const settled = await Promise.allSettled(ENGLISH_CANON.map(fetchWork));
  const sections: LookupSection[] = [];
  const seen = new Set<string>();

  for (const entry of settled) {
    if (entry.status !== "fulfilled" || !entry.value) {
      continue;
    }

    for (const section of findOccurrences(
      requestedWord,
      entry.value.text,
      entry.value.work,
    )) {
      if (section.text && seen.has(section.text)) {
        continue;
      }

      seen.add(section.text ?? "");
      sections.push({
        ...section,
        label: String(sections.length + 1),
      });

      if (sections.length >= MAX_OCCURRENCES) {
        break;
      }
    }

    if (sections.length >= MAX_OCCURRENCES) {
      break;
    }
  }

  if (sections.length === 0) {
    return buildResult(
      requestedWord,
      "not_found",
      `Nao encontrei ocorrencias aproveitaveis para "${requestedWord}" no corpus ingles.`,
    );
  }

  return buildResult(
    requestedWord,
    "found",
    "Corpus de literatura classica inglesa em dominio publico.",
    sections,
  );
}
