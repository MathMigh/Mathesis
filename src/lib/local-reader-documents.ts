type InternalHrefResolution = {
  chapterId: string;
  selector: string;
};

export type ReaderTocEntry = InternalHrefResolution & {
  id: string;
  label: string;
  level: number;
};

type ReaderDocumentMeta = {
  author?: string;
  chapterCount?: number;
  coverSrc?: string;
  description?: string;
  language?: string;
  note?: string;
  published?: string;
  publisher?: string;
  title?: string;
  tocCount?: number;
};

export type ReaderDocumentFormat =
  | "azw"
  | "azw3"
  | "docx"
  | "epub"
  | "fb2"
  | "html"
  | "markdown"
  | "mobi"
  | "pdf"
  | "prc"
  | "txt";

export type ReaderDocument =
  | {
      file: File | string;
      format: "pdf";
      formatLabel: string;
      kind: "pdf";
      label: string;
      meta: ReaderDocumentMeta;
    }
  | {
      format: Exclude<ReaderDocumentFormat, "pdf">;
      formatLabel: string;
      html: string;
      kind: "html";
      label: string;
      meta: ReaderDocumentMeta;
      resolveInternalHref?: (href: string) => InternalHrefResolution | null;
      tableOfContents?: ReaderTocEntry[];
    };

export type ReaderDocumentLoadResult = {
  dispose?: () => void;
  document: ReaderDocument;
};

type ChapterContent = {
  html: string;
  id: string;
  title: string;
};

type TocItem = {
  children?: TocItem[];
  href: string;
  label: string;
};

export const SUPPORTED_DOCUMENT_ACCEPT =
  ".pdf,.epub,.mobi,.prc,.azw,.azw3,.kf8,.fb2,.txt,.md,.markdown,.html,.htm,.xhtml,.docx";

export const SUPPORTED_DOCUMENT_SUMMARY =
  "PDF, EPUB, MOBI, PRC, AZW, AZW3, FB2, DOCX, TXT, Markdown e HTML";

const FORMAT_LABELS: Record<ReaderDocumentFormat, string> = {
  azw: "AZW / Kindle",
  azw3: "AZW3 / KF8",
  docx: "DOCX",
  epub: "EPUB",
  fb2: "FB2",
  html: "HTML",
  markdown: "Markdown",
  mobi: "MOBI",
  pdf: "PDF",
  prc: "PRC / MOBI",
  txt: "TXT",
};

const INTERNAL_PROTOCOL_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: string) {
  return escapeHtml(value);
}

function getFileExtension(fileName: string) {
  const normalized = fileName.toLocaleLowerCase("pt-BR");
  const lastDot = normalized.lastIndexOf(".");
  return lastDot >= 0 ? normalized.slice(lastDot) : "";
}

