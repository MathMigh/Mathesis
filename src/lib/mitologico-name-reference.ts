import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeInlineText } from "./dictionary-utils";

declare global {
  var __mitologicoPortugueseNameReferencePromise: Promise<string[]> | undefined;
  var __mitologicoAllowedPortugueseNamePromise: Promise<string[]> | undefined;
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR");
}

async function loadPortugueseMitologicoNameReference() {
  if (!globalThis.__mitologicoPortugueseNameReferencePromise) {
    const allowedPath = path.join(
      process.cwd(),
      "data",
      "mitologico",
      "allowed-pt-names.json",
    );
    const referencePath = path.join(
      process.cwd(),
      "data",
      "mitologico",
      "reference-pt-names.json",
    );
    globalThis.__mitologicoPortugueseNameReferencePromise = Promise.all([
      readFile(allowedPath, "utf-8")
        .then((raw) => JSON.parse(raw) as string[])
        .catch(() => []),
      readFile(referencePath, "utf-8")
        .then((raw) => JSON.parse(raw) as string[])
        .catch(() => []),
    ]).then(([allowed, reference]) =>
      Array.from(
        new Set(
          [...allowed, ...reference]
            .map((value) => normalizeInlineText(value.normalize("NFC")))
            .filter(Boolean),
        ),
      ),
    );
  }

  return globalThis.__mitologicoPortugueseNameReferencePromise;
}

async function loadAllowedPortugueseMitologicoNames() {
  if (!globalThis.__mitologicoAllowedPortugueseNamePromise) {
    const filePath = path.join(
      process.cwd(),
      "data",
      "mitologico",
      "allowed-pt-names.json",
    );
    globalThis.__mitologicoAllowedPortugueseNamePromise = readFile(
      filePath,
      "utf-8",
    )
      .then((raw) => JSON.parse(raw) as string[])
      .then((values) =>
        Array.from(
          new Set(
            values
              .map((value) => normalizeInlineText(value.normalize("NFC")))
              .filter(Boolean),
          ),
        ),
      )
      .catch(() => []);
  }

  return globalThis.__mitologicoAllowedPortugueseNamePromise;
}

function stripTrailingQualifier(value: string) {
  return normalizeInlineText(value).replace(/\s*\([^)]*\)\s*$/u, "").trim();
}

function levenshteinDistance(a: string, b: string) {
  if (a === b) {
    return 0;
  }

  if (!a.length) {
    return b.length;
  }

  if (!b.length) {
    return a.length;
  }

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array<number>(b.length + 1);

  for (let i = 0; i < a.length; i += 1) {
    current[0] = i + 1;

    for (let j = 0; j < b.length; j += 1) {
      const substitutionCost = a[i] === b[j] ? 0 : 1;
      current[j + 1] = Math.min(
        current[j] + 1,
        previous[j + 1] + 1,
        previous[j] + substitutionCost,
      );
    }

    for (let j = 0; j < previous.length; j += 1) {
      previous[j] = current[j] ?? 0;
    }
  }

  return previous[b.length] ?? 0;
}

function scoreNameCandidate(query: string, candidate: string) {
  const left = normalizeSearchText(query).replace(/[^a-z0-9]+/g, "");
  const right = normalizeSearchText(candidate).replace(/[^a-z0-9]+/g, "");

  if (!left || !right) {
    return Number.NEGATIVE_INFINITY;
  }

  if (left === right) {
    return 220;
  }

  const distance = levenshteinDistance(left, right);
  let score = 120 - distance * 12 - Math.abs(left.length - right.length) * 2;

  if (left[0] === right[0]) {
    score += 10;
  }

  if (left.slice(0, 3) === right.slice(0, 3)) {
    score += 16;
  }

  if (left.includes(right) || right.includes(left)) {
    score += 22;
  }

  return score;
}

export async function findPortugueseMitologicoNameHints(
  values: string[],
  limit = 8,
) {
  const queries = Array.from(
    new Set(
      values
        .map((value) => normalizeInlineText(value.normalize("NFC")))
        .filter(Boolean),
    ),
  );

  if (queries.length === 0) {
    return [];
  }

  const names = await loadPortugueseMitologicoNameReference();

  if (names.length === 0) {
    return [];
  }

  const ranked = names
    .map((candidate) => ({
      candidate,
      score: Math.max(...queries.map((query) => scoreNameCandidate(query, candidate))),
    }))
    .filter((item) => item.score >= 64)
    .sort((left, right) => right.score - left.score || left.candidate.localeCompare(right.candidate, "pt-BR"))
    .slice(0, limit)
    .map((item) => item.candidate);

  return Array.from(new Set(ranked));
}

export async function isAllowedMitologicoLookup(values: string[]) {
  const queries = Array.from(
    new Set(
      values
        .map((value) => normalizeInlineText(value.normalize("NFC")))
        .filter(Boolean),
        ),
  );

  if (queries.length === 0) {
    return false;
  }

  const allowedNames = await loadAllowedPortugueseMitologicoNames();

  if (allowedNames.length === 0) {
    return true;
  }

  const normalizedAllowed = new Set<string>();

  for (const name of allowedNames) {
    const direct = normalizeSearchText(name).replace(/[^a-z0-9]+/g, "");
    const stripped = normalizeSearchText(stripTrailingQualifier(name)).replace(
      /[^a-z0-9]+/g,
      "",
    );

    if (direct) {
      normalizedAllowed.add(direct);
    }

    if (stripped) {
      normalizedAllowed.add(stripped);
    }
  }

  return queries.some((query) => {
    const normalized = normalizeSearchText(query).replace(/[^a-z0-9]+/g, "");
    return normalized ? normalizedAllowed.has(normalized) : false;
  });
}
