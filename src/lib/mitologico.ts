import {
  escapeHtml,
  htmlFromMarkdown,
  normalizeInlineText,
} from "./dictionary-utils";
import { detectLookupLanguage } from "./lookup-language";
import { generateMitologicoEntry } from "./mitologico-ai";
import { lookupEnglishMitologico } from "./mitologico-en";
import { isAllowedMitologicoLookup } from "./mitologico-name-reference";
import { buildPortugueseLookupCandidates } from "./portuguese-word-candidates";
import type { DictionarySourceResult, LookupContext, LookupSection } from "./lookup-types";

const LOOKUPABLE_WORD_PATTERN = /^[\p{L}\p{M}'-]+$/u;
const MITOLOGICO_NAME_EQUIVALENTS: Array<[string, string]> = [
  ["Phoebus", "Febo"],
  ["Phoebo", "Febo"],
  ["Apollo", "Apolo"],
  ["Aphrodite", "Afrodite"],
  ["Ares", "Ares"],
  ["Mars", "Marte"],
  ["Minerva", "Minerva"],
  ["Neptune", "Netuno"],
  ["Poseidon", "Posídon"],
  ["Poseidon", "Posidon"],
  ["Ulysses", "Ulisses"],
  ["Odysseus", "Ulisses"],
  ["Heracles", "Héracles"],
  ["Heracles", "Heracles"],
  ["Hercules", "Hércules"],
  ["Hercules", "Hercules"],
];

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR");
}

function normalizeLookupKey(value: string) {
  return normalizeSearchText(value).replace(/[^a-z0-9]+/g, "");
}

function uniqueValues(values: string[]) {
  return [...new Set(values.map((value) => normalizeInlineText(value)).filter(Boolean))];
}

function buildMitologicoNameVariants(value: string) {
  const cleaned = normalizeInlineText(value.normalize("NFC"));

  if (!cleaned) {
    return [];
  }

  const variants = new Set<string>([cleaned]);
  const normalized = normalizeSearchText(cleaned);

  for (const [foreignForm, portugueseForm] of MITOLOGICO_NAME_EQUIVALENTS) {
    const foreignKey = normalizeSearchText(foreignForm);
    const portugueseKey = normalizeSearchText(portugueseForm);

    if (normalized === foreignKey) {
      variants.add(portugueseForm);
    }

    if (normalized === portugueseKey) {
      variants.add(foreignForm);
    }
  }

  if (/eu$/iu.test(cleaned)) {
    variants.add(cleaned.replace(/eu$/iu, "eo"));
  }

  if (/eo$/iu.test(cleaned)) {
    variants.add(cleaned.replace(/eo$/iu, "eu"));
  }

  return [...variants];
}

function buildLookupCandidates(word: string) {
  const requestedWord = normalizeInlineText(word.normalize("NFC"));
  const lexicalCandidates = uniqueValues([
    requestedWord,
    ...buildPortugueseLookupCandidates(requestedWord),
  ]);

  return uniqueValues(
    lexicalCandidates.flatMap((candidate) => [
      candidate,
      ...buildMitologicoNameVariants(candidate),
    ]),
  );
}

function isUsefulAlias(alias: string, canonicalTerm: string) {
  const cleaned = normalizeInlineText(alias);

  if (!cleaned) {
    return false;
  }

  if (normalizeLookupKey(cleaned) === normalizeLookupKey(canonicalTerm)) {
    return false;
  }

  if (cleaned.length < 2 || cleaned.length > 64) {
    return false;
  }

  if (/[,:;<>~]/u.test(cleaned)) {
    return false;
  }

  return true;
}

function buildAliasButton(label: string) {
  const className = LOOKUPABLE_WORD_PATTERN.test(label)
    ? "lookupPill lookupPillAnalogico"
    : "lookupPill lookupPillAnalogico lookupPillStatic";

  if (!LOOKUPABLE_WORD_PATTERN.test(label)) {
    return `<span class="${className}">${escapeHtml(label)}</span>`;
  }

  return `<button type="button" class="${className}" data-lookup-word="${escapeHtml(
    label,
  )}">${escapeHtml(label)}</button>`;
}

function buildVerbeteSection(text: string): LookupSection {
  return {
    html: htmlFromMarkdown(text),
    label: "Verbete",
    text,
  };
}

function buildNamesSection(
  canonicalTerm: string,
  aliases: string[],
  originalLabel: string | null,
): LookupSection | null {
  const values = uniqueValues([
    ...(originalLabel ? [originalLabel] : []),
    ...aliases,
  ]).filter((alias) => isUsefulAlias(alias, canonicalTerm));

  if (values.length === 0) {
    return null;
  }

  return {
    html: `
      <article class="analogCategoryCard">
        <h4 class="analogCategoryTitle">Nomes e variantes</h4>
        <div class="analogPillList">
          ${values.map(buildAliasButton).join("")}
        </div>
      </article>
    `,
    label: "Nomes",
    text: values.join(" · "),
  };
}

function buildResult(
  requestedWord: string,
  status: DictionarySourceResult["status"],
  note: string | null,
  canonicalWord = requestedWord,
  sections: LookupSection[] = [],
): DictionarySourceResult {
  return {
    canonicalWord,
    label: "Mitologia",
    note,
    sections,
    sourceId: "mitologico",
    sourceUrl: null,
    status,
  };
}

export async function lookupMitologico(
  word: string,
  context?: LookupContext,
): Promise<DictionarySourceResult> {
  const requestedWord = normalizeInlineText(word.normalize("NFC"));

  try {
    if (detectLookupLanguage(requestedWord, context) === "english") {
      return lookupEnglishMitologico(requestedWord);
    }

    const candidates = buildLookupCandidates(requestedWord);
    const isAllowed = await isAllowedMitologicoLookup(candidates);

    if (!isAllowed) {
      return buildResult(
        requestedWord,
        "not_found",
        `Não encontrei um verbete direto para "${requestedWord}" na base mitológica.`,
      );
    }

    const entry = await generateMitologicoEntry(requestedWord);

    if (!entry) {
      return buildResult(
        requestedWord,
        "unavailable",
        "Não consegui montar uma nota mitológica confiável nesta tentativa.",
      );
    }

    const canonicalWord =
      normalizeLookupKey(entry.canonicalTerm) === normalizeLookupKey(requestedWord)
        ? requestedWord
        : entry.canonicalTerm;

    return buildResult(
      requestedWord,
      "found",
      "Nota mitológica gerada por IA para apoiar a leitura.",
      canonicalWord,
      [
        buildVerbeteSection(entry.text),
        buildNamesSection(canonicalWord, entry.aliases, entry.originalLabel),
      ].filter((section): section is LookupSection => Boolean(section)),
    );
  } catch {
    return buildResult(
      requestedWord,
      "unavailable",
      "Não consegui consultar a base mitológica nesta tentativa.",
    );
  }
}
