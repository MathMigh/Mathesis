import { escapeHtml, normalizeInlineText } from "./dictionary-utils";
import type { DictionarySourceResult, LookupSection } from "./lookup-types";

type DatamuseWord = {
  word?: string;
};

const DATAMUSE_ENDPOINT = "https://api.datamuse.com/words";

function buildResult(
  requestedWord: string,
  status: DictionarySourceResult["status"],
  note: string | null,
  sections: LookupSection[] = [],
): DictionarySourceResult {
  return {
    canonicalWord: requestedWord,
    label: "Analogia",
    note,
    sections,
    sourceId: "english_analogico",
    sourceUrl: `https://www.onelook.com/thesaurus/?s=${encodeURIComponent(requestedWord)}`,
    status,
  };
}

function renderPills(label: string, values: string[]): LookupSection | null {
  if (!values.length) {
    return null;
  }

  return {
    html: `
      <article class="analogCategoryCard">
        <h4 class="analogCategoryTitle">${escapeHtml(label)}</h4>
        <div class="analogPillList">
          ${values
            .map(
              (value) =>
                `<button type="button" class="lookupPill lookupPillDigital" data-lookup-word="${escapeHtml(
                  value,
                )}">${escapeHtml(value)}</button>`,
            )
            .join("")}
        </div>
      </article>
    `,
    label,
    text: values.join(", "),
  };
}

async function fetchWords(params: Record<string, string>) {
  const url = new URL(DATAMUSE_ENDPOINT);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    cache: "force-cache",
    headers: { accept: "application/json" },
    next: { revalidate: 60 * 60 * 24 * 30 },
    signal: AbortSignal.timeout(12000),
  });

  if (!response.ok) {
    return [];
  }

  const values = (await response.json()) as DatamuseWord[];
  return values
    .map((item) => normalizeInlineText(item.word ?? ""))
    .filter((value) => value && /^[a-z][a-z' -]{1,48}$/iu.test(value));
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.toLocaleLowerCase("en-US")))];
}

export async function lookupEnglishAnalogico(word: string): Promise<DictionarySourceResult> {
  const requestedWord = normalizeInlineText(word.normalize("NFC")).toLocaleLowerCase("en-US");

  if (!requestedWord) {
    return buildResult(
      requestedWord,
      "not_found",
      "Digite uma palavra inglesa para consultar a analogia.",
    );
  }

  try {
    const [semantic, synonyms, triggers, adjectives] = await Promise.all([
      fetchWords({ ml: requestedWord, max: "36" }),
      fetchWords({ rel_syn: requestedWord, max: "24" }),
      fetchWords({ rel_trg: requestedWord, max: "24" }),
      fetchWords({ rel_jjb: requestedWord, max: "18" }),
    ]);

    const sections = [
      renderPills("Campo semântico", unique(semantic).slice(0, 36)),
      renderPills("Sinônimos próximos", unique(synonyms).slice(0, 24)),
      renderPills("Associações frequentes", unique(triggers).slice(0, 24)),
      renderPills("Adjetivos ligados", unique(adjectives).slice(0, 18)),
    ].filter((section): section is LookupSection => Boolean(section));

    if (!sections.length) {
      return buildResult(
        requestedWord,
        "not_found",
        `Não encontrei relações analógicas fortes para "${requestedWord}".`,
      );
    }

    return buildResult(
      requestedWord,
      "found",
      "Rede analógica em inglês montada a partir de relações semânticas abertas, no espírito de um thesaurus.",
      sections,
    );
  } catch {
    return buildResult(
      requestedWord,
      "unavailable",
      "Não consegui consultar a rede analógica inglesa agora.",
    );
  }
}
