import { normalizeInlineText } from "./dictionary-utils";
import { inferPortugueseVerbLemmas } from "./portuguese-verb-lemmas";

function uniqueValues(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function pushPluralSingularCandidates(word: string, candidates: string[]) {
  if (!word.endsWith("s") || word.length <= 3) {
    return;
  }

  if (word.endsWith("ões") && word.length > 5) {
    candidates.push(`${word.slice(0, -3)}ão`);
  }

  if (word.endsWith("ães") && word.length > 4) {
    candidates.push(`${word.slice(0, -3)}ão`);
    candidates.push(`${word.slice(0, -1)}`);
  }

  if (word.endsWith("ãos") && word.length > 4) {
    candidates.push(word.slice(0, -1));
  }

  if (word.endsWith("éis") && word.length > 4) {
    candidates.push(`${word.slice(0, -3)}el`);
  }

  if (word.endsWith("óis") && word.length > 4) {
    candidates.push(`${word.slice(0, -3)}ol`);
  }

  if (word.endsWith("ais") && word.length > 4) {
    candidates.push(`${word.slice(0, -2)}l`);
  }

  if (word.endsWith("eis") && word.length > 4) {
    candidates.push(`${word.slice(0, -2)}l`);
  }

  if (word.endsWith("ois") && word.length > 4) {
    candidates.push(`${word.slice(0, -2)}l`);
  }

  if (word.endsWith("res") && word.length > 5) {
    candidates.push(word.slice(0, -2));
  }

  if (word.endsWith("zes") && word.length > 4) {
    candidates.push(word.slice(0, -2));
  }

  if (word.endsWith("ns") && word.length > 4) {
    candidates.push(`${word.slice(0, -2)}m`);
  }

  if (word.endsWith("es") && word.length > 4) {
    candidates.push(word.slice(0, -2));
  }

  candidates.push(word.slice(0, -1));
}

function pushFeminineMasculineCandidates(word: string, candidates: string[]) {
  if (word.endsWith("as") && word.length > 4) {
    candidates.push(`${word.slice(0, -2)}os`);
  }

  if (word.endsWith("a") && word.length > 3) {
    candidates.push(`${word.slice(0, -1)}o`);
  }

  if (word.endsWith("ora") && word.length > 5) {
    candidates.push(`${word.slice(0, -3)}or`);
  }

  if (word.endsWith("oras") && word.length > 6) {
    candidates.push(`${word.slice(0, -4)}ores`);
  }

  if (word.endsWith("eira") && word.length > 5) {
    candidates.push(`${word.slice(0, -4)}eiro`);
  }

  if (word.endsWith("eiras") && word.length > 6) {
    candidates.push(`${word.slice(0, -5)}eiros`);
  }

  if (word.endsWith("esa") && word.length > 4) {
    candidates.push(`${word.slice(0, -3)}ês`);
    candidates.push(`${word.slice(0, -3)}es`);
  }

  if (word.endsWith("esas") && word.length > 5) {
    candidates.push(`${word.slice(0, -4)}eses`);
  }

  if (word.endsWith("ã")) {
    candidates.push(`${word.slice(0, -1)}ão`);
  }

  if (word.endsWith("ãs")) {
    candidates.push(`${word.slice(0, -2)}ãos`);
  }
}

function pushContractionCandidates(word: string, candidates: string[]) {
  const directContractionMap: Record<string, string[]> = {
    daquela: ["aquele", "aquela"],
    daquelas: ["aquele", "aquelas", "aqueles"],
    daquele: ["aquele"],
    daqueles: ["aquele", "aqueles"],
    daquilo: ["aquilo"],
    naquela: ["aquele", "aquela"],
    naquelas: ["aquele", "aquelas", "aqueles"],
    naquele: ["aquele"],
    naqueles: ["aquele", "aqueles"],
    naquilo: ["aquilo"],
    "\u00e0quela": ["aquele", "aquela"],
    "\u00e0quelas": ["aquele", "aquelas", "aqueles"],
    "\u00e0quele": ["aquele"],
    "\u00e0queles": ["aquele", "aqueles"],
    "\u00e0quilo": ["aquilo"],
  };

  if (directContractionMap[word]) {
    candidates.push(...directContractionMap[word]);
  }
}

export function buildPortugueseLookupCandidates(word: string) {
  const requestedWord = normalizeInlineText(word.normalize("NFC")).toLocaleLowerCase(
    "pt-BR",
  );
  const candidates = [requestedWord];

  pushContractionCandidates(requestedWord, candidates);

  for (const lemma of inferPortugueseVerbLemmas(requestedWord)) {
    candidates.push(lemma);
  }

  pushPluralSingularCandidates(requestedWord, candidates);
  pushFeminineMasculineCandidates(requestedWord, candidates);

  for (const candidate of [...candidates]) {
    if (candidate === requestedWord) {
      continue;
    }

    pushPluralSingularCandidates(candidate, candidates);
    pushFeminineMasculineCandidates(candidate, candidates);
  }

  return uniqueValues(candidates);
}
