import { readFile } from "node:fs/promises";
import path from "node:path";

export type AnalogicoConceptPage = {
  page: number;
  text: string;
};

export type AnalogicoIndexEntry = {
  refs: string[];
  term: string;
};

export type AnalogicoIndex = Record<string, AnalogicoIndexEntry[]>;

type AnalogicoData = {
  conceptPages: AnalogicoConceptPage[];
  index: AnalogicoIndex;
};

declare global {
  var __analogicoDataPromise: Promise<AnalogicoData> | undefined;
}

async function readJsonFile<T>(filename: string) {
  const filePath = path.join(process.cwd(), "data", "analogico", filename);
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

export function loadAnalogicoData() {
  if (!globalThis.__analogicoDataPromise) {
    globalThis.__analogicoDataPromise = Promise.all([
      readJsonFile<AnalogicoConceptPage[]>("concept-pages.json"),
      readJsonFile<AnalogicoIndex>("index.json"),
    ]).then(([conceptPages, index]) => ({
      conceptPages,
      index,
    }));
  }

  return globalThis.__analogicoDataPromise;
}
