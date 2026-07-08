import { readFile } from "node:fs/promises";
import path from "node:path";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";

export type PortugueseCorpusGenre = "poesia" | "prosa";

export type PortugueseCorpusDocument = {
  author: string;
  chunkCount: number;
  declaredGenre: "misto" | PortugueseCorpusGenre;
  id: number;
  indexedPages: number;
  pageCount: number;
  sourcePdfName: string;
  startPage: number;
  title: string;
};

export type PortugueseCorpusChunk = [
  documentId: number,
  genre: PortugueseCorpusGenre,
  page: number,
  text: string,
  workTitle?: string,
];

export type PortugueseCorpusTermGroups = Partial<
  Record<PortugueseCorpusGenre, number[]>
>;

export type PortugueseCorpusPayload = {
  chunks: PortugueseCorpusChunk[];
  documents: PortugueseCorpusDocument[];
  metadata: {
    chunkCount: number;
    cappedTermGroups?: number;
    documentCount: number;
    generatedAt: string;
    genreCounts: Partial<Record<PortugueseCorpusGenre, number>>;
    completeTermIndex?: boolean;
    maxResultsPerTermGenre?: number;
    maxTermRefsPerGenre?: number;
    sourceDir: string;
    termCount: number;
  };
  terms: Record<string, PortugueseCorpusTermGroups>;
};

declare global {
  var __portugueseCorpusDataPromise:
    | Promise<PortugueseCorpusPayload | null>
    | undefined;
}

const gunzipAsync = promisify(gunzip);

async function readCorpusPayload() {
  const corpusDir = path.join(process.cwd(), "data", "portuguese-corpus");

  try {
    const compressed = await readFile(path.join(corpusDir, "corpus.json.gz"));
    const raw = await gunzipAsync(compressed);
    return JSON.parse(raw.toString("utf-8")) as PortugueseCorpusPayload;
  } catch {
    const raw = await readFile(path.join(corpusDir, "corpus.json"), "utf-8");
    return JSON.parse(raw) as PortugueseCorpusPayload;
  }
}

export async function loadPortugueseCorpusData() {
  if (!globalThis.__portugueseCorpusDataPromise) {
    globalThis.__portugueseCorpusDataPromise = readCorpusPayload().catch(() => null);
  }

  return globalThis.__portugueseCorpusDataPromise;
}