function humanizeFileStem(fileName: string) {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeFormatFromExtension(extension: string): ReaderDocumentFormat | null {
  switch (extension) {
    case ".pdf":
      return "pdf";
    case ".epub":
      return "epub";
    case ".mobi":
      return "mobi";
    case ".prc":
      return "prc";
    case ".azw":
      return "azw";
    case ".azw3":
    case ".kf8":
      return "azw3";
    case ".fb2":
      return "fb2";
    case ".txt":
      return "txt";
    case ".md":
    case ".markdown":
      return "markdown";
    case ".html":
    case ".htm":
    case ".xhtml":
      return "html";
    case ".docx":
      return "docx";
    default:
      return null;
  }
}

function pickPublishedDate(values: Record<string, string> | undefined) {
  if (!values) {
    return undefined;
  }

  return (
    values.publication ??
    values.published ??
    values.creation ??
    values.modification ??
    Object.values(values)[0]
  );
}

function toPlainTextSnippet(value: string | undefined | null) {
  if (!value) {
    return undefined;
  }

  const normalized = value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized || undefined;
}

async function sanitizeReaderHtml(value: string) {
  const basicSanitize = (dirty: string) =>
    dirty
      .replace(
        /<\s*(audio|base|canvas|form|iframe|input|link|meta|object|script|style|textarea|video)\b[\s\S]*?<\s*\/\s*\1\s*>/giu,
        "",
      )
      .replace(/\s+on[a-z-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/giu, "")
      .replace(/\s+style\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/giu, "")
      .replace(/\s+(href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/giu, "")
      .replace(/\s+(href|src)\s*=\s*(["'])\s*data:text\/html[\s\S]*?\2/giu, "")
      .replace(/\s+(href|src)\s*=\s*(["'])\s*\/\/[\s\S]*?\2/giu, "");

  if (typeof window === "undefined") {
    return basicSanitize(value);
  }

  const domPurifyModule = (await import("dompurify")) as typeof import("dompurify");
  const purifyCandidate = domPurifyModule as unknown as {
    default?: { sanitize?: (dirty: string, config: object) => string };
    sanitize?: (dirty: string, config: object) => string;
  };
  const sanitizable =
    typeof purifyCandidate.sanitize === "function"
      ? purifyCandidate
      : typeof purifyCandidate.default?.sanitize === "function"
        ? purifyCandidate.default
        : null;

  if (!sanitizable) {
    return basicSanitize(value);
  }

  const sanitize = sanitizable.sanitize;

  if (!sanitize) {
    return value;
  }

  const sanitized = sanitize(basicSanitize(value), {
    FORBID_TAGS: [
      "audio",
      "base",
      "canvas",
      "form",
      "iframe",
      "input",
      "link",
      "meta",
      "object",
      "script",
      "style",
      "textarea",
      "video",
    ],
    FORBID_ATTR: ["style"],
    USE_PROFILES: { html: true },
  });

  const template = window.document.createElement("template");
  template.innerHTML = sanitized;

  template.content.querySelectorAll("a[href]").forEach((anchor) => {
    const href = anchor.getAttribute("href")?.trim() ?? "";

    if (!href) {
      anchor.removeAttribute("href");
      return;
    }

    if (/^\s*\/\//u.test(href) || /^\s*(?:javascript:|data:)/iu.test(href)) {
      anchor.removeAttribute("href");
      anchor.removeAttribute("target");
      anchor.removeAttribute("rel");
      return;
    }

    if (/^https?:/iu.test(href)) {
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noreferrer noopener");
    }
  });

  template.content.querySelectorAll("img").forEach((image) => {
    const src = image.getAttribute("src")?.trim() ?? "";
    image.removeAttribute("srcset");

    if (!src) {
      image.remove();
      return;
    }

    if (/^https?:/iu.test(src) || /^\s*\/\//u.test(src)) {
      image.remove();
      return;
    }

    if (!/^(?:data:image\/|blob:|#|[^:/?#][^?#]*)/iu.test(src)) {
      image.remove();
    }
  });

  return template.innerHTML;
}

function plainTextToHtml(rawText: string) {
  const normalized = rawText.replace(/\r\n?/g, "\n").trim();

  if (!normalized) {
    return '<p class="readerEmptyCopy">Esse arquivo nao trouxe texto legivel.</p>';
  }

  return normalized
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br />")}</p>`)
    .join("");
}

function htmlToEditablePlainText(rawHtml: string) {
  return rawHtml
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<\/p>/giu, "\n\n")
    .replace(/<\/div>/giu, "\n")
    .replace(/<\/h[1-6]>/giu, "\n\n")
    .replace(/<li>/giu, "• ")
    .replace(/<\/li>/giu, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function buildChapterMarkup(chapters: ChapterContent[]) {
  return chapters
    .map(
      (chapter, index) => `
        <section class="readerChapter" data-reader-chapter-id="${escapeAttribute(chapter.id)}">
          <header class="readerChapterHeader">
            <p class="readerChapterIndex">${String(index + 1).padStart(2, "0")}</p>
            <h2 class="readerChapterTitle">${escapeHtml(chapter.title)}</h2>
          </header>
          <div class="readerChapterBody">${chapter.html}</div>
        </section>
      `,
    )
    .join("");
}

function walkToc(items: TocItem[] | undefined, visit: (item: TocItem) => void) {
  if (!items) {
    return;
  }

  for (const item of items) {
    visit(item);
    walkToc(item.children, visit);
  }
}

function buildTocLabelMap(
  items: TocItem[] | undefined,
  resolveHref: (href: string) => InternalHrefResolution | null | undefined,
) {
  const map = new Map<string, string>();

  walkToc(items, (item) => {
    const resolved = resolveHref(item.href);

    if (!resolved || map.has(resolved.chapterId)) {
      return;
    }

    map.set(resolved.chapterId, item.label.trim() || resolved.chapterId);
  });

  return map;
}

function buildTableOfContents(
  items: TocItem[] | undefined,
  resolveHref: (href: string) => InternalHrefResolution | null | undefined,
  level = 0,
  entries: ReaderTocEntry[] = [],
  seen = new Set<string>(),
) {
  if (!items) {
    return entries;
  }

  for (const item of items) {
    const label = item.label.trim();
    const resolved = resolveHref(item.href);

    if (label && resolved) {
      const key = `${resolved.chapterId}:${resolved.selector}:${label}`;

      if (!seen.has(key)) {
        seen.add(key);
        entries.push({
          ...resolved,
          id: `toc-${entries.length + 1}`,
          label,
          level,
        });
      }
    }

    buildTableOfContents(item.children, resolveHref, level + 1, entries, seen);
  }

  return entries;
}

function buildHtmlDocument(
  format: Exclude<ReaderDocumentFormat, "pdf">,
  label: string,
  html: string,
  meta: ReaderDocumentMeta,
  resolveInternalHref?: (href: string) => InternalHrefResolution | null,
  tableOfContents?: ReaderTocEntry[],
): ReaderDocument {
  return {
    format,
    formatLabel: FORMAT_LABELS[format],
    html,
    kind: "html",
    label,
    meta,
    resolveInternalHref,
    tableOfContents,
  };
}

function buildPdfDocument(file: File | string, label: string): ReaderDocument {
  return {
    file,
    format: "pdf",
    formatLabel: FORMAT_LABELS.pdf,
    kind: "pdf",
    label,
    meta: {
      title: humanizeFileStem(label),
    },
  };
}

async function loadTxtDocument(
  file: File,
  format: "markdown" | "txt",
): Promise<ReaderDocumentLoadResult> {
  const rawText = await file.text();
  const html = plainTextToHtml(rawText);

  return {
    document: buildHtmlDocument(format, file.name, html, {
      description:
        format === "markdown"
          ? "Arquivo Markdown aberto em modo de leitura limpa."
          : "Arquivo de texto aberto em leitura direta.",
      title: humanizeFileStem(file.name),
    }),
  };
}

async function loadHtmlDocument(file: File): Promise<ReaderDocumentLoadResult> {
  const rawHtml = await file.text();
  const sanitizedHtml = await sanitizeReaderHtml(rawHtml);

  return {
    document: buildHtmlDocument("html", file.name, sanitizedHtml, {
      description: "HTML local saneado para leitura dentro do app.",
      title: humanizeFileStem(file.name),
    }),
  };
}

async function loadDocxDocument(file: File): Promise<ReaderDocumentLoadResult> {
  const mammothModule = (await import("mammoth")) as typeof import("mammoth");
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammothModule.convertToHtml(
    typeof window === "undefined"
      ? { buffer: Buffer.from(arrayBuffer) }
      : { arrayBuffer },
    { externalFileAccess: false },
  );

  const warningMessages = result.messages
    .map((message) => message.message.trim())
    .filter(Boolean);
  const sanitizedHtml = await sanitizeReaderHtml(result.value);

  return {
    document: buildHtmlDocument("docx", file.name, sanitizedHtml, {
      note:
        warningMessages.length > 0
          ? `Conversao DOCX com observacoes: ${warningMessages[0]}`
          : undefined,
      title: humanizeFileStem(file.name),
    }),
  };
}

async function loadEpubDocument(file: File): Promise<ReaderDocumentLoadResult> {
  const epubModule = (await import("@lingo-reader/epub-parser")) as typeof import("@lingo-reader/epub-parser");
  const parserInput =
    typeof window === "undefined" ? new Uint8Array(await file.arrayBuffer()) : file;
  const epub = await epubModule.initEpubFile(parserInput);

  try {
    const spine = epub.getSpine();
    const toc = epub.getToc();
    const resolveTocHref = (href: string) => {
      const resolved = epub.resolveHref(href);
      return resolved ? { chapterId: resolved.id, selector: resolved.selector } : null;
    };
    const labelMap = buildTocLabelMap(toc, resolveTocHref);
    const tableOfContents = buildTableOfContents(toc, resolveTocHref);

    const chapters: ChapterContent[] = [];

    for (const [index, item] of spine.entries()) {
      const loaded = await epub.loadChapter(item.id);

      if (!loaded?.html?.trim()) {
        continue;
      }

      const sanitizedHtml = await sanitizeReaderHtml(loaded.html);

      chapters.push({
        html: sanitizedHtml,
        id: item.id,
        title: labelMap.get(item.id) ?? `Secao ${index + 1}`,
      });
    }

    if (chapters.length === 0) {
      throw new Error("Nao encontrei capitulos legiveis dentro deste EPUB.");
    }

    const metadata = epub.getMetadata();
    const title = metadata.title || humanizeFileStem(file.name);
    const author =
      metadata.creator?.map((item) => item.contributor).filter(Boolean).join(", ") || undefined;

    return {
      dispose: () => epub.destroy(),
      document: buildHtmlDocument(
        "epub",
        file.name,
        buildChapterMarkup(chapters),
        {
          author,
          chapterCount: chapters.length,
          coverSrc: epub.getCoverImage() || undefined,
          description: toPlainTextSnippet(metadata.description),
          language: metadata.language || undefined,
          published: pickPublishedDate(metadata.date),
          publisher: metadata.publisher || undefined,
          title,
          tocCount: toc.length || undefined,
        },
        (href) => {
          const resolved = epub.resolveHref(href);
          return resolved ? { chapterId: resolved.id, selector: resolved.selector } : null;
        },
        tableOfContents,
      ),
    };
  } catch (error) {
    epub.destroy();
    throw error;
  }
}

async function loadFb2Document(file: File): Promise<ReaderDocumentLoadResult> {
  const fb2Module = (await import("@lingo-reader/fb2-parser")) as typeof import("@lingo-reader/fb2-parser");
  const parserInput =
    typeof window === "undefined" ? new Uint8Array(await file.arrayBuffer()) : file;
  const fb2 = await fb2Module.initFb2File(parserInput);

  try {
    const spine = fb2.getSpine();
    const toc = fb2.getToc();
    const resolveTocHref = (href: string) => {
      const resolved = fb2.resolveHref(href);
      return resolved ? { chapterId: resolved.id, selector: resolved.selector } : null;
    };
    const labelMap = buildTocLabelMap(toc, resolveTocHref);
    const tableOfContents = buildTableOfContents(toc, resolveTocHref);

    const chapters: ChapterContent[] = [];

    for (const [index, item] of spine.entries()) {
      const loaded = fb2.loadChapter(item.id);

      if (!loaded?.html?.trim()) {
        continue;
      }

      const sanitizedHtml = await sanitizeReaderHtml(loaded.html);

      chapters.push({
        html: sanitizedHtml,
        id: item.id,
        title: labelMap.get(item.id) ?? `Secao ${index + 1}`,
      });
    }

    if (chapters.length === 0) {
      throw new Error("Nao encontrei capitulos legiveis dentro deste FB2.");
    }

    const metadata = fb2.getMetadata();
    const author = metadata.author?.name || undefined;

    return {
      dispose: () => fb2.destroy(),
      document: buildHtmlDocument(
        "fb2",
        file.name,
        buildChapterMarkup(chapters),
        {
          author,
          chapterCount: chapters.length,
          coverSrc: fb2.getCoverImage() || undefined,
          description: toPlainTextSnippet(metadata.description),
          language: metadata.language || undefined,
          published: metadata.year || metadata.date || undefined,
          publisher: metadata.publisher || undefined,
          title: metadata.title || metadata.bookName || humanizeFileStem(file.name),
          tocCount: toc.length || undefined,
        },
        (href) => {
          const resolved = fb2.resolveHref(href);
          return resolved ? { chapterId: resolved.id, selector: resolved.selector } : null;
        },
        tableOfContents,
      ),
    };
  } catch (error) {
    fb2.destroy();
    throw error;
  }
}

async function loadMobiFamilyDocument(
  file: File,
  format: "azw" | "azw3" | "mobi" | "prc",
): Promise<ReaderDocumentLoadResult> {
  const mobiModule = (await import("@lingo-reader/mobi-parser")) as typeof import("@lingo-reader/mobi-parser");
  const parserInput =
    typeof window === "undefined" ? new Uint8Array(await file.arrayBuffer()) : file;
  const parser =
    format === "azw3"
      ? await mobiModule.initKf8File(parserInput)
      : await mobiModule.initMobiFile(parserInput);

  try {
    const spine = parser.getSpine();
    const toc = parser.getToc();
    const resolveTocHref = (href: string) => {
      const resolved = parser.resolveHref(href);
      return resolved ? { chapterId: resolved.id, selector: resolved.selector } : null;
    };
    const labelMap = buildTocLabelMap(toc, resolveTocHref);
    const tableOfContents = buildTableOfContents(toc, resolveTocHref);

    const chapters: ChapterContent[] = [];

    for (const [index, item] of spine.entries()) {
      const loaded = parser.loadChapter(item.id);

      if (!loaded?.html?.trim()) {
        continue;
      }

      const sanitizedHtml = await sanitizeReaderHtml(loaded.html);

      chapters.push({
        html: sanitizedHtml,
        id: item.id,
        title: labelMap.get(item.id) ?? `Secao ${index + 1}`,
      });
    }

    if (chapters.length === 0) {
      throw new Error(
        "Nao encontrei capitulos legiveis neste arquivo Kindle/MOBI. Ele pode estar protegido.",
      );
    }

    const metadata = parser.getMetadata();

    return {
      dispose: () => parser.destroy(),
      document: buildHtmlDocument(
        format,
        file.name,
        buildChapterMarkup(chapters),
        {
          author: metadata.author?.join(", ") || undefined,
          chapterCount: chapters.length,
          coverSrc: parser.getCoverImage() || undefined,
          description: toPlainTextSnippet(metadata.description),
          language: metadata.language || undefined,
          published: metadata.published || undefined,
          publisher: metadata.publisher || undefined,
          title: metadata.title || humanizeFileStem(file.name),
          tocCount: toc.length || undefined,
        },
        (href) => {
          const resolved = parser.resolveHref(href);
          return resolved ? { chapterId: resolved.id, selector: resolved.selector } : null;
        },
        tableOfContents,
      ),
    };
  } catch (error) {
    parser.destroy();
    throw error;
  }
}

export function createSamplePdfDocument() {
  return buildPdfDocument("/sample-reader.pdf", "PDF de exemplo");
}

export function describeDocumentForChip(document: ReaderDocument, numPages: number) {
  if (document.kind === "pdf") {
    return numPages > 0 ? `${numPages} paginas` : "Aguardando paginas";
  }

  if (document.meta.chapterCount) {
    return `${document.meta.chapterCount} secoes`;
  }

  return document.formatLabel;
}

export function extractEditableText(document: ReaderDocument) {
  if (document.kind !== "html") {
    return null;
  }

  return htmlToEditablePlainText(document.html);
}

export function replaceHtmlDocumentText(
  document: ReaderDocument,
  nextText: string,
): ReaderDocument {
  if (document.kind !== "html") {
    return document;
  }

  return buildHtmlDocument(
    document.format,
    document.label,
    plainTextToHtml(nextText),
    {
      ...document.meta,
      note: "Texto local ajustado manualmente neste navegador.",
    },
  );
}

export function getDocumentFormatLabel(document: ReaderDocument | null) {
  return document ? document.formatLabel : "Sem arquivo";
}

export function isInternalReaderHref(href: string) {
  if (href.startsWith("#")) {
    return true;
  }

  return INTERNAL_PROTOCOL_PATTERN.test(href);
}

export async function loadReaderDocument(file: File): Promise<ReaderDocumentLoadResult> {
  const extension = getFileExtension(file.name);
  const format = normalizeFormatFromExtension(extension);

  if (!format) {
    if (extension === ".doc") {
      throw new Error(
        "Arquivos .doc antigos ainda nao abrem bem aqui. Se puder, converta para .docx.",
      );
    }

    if (extension === ".kfx") {
      throw new Error(
        "Arquivos KFX do Kindle ainda nao sao suportados neste leitor web, sobretudo quando ha DRM.",
      );
    }

    throw new Error(
      `Formato ainda nao suportado. Hoje o leitor aceita ${SUPPORTED_DOCUMENT_SUMMARY}.`,
    );
  }

  switch (format) {
    case "pdf":
      return {
        document: buildPdfDocument(file, file.name),
      };
    case "epub":
      return loadEpubDocument(file);
    case "fb2":
      return loadFb2Document(file);
    case "mobi":
    case "prc":
    case "azw":
    case "azw3":
      return loadMobiFamilyDocument(file, format);
    case "docx":
      return loadDocxDocument(file);
    case "txt":
      return loadTxtDocument(file, "txt");
    case "markdown":
      return loadTxtDocument(file, "markdown");
    case "html":
      return loadHtmlDocument(file);
    default:
      throw new Error(
        `Formato ainda nao suportado. Hoje o leitor aceita ${SUPPORTED_DOCUMENT_SUMMARY}.`,
      );
  }
}
