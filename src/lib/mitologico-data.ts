import { readFile } from "node:fs/promises";
import path from "node:path";

export type MitologicoTradition = "grega" | "romana" | null;

export type MitologicoEntry = {
  aliases: string[];
  canonicalTerm: string;
  displayHeading: string;
  endPage: number;
  id: string;
  originalLabel: string | null;
  startPage: number;
  text: string;
  tradition: MitologicoTradition;
  traditionCode: "G" | "L" | null;
};

export type MitologicoIndex = Record<string, string[]>;

type MitologicoData = {
  entries: MitologicoEntry[];
  entriesById: Map<string, MitologicoEntry>;
  index: MitologicoIndex;
  metadata: {
    entryCount: number;
    endPage: number;
    pageCount: number;
    sourcePdfName: string;
    startPage: number;
    termCount: number;
  };
};

declare global {
  var __mitologicoDataPromise: Promise<MitologicoData> | undefined;
}

async function readJsonFile<T>(filename: string) {
  const filePath = path.join(process.cwd(), "data", "mitologico", filename);
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

export function loadMitologicoData() {
  if (!globalThis.__mitologicoDataPromise) {
    globalThis.__mitologicoDataPromise = Promise.all([
      readJsonFile<MitologicoEntry[]>("entries.json"),
      readJsonFile<MitologicoIndex>("index.json"),
      readJsonFile<MitologicoData["metadata"]>("metadata.json"),
    ]).then(([entries, index, metadata]) => ({
      entries,
      entriesById: new Map(entries.map((entry) => [entry.id, entry])),
      index,
      metadata,
    }));
  }

  return globalThis.__mitologicoDataPromise;
}
