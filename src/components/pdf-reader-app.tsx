"use client";

import Image from "next/image";
import {
  startTransition,
  useEffect,
  useEffectEvent,
  useReducer,
  useRef,
  useState,
  type RefObject,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Document, Page, pdfjs } from "react-pdf";
import {
  createSamplePdfDocument,
  describeDocumentForChip,
  extractEditableText,
  getDocumentFormatLabel,
  loadReaderDocument,
  replaceHtmlDocumentText,
  SUPPORTED_DOCUMENT_ACCEPT,
  SUPPORTED_DOCUMENT_SUMMARY,
  type ReaderDocument,
  type ReaderTocEntry,
} from "@/lib/local-reader-documents";
import {
  createLoadingSource,
  createUnavailableSource,
} from "@/lib/lookup-source-config";
import {
  detectLookupLanguage,
  getLookupSourceIdsForLanguage,
  type LookupLanguage,
} from "@/lib/lookup-language";
import {
  clearReaderSessionFile,
  clearReaderSessionState,
  loadReaderSessionFile,
  loadReaderSessionState,
  saveReaderSessionFile,
  saveReaderSessionState,
  type ReaderSessionPosition,
} from "@/lib/reader-session";
import type {
  DictionarySourceId,
  DictionarySourceResult,
  LookupContext,
  LookupPayload,
  LookupSection,
} from "@/lib/lookup-types";
import {
  clampTooltipPosition,
  clampValue,
  getTooltipMetrics,
  mergeLiveTooltipPosition,
  normalizeWordSelection,
  resolveTooltipLayout,
  snapshotRect,
  type TooltipState,
} from "./reader/tooltip-geometry";
import {
  buildLookupCacheKey,
  readLookupFromBrowserCache,
  shouldCacheLookupPayload,
  writeLookupToBrowserCache,
} from "./reader/lookup-cache";
import {
  buildEmptySourceMessage,
  buildLoadingPayload,
  buildSectionKey,
  getDefaultSectionKey,
  getDefaultSourceId,
  getDisplayPayload,
  getDisplaySource,
  getDisplaySourceLabel,
  getLookupSourceIds,
  getRelativeSourceId,
  getVisibleSections,
  sourceStatusLabel,
} from "./reader/lookup-display";
import {
  EMPTY_SOURCE_SEARCH_STATE,
  sourceSearchReducer,
  type SourceSearchLoadingState,
  type SourceSearchQueriesState,
  type SourceSearchResultsState,
  type SourceSearchState,
  type SourceSearchUpdater,
} from "./reader/source-search-state";
import {
  blobToDataUrl,
  createDocxBlob,
  downloadBlob,
  getSupportedAudioMimeType,
  resolveInitialNotes,
  sanitizeFileStem,
} from "./reader/notes-export";
import styles from "./pdf-reader-app.module.css";

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const THEME_STORAGE_KEY = "pdf-reader-theme";
const NOTES_STORAGE_KEY = "mathesis-reader-notes";
const PDF_EAGER_PAGE_COUNT = 2;
const PDF_PAGE_ROOT_MARGIN = "700px 0px 900px 0px";
const READER_SCROLL_PERSIST_INTERVAL_MS = 350;
const SEARCHABLE_INLINE_SOURCE_IDS = new Set<DictionarySourceId>([
  "aulete",
  "priberam",
  "infopedia",
  "infopedia_de",
  "infopedia_dept",
  "infopedia_en",
  "infopedia_enpt",
  "infopedia_es",
  "infopedia_espt",
  "infopedia_fr",
  "infopedia_frpt",
  "infopedia_it",
  "infopedia_itpt",
  "etimologia",
  "gramatica",
  "analogico",
  "mitologico",
  "wikipedia",
  "corpus",
  "johnson",
  "webster",
  "wiktionary",
  "english_analogico",
  "treccani",
  "logeion",
  "faria",
  "tabelas",
]);

type ReaderTheme = "day" | "night";
type AudioRecorderStatus = "idle" | "recording" | "ready" | "transcribing" | "error";

function resolveInitialTheme(): ReaderTheme {
  if (typeof window === "undefined") {
    return "day";
  }

  const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);

  if (savedTheme === "night" || savedTheme === "day") {
    return savedTheme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "night" : "day";
}

function sourceStatusClassName(status: DictionarySourceResult["status"]) {
  if (status === "found") {
    return styles.sourceStatusFound;
  }

  if (status === "loading") {
    return styles.sourceStatusPending;
  }

  if (status === "not_found") {
    return styles.sourceStatusMuted;
  }

  return styles.sourceStatusWarning;
}

function sourceTabMarkerClassName(status: DictionarySourceResult["status"]) {
  if (status === "found") {
    return styles.sourceTabMarkerFound;
  }

  if (status === "loading") {
    return styles.sourceTabMarkerPending;
  }

  if (status === "not_found") {
    return styles.sourceTabMarkerMuted;
  }

  return styles.sourceTabMarkerWarning;
}

function isInlineSearchSource(sourceId: DictionarySourceId) {
  return SEARCHABLE_INLINE_SOURCE_IDS.has(sourceId);
}

function extractSelectionContext(selection: Selection) {
  if (selection.rangeCount === 0) {
    return undefined;
  }

  const word = normalizeWordSelection(selection.toString());

  if (word.kind !== "word") {
    return undefined;
  }

  const range = selection.getRangeAt(0);
  const baseNode = range.commonAncestorContainer;
  const baseElement =
    baseNode instanceof Element ? baseNode : baseNode.parentElement;

  const container = baseElement?.closest(
    ".react-pdf__Page__textContent, article, p, li, div, section",
  );
  const rawText = container?.textContent?.replace(/\s+/g, " ").trim();

  if (!rawText) {
    return undefined;
  }

  const normalizedText = rawText.normalize("NFC");
  const normalizedWord = word.word.normalize("NFC");
  const matchIndex = normalizedText
    .toLocaleLowerCase("pt-BR")
    .indexOf(normalizedWord.toLocaleLowerCase("pt-BR"));

  if (matchIndex < 0) {
    return normalizedText.slice(0, 360);
  }

  const start = Math.max(0, matchIndex - 180);
  const end = Math.min(
    normalizedText.length,
    matchIndex + normalizedWord.length + 180,
  );

  return normalizedText.slice(start, end).trim();
}

function renderSection(section: LookupSection) {
  return (
    <div className={styles.sectionCard} key={section.label}>
      <p className={styles.sectionLabel}>{section.label}</p>
      {section.html ? (
        <div
          className={styles.sectionRich}
          dangerouslySetInnerHTML={{ __html: section.html }}
        />
      ) : section.text ? (
        <p className={styles.sectionPlain}>{section.text}</p>
      ) : (
        <p className={styles.sectionEmpty}>Esse bloco nao apareceu para esta fonte.</p>
      )}
    </div>
  );
}

function scrollToReaderTarget(
  stage: HTMLElement | null,
  target: Pick<ReaderTocEntry, "chapterId" | "selector">,
) {
  if (!stage) {
    return;
  }

  const chapterRoot = Array.from(
    stage.querySelectorAll<HTMLElement>("[data-reader-chapter-id]"),
  ).find((element) => element.dataset.readerChapterId === target.chapterId);

  if (!chapterRoot) {
    return;
  }

  try {
    const destination =
      chapterRoot.querySelector<HTMLElement>(target.selector) ?? chapterRoot;

    destination.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch {
    chapterRoot.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function scrollToPdfPage(stage: HTMLElement | null, pageNumber: number | null | undefined) {
  if (!stage || !pageNumber) {
    return;
  }

  const pageSlot = stage.querySelector<HTMLElement>(
    `[data-pdf-page-number="${pageNumber}"]`,
  );

  pageSlot?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function getNearestVisiblePdfPage(stage: HTMLElement | null) {
  if (!stage) {
    return null;
  }

  const stageRect = stage.getBoundingClientRect();
  const targetY = stageRect.top + 96;
  let bestPage: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const slot of stage.querySelectorAll<HTMLElement>("[data-pdf-page-number]")) {
    const rawPage = Number(slot.dataset.pdfPageNumber);

    if (!Number.isFinite(rawPage)) {
      continue;
    }

    const rect = slot.getBoundingClientRect();
    const distance = Math.abs(rect.top - targetY);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestPage = rawPage;
    }
  }

  return bestPage;
}

function buildLookupContext(
  documentState: ReaderDocument | null,
  selectionContextText?: string,
  overrides?: Partial<LookupContext>,
): LookupContext {
  return {
    documentAuthor: overrides?.documentAuthor ?? documentState?.meta.author,
    documentLanguage: overrides?.documentLanguage ?? documentState?.meta.language,
    documentLabel: overrides?.documentLabel ?? documentState?.label,
    selectionContextText: overrides?.selectionContextText ?? selectionContextText,
    documentTitle: overrides?.documentTitle ?? documentState?.meta.title,
  };
}

function buildManualEmptyPayload(language: LookupLanguage): LookupPayload {
  const context: LookupContext = { documentLanguage: language };

  return {
    displayWord: "",
    requestedWord: "",
    sources: getLookupSourceIdsForLanguage(language).map((sourceId) => {
      if (language === "latin" && sourceId === "tabelas") {
        return createLoadingSource("sum", sourceId, context);
      }

      return createUnavailableSource(
        "",
        sourceId,
        buildEmptySourceMessage(sourceId),
        context,
      );
    }),
  };
}

function seedInlineSourceState(payload: LookupPayload, seedWord: string) {
  const queries: Partial<Record<DictionarySourceId, string>> = {};
  const results: Partial<Record<DictionarySourceId, DictionarySourceResult>> = {};
  const loading: Partial<Record<DictionarySourceId, boolean>> = {};

  for (const source of payload.sources) {
    if (!SEARCHABLE_INLINE_SOURCE_IDS.has(source.sourceId)) {
      continue;
    }

    queries[source.sourceId] = seedWord;
    results[source.sourceId] = source;
    loading[source.sourceId] = source.status === "loading";
  }

  return { loading, queries, results };
}

function getSourceTimeoutMs(sourceId: DictionarySourceId) {
  if (sourceId === "corpus") {
    return 60000;
  }

  if (sourceId === "analogico") {
    return 25000;
  }

  if (sourceId === "mitologico") {
    return 45000;
  }

  if (sourceId === "wikipedia") {
    return 15000;
  }

  if (sourceId === "infopedia") {
    return 45000;
  }

  if (sourceId === "imagens") {
    return 45000;
  }

  if (sourceId === "etimologia") {
    return 60000;
  }

  if (sourceId === "gramatica") {
    return 60000;
  }

  return 25000;
}

async function fetchLookupSourceResult(
  word: string,
  sourceId: DictionarySourceId,
  context: LookupContext,
  parentSignal: AbortSignal,
) {
  const timeoutController = new AbortController();
  const timeoutId = window.setTimeout(
    () => timeoutController.abort(),
    getSourceTimeoutMs(sourceId),
  );
  const abortFromParent = () => timeoutController.abort();

  parentSignal.addEventListener("abort", abortFromParent, { once: true });

  try {
    const shouldSendDocumentContext =
      sourceId === "corpus" ||
      sourceId === "etimologia" ||
      sourceId === "imagens" ||
      sourceId === "wikipedia" ||
      sourceId === "johnson" ||
      sourceId === "webster" ||
      sourceId === "wiktionary" ||
      sourceId === "english_analogico" ||
      sourceId === "infopedia_de" ||
      sourceId === "infopedia_dept" ||
      sourceId === "infopedia_en" ||
      sourceId === "infopedia_enpt" ||
      sourceId === "infopedia_es" ||
      sourceId === "infopedia_espt" ||
      sourceId === "infopedia_fr" ||
      sourceId === "infopedia_frpt" ||
      sourceId === "infopedia_it" ||
      sourceId === "infopedia_itpt" ||
      sourceId === "treccani" ||
      sourceId === "gramatica" ||
      sourceId === "logeion" ||
      sourceId === "faria" ||
      sourceId === "porto" ||
      sourceId === "tabelas" ||
      sourceId === "mitologico";
    const response = await fetch(
      `/api/lookup?${new URLSearchParams({
        word,
        source: sourceId,
        ...(sourceId === "analogico" ? { revision: "analogia-v12" } : {}),
        ...(sourceId === "mitologico" ? { revision: "grimal-allowed-names-v40" } : {}),
        ...(shouldSendDocumentContext && context.documentAuthor
          ? { documentAuthor: context.documentAuthor }
          : {}),
        ...(shouldSendDocumentContext && context.documentLanguage
          ? { documentLanguage: context.documentLanguage }
          : {}),
        ...(shouldSendDocumentContext && context.documentLabel
          ? { documentLabel: context.documentLabel }
          : {}),
        ...(shouldSendDocumentContext && context.selectionContextText
          ? { selectionContextText: context.selectionContextText }
          : {}),
        ...(shouldSendDocumentContext && context.documentTitle
          ? { documentTitle: context.documentTitle }
          : {}),
      }).toString()}`,
      {
        signal: timeoutController.signal,
      },
    );

    const body = (await response.json()) as
      | DictionarySourceResult
      | { message?: string };

    if (!response.ok || !("sourceId" in body)) {
      throw new Error(
        "message" in body && body.message
          ? body.message
          : "Nao consegui consultar esta fonte agora.",
      );
    }

    return getDisplaySource(body);
  } catch (error) {
    if (parentSignal.aborted) {
      throw error;
    }

    if (timeoutController.signal.aborted) {
      throw new Error("Esta fonte demorou demais nesta consulta; tente de novo em instantes.");
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    parentSignal.removeEventListener("abort", abortFromParent);
  }
}

function LazyPdfPage({
  eager = false,
  pageNumber,
  rootRef,
  width,
}: {
  eager?: boolean;
  pageNumber: number;
  rootRef: RefObject<HTMLElement | null>;
  width: number;
}) {
  const slotRef = useRef<HTMLDivElement | null>(null);
  const [shouldRender, setShouldRender] = useState(eager);
  const placeholderHeight = Math.max(420, Math.round(width * 1.42));

  useEffect(() => {
    if (shouldRender) {
      return;
    }

    const slot = slotRef.current;

    if (!slot) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting || entry.intersectionRatio > 0)) {
          setShouldRender(true);
          observer.disconnect();
        }
      },
      {
        root: rootRef.current,
        rootMargin: PDF_PAGE_ROOT_MARGIN,
        threshold: 0.01,
      },
    );

    observer.observe(slot);
    return () => {
      observer.disconnect();
    };
  }, [rootRef, shouldRender]);

  return (
    <div
      className={styles.pdfPageSlot}
      data-pdf-page-number={pageNumber}
      ref={slotRef}
      style={{ minHeight: `${placeholderHeight}px` }}
    >
      {shouldRender ? (
        <Page
          loading={
            <div
              className={styles.pdfPagePlaceholder}
              style={{ minHeight: `${placeholderHeight}px` }}
            >
              <span>Carregando página {pageNumber}...</span>
            </div>
          }
          pageNumber={pageNumber}
          renderAnnotationLayer
          renderTextLayer
          width={width}
        />
      ) : (
        <div
          aria-hidden="true"
          className={styles.pdfPagePlaceholder}
          style={{ minHeight: `${placeholderHeight}px` }}
        />
      )}
    </div>
  );
}

export default function PdfReaderApp() {
  const [documentState, setDocumentState] = useState<ReaderDocument | null>(null);
  const [documentLoadingLabel, setDocumentLoadingLabel] = useState<string | null>(null);
  const [isTocOpen, setIsTocOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const isExpanded = true;
  const showInspector = false;
  const [numPages, setNumPages] = useState<number>(0);
  const [pageWidth, setPageWidth] = useState(760);
  const [theme, setTheme] = useState<ReaderTheme>(resolveInitialTheme);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [isTooltipDragging, setIsTooltipDragging] = useState(false);
  const [activeSectionKeys, setActiveSectionKeys] = useState<
    Partial<Record<DictionarySourceId, string>>
  >({});
  const [activeSourceId, setActiveSourceId] = useState<DictionarySourceId | null>(
    null,
  );
  const [sourceSearchState, dispatchSourceSearch] = useReducer(
    sourceSearchReducer,
    EMPTY_SOURCE_SEARCH_STATE,
  );
  const sourceSearchQueries = sourceSearchState.queries;
  const sourceSearchResults = sourceSearchState.results;
  const sourceSearchLoading = sourceSearchState.loading;
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [readerNotes, setReaderNotes] = useState(() =>
    resolveInitialNotes(NOTES_STORAGE_KEY),
  );
  const [audioStatus, setAudioStatus] = useState<AudioRecorderStatus>("idle");
  const [audioMessage, setAudioMessage] = useState("");
  const [audioTranscript, setAudioTranscript] = useState("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [manualLookupWord, setManualLookupWord] = useState("");
  const [manualLookupLanguage, setManualLookupLanguage] =
    useState<LookupLanguage>("portuguese");
  const [documentEditorValue, setDocumentEditorValue] = useState("");
  const [isDocumentEditing, setIsDocumentEditing] = useState(false);

  function resetSourceSearchState() {
    dispatchSourceSearch({ type: "reset" });
  }

  function replaceSourceSearchState(next: SourceSearchState) {
    dispatchSourceSearch({ type: "replace", next });
  }

  function setSourceSearchQueries(updater: SourceSearchUpdater<SourceSearchQueriesState>) {
    dispatchSourceSearch({ type: "queries", updater });
  }

  function setSourceSearchResults(updater: SourceSearchUpdater<SourceSearchResultsState>) {
    dispatchSourceSearch({ type: "results", updater });
  }

  function setSourceSearchLoading(updater: SourceSearchUpdater<SourceSearchLoadingState>) {
    dispatchSourceSearch({ type: "loading", updater });
  }
  const [restoringSession, setRestoringSession] = useState(true);

  const cacheRef = useRef<Map<string, LookupPayload>>(new Map());
  const audioBlobRef = useRef<Blob | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioObjectUrlRef = useRef<string | null>(null);
  const audioRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const shouldAutoTranscribeRef = useRef(false);
  const documentDisposeRef = useRef<(() => void) | null>(null);
  const documentRequestRef = useRef(0);
  const pendingLookupRef = useRef<AbortController | null>(null);
  const sourceSearchRef = useRef<{
    controller: AbortController | null;
    timeoutId: number | null;
  }>({
    controller: null,
    timeoutId: null,
  });
  const sourceDragRef = useRef<{ left: number; moved: boolean; x: number } | null>(
    null,
  );
  const tooltipDragRef = useRef<{
    height: number;
    offsetX: number;
    offsetY: number;
    pointerId: number;
    width: number;
  } | null>(null);
  const tooltipLivePositionRef = useRef<{ x: number; y: number } | null>(null);
  const lastTooltipLayoutRef = useRef<
    Pick<
      TooltipState,
      "manualPosition" | "maxHeight" | "placement" | "width" | "x" | "y"
    > | null
  >(null);
  const sourceTabListRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const viewerSurfaceRef = useRef<HTMLDivElement | null>(null);
  const loadedFileRef = useRef<File | null>(null);
  const restorePositionRef = useRef<ReaderSessionPosition | null>(null);
  const persistReaderStateTimeoutRef = useRef<number | null>(null);
  const hasAppliedRestorePositionRef = useRef(false);
  const didAttemptSessionRestoreRef = useRef(false);
  const restoreEditedTextRef = useRef<string | null>(null);

  function queuePersistReaderState(position?: ReaderSessionPosition | null) {
    if (persistReaderStateTimeoutRef.current) {
      window.clearTimeout(persistReaderStateTimeoutRef.current);
    }

    persistReaderStateTimeoutRef.current = window.setTimeout(() => {
      void saveReaderSessionState({
        editedText: documentState?.kind === "html" ? documentEditorValue : null,
        position:
          position ??
          (documentState?.kind === "html"
            ? {
                kind: "html",
                scrollTop: viewerSurfaceRef.current?.scrollTop ?? 0,
              }
            : null),
      });
    }, 180);
  }

  function dismissTooltip() {
    if (tooltip?.manualPosition) {
      const measured = tooltipRef.current?.getBoundingClientRect();
      const nextMaxHeight = getTooltipMetrics().maxHeight;
      const persistedPosition = clampTooltipPosition(
        tooltipLivePositionRef.current?.x ?? tooltip.x,
        tooltipLivePositionRef.current?.y ?? tooltip.y,
        measured?.width ?? tooltip.width,
        measured?.height ?? tooltip.maxHeight,
      );

      lastTooltipLayoutRef.current = {
        manualPosition: true,
        maxHeight: nextMaxHeight,
        placement: tooltip.placement,
        width: measured?.width ?? tooltip.width,
        x: persistedPosition.x,
        y: persistedPosition.y,
      };
    }

    pendingLookupRef.current?.abort();
    pendingLookupRef.current = null;
    sourceSearchRef.current.controller?.abort();
    if (sourceSearchRef.current.timeoutId) {
      window.clearTimeout(sourceSearchRef.current.timeoutId);
    }
    sourceSearchRef.current = { controller: null, timeoutId: null };
    tooltipDragRef.current = null;
    tooltipLivePositionRef.current = null;
    setIsTooltipDragging(false);
    setTooltip(null);
  }

  function toggleTooltipExpansion() {
    setTooltip((current) => {
      if (!current || showInspector) {
        return current;
      }

      const { floatingWidth, viewportPadding } = getTooltipMetrics();
      const expanded = !current.expanded;
      const nextWidth = expanded
        ? Math.min(window.innerWidth - viewportPadding * 2, window.innerWidth >= 1280 ? 860 : 720)
        : floatingWidth;
      const measured = tooltipRef.current?.getBoundingClientRect();
      const nextPosition = clampTooltipPosition(
        tooltipLivePositionRef.current?.x ?? current.x,
        tooltipLivePositionRef.current?.y ?? current.y,
        nextWidth,
        measured?.height ?? current.maxHeight,
      );

      tooltipLivePositionRef.current = nextPosition;

      return {
        ...current,
        expanded,
        width: nextWidth,
        x: nextPosition.x,
        y: nextPosition.y,
      };
    });
  }

  function openManualLookup() {
    const initialWord = tooltip?.word ?? "";
    const initialLanguage = detectLookupLanguage(initialWord || "amor", {
      documentLanguage: documentState?.meta.language,
    });
    const payload = getDisplayPayload(buildManualEmptyPayload(initialLanguage));

    setManualLookupWord(initialWord);
    setManualLookupLanguage(initialLanguage);
    setViewerError(null);
    setActiveSourceId(null);
    resetSourceSearchState();

    const { floatingWidth, maxHeight, viewportPadding } = getTooltipMetrics();
    const width = Math.min(window.innerWidth - viewportPadding * 2, floatingWidth);
    const x = clampValue(
      window.innerWidth / 2 - width / 2,
      viewportPadding,
      window.innerWidth - viewportPadding - width,
    );
    const y = clampValue(
      window.innerHeight * 0.16,
      viewportPadding,
      window.innerHeight - viewportPadding - maxHeight,
    );
    const anchorRect = {
      bottom: y + 44,
      height: 44,
      left: x,
      right: x + width,
      top: y,
      width,
    };

    const manualLayout =
      lastTooltipLayoutRef.current?.manualPosition
        ? {
            ...lastTooltipLayoutRef.current,
            anchorRect,
          }
        : {
            anchorRect,
            manualPosition: true as const,
            maxHeight,
            placement: "right" as const,
            width,
            x,
            y,
          };

    syncTooltipNavigation(payload);
    setTooltip({
      ...manualLayout,
      contextOverrides: { documentLanguage: initialLanguage },
      manualPosition: true,
      payload,
      status: "ready",
      word: initialWord,
    });
  }

  function releaseLoadedDocument() {
    documentDisposeRef.current?.();
    documentDisposeRef.current = null;
  }

  function stopAudioStream() {
    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
    audioStreamRef.current = null;
  }

  function setRecordedAudioBlob(blob: Blob) {
    if (audioObjectUrlRef.current) {
      URL.revokeObjectURL(audioObjectUrlRef.current);
    }

    audioBlobRef.current = blob;
    audioObjectUrlRef.current = URL.createObjectURL(blob);
    setAudioUrl(audioObjectUrlRef.current);
  }

  async function startAudioRecording() {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setAudioStatus("error");
      setAudioMessage("Este navegador não liberou gravação de áudio aqui.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredMimeType = getSupportedAudioMimeType();
      const recorder = new MediaRecorder(
        stream,
        preferredMimeType ? { mimeType: preferredMimeType } : undefined,
      );

      audioChunksRef.current = [];
      audioStreamRef.current = stream;
      audioRecorderRef.current = recorder;
      shouldAutoTranscribeRef.current = true;
      setAudioTranscript("");

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      });

      recorder.addEventListener("stop", () => {
        const mimeType = recorder.mimeType || "audio/webm";
        const chunks = audioChunksRef.current;

        stopAudioStream();
        audioRecorderRef.current = null;

        if (chunks.length === 0) {
          setAudioStatus("error");
          setAudioMessage("A gravação terminou vazia. Tente novamente.");
          return;
        }

        const nextBlob = new Blob(chunks, { type: mimeType });

        setRecordedAudioBlob(nextBlob);
        setAudioStatus("ready");
        setAudioMessage("Gravação pronta. Você pode ouvir ou transcrever.");

        if (shouldAutoTranscribeRef.current) {
          void transcribeAudioBlob(nextBlob);
        }
      });

      recorder.start();
      setAudioStatus("recording");
      setAudioMessage("Gravando... fale com calma; eu cuido do resto.");
    } catch {
      stopAudioStream();
      setAudioStatus("error");
      setAudioMessage("Não consegui acessar o microfone neste navegador.");
    }
  }

  function stopAudioRecording() {
    const recorder = audioRecorderRef.current;

    if (!recorder || recorder.state === "inactive") {
      return;
    }

    recorder.stop();
    setAudioMessage("Finalizando a gravação...");
  }

  async function transcribeAudioBlob(blob: Blob) {
    setAudioStatus("transcribing");
    setAudioMessage("Transcrevendo...");

    try {
      const dataUrl = await blobToDataUrl(blob);
      const response = await fetch("/api/transcribe", {
        body: JSON.stringify({
          audioBase64: dataUrl,
          mimeType: blob.type || "audio/webm",
        }),
        cache: "no-store",
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      });
      const payload = (await response.json()) as { message?: string; text?: string };

      if (!response.ok || !payload.text?.trim()) {
        throw new Error(payload.message ?? "A transcrição voltou vazia.");
      }

      const transcript = payload.text.trim();

      setAudioTranscript(transcript);
      setReaderNotes((current) => {
        const prefix = current.trimEnd();
        return prefix ? `${prefix}\n\n${transcript}` : transcript;
      });
      setAudioStatus("ready");
      setAudioMessage("Transcrição adicionada às anotações.");
    } catch (error) {
      setAudioStatus("error");
      setAudioMessage(
        error instanceof Error
          ? error.message
          : "Não consegui transcrever este áudio agora.",
      );
    }
  }

  function handleNotesMicrophoneClick() {
    if (audioStatus === "recording") {
      stopAudioRecording();
      return;
    }

    void startAudioRecording();
  }

  async function ingestFile(
    nextFile: File | null,
    options?: { restoreFromSession?: boolean },
  ) {
    if (!nextFile) {
      return;
    }

    const requestId = ++documentRequestRef.current;
    hasAppliedRestorePositionRef.current = false;

    releaseLoadedDocument();
    pendingLookupRef.current?.abort();

    startTransition(() => {
      setDocumentLoadingLabel(nextFile.name);
      setDocumentState(null);
      setIsTocOpen(false);
      setNumPages(0);
      setTooltip(null);
      setViewerError(null);
    });

    try {
      const result = await loadReaderDocument(nextFile);

      if (requestId !== documentRequestRef.current) {
        result.dispose?.();
        return;
      }

      loadedFileRef.current = nextFile;
      await saveReaderSessionFile(nextFile);
      const nextDocument =
        options?.restoreFromSession && restoreEditedTextRef.current && result.document.kind === "html"
          ? replaceHtmlDocumentText(result.document, restoreEditedTextRef.current)
          : result.document;

      startTransition(() => {
        documentDisposeRef.current = result.dispose ?? null;
        setDocumentLoadingLabel(null);
        setDocumentState(nextDocument);
        setDocumentEditorValue(
          nextDocument.kind === "html" ? extractEditableText(nextDocument) ?? "" : "",
        );
        setIsDocumentEditing(false);
      });
      restoreEditedTextRef.current = null;
    } catch (error) {
      if (requestId !== documentRequestRef.current) {
        return;
      }

      const message =
        error instanceof Error
          ? error.message
          : "Nao consegui abrir esse arquivo agora.";

      startTransition(() => {
        setDocumentLoadingLabel(null);
        setDocumentState(null);
        setViewerError(message);
      });
    }
  }

  function loadSamplePdf() {
    documentRequestRef.current += 1;
    releaseLoadedDocument();
    loadedFileRef.current = null;
    restorePositionRef.current = null;
    hasAppliedRestorePositionRef.current = false;

    startTransition(() => {
      pendingLookupRef.current?.abort();
      setDocumentLoadingLabel(null);
      setDocumentState(createSamplePdfDocument());
      setIsTocOpen(false);
      setNumPages(0);
      setTooltip(null);
      setViewerError(null);
      setDocumentEditorValue("");
      setIsDocumentEditing(false);
    });

    void clearReaderSessionFile();
    void clearReaderSessionState();
  }

  function syncTooltipNavigation(payload: LookupPayload) {
    const sources = payload.sources;
    const defaultSourceId = getDefaultSourceId(sources);

    if (defaultSourceId) {
      setActiveSourceId((current) =>
        current && sources.some((source) => source.sourceId === current)
          ? current
          : defaultSourceId,
      );
    }

    setActiveSectionKeys((current) => {
      let hasChanges = false;
      const next = { ...current };

      for (const source of sources) {
        const validSectionKeys = getVisibleSections(source).map((section) =>
          buildSectionKey(source.sourceId, section.label),
        );
        const currentSectionKey = current[source.sourceId];

        if (validSectionKeys.length === 0) {
          if (currentSectionKey) {
            delete next[source.sourceId];
            hasChanges = true;
          }
          continue;
        }

        if (!currentSectionKey || !validSectionKeys.includes(currentSectionKey)) {
          next[source.sourceId] = validSectionKeys[0]!;
          hasChanges = true;
        }
      }

      return hasChanges ? next : current;
    });
  }

  const dismissTooltipEvent = useEffectEvent(() => {
    dismissTooltip();
  });

  function jumpToTocEntry(entry: ReaderTocEntry) {
    scrollToReaderTarget(viewerSurfaceRef.current, entry);
    setIsTocOpen(false);
  }

  async function resolveLookupInternal(
    word: string,
    anchor: Pick<
      TooltipState,
      "anchorRect" | "manualPosition" | "maxHeight" | "placement" | "width" | "x" | "y"
    >,
    selectionContextText?: string,
    contextOverrides?: Partial<LookupContext>,
  ) {
    const baseContext = buildLookupContext(documentState, selectionContextText, contextOverrides);
    const resolvedLanguage = detectLookupLanguage(word, baseContext);
    const shouldRespectManualLanguage =
      !selectionContextText && Boolean(contextOverrides?.documentLanguage);
    const context = {
      ...baseContext,
      documentLanguage: shouldRespectManualLanguage
        ? baseContext.documentLanguage ?? resolvedLanguage
        : resolvedLanguage,
    };
    if (
      context.documentLanguage === "english" ||
      context.documentLanguage === "latin" ||
      context.documentLanguage === "portuguese"
    ) {
      setManualLookupLanguage(context.documentLanguage);
    }
    const resolvedContextOverrides = {
      ...contextOverrides,
      documentLanguage: context.documentLanguage,
    };
    const cacheKey = buildLookupCacheKey(word, context);
    const sourceIds = getLookupSourceIds(word, context);
    const cached =
      cacheRef.current.get(cacheKey) ?? readLookupFromBrowserCache(cacheKey);

    if (cached) {
      cacheRef.current.set(cacheKey, cached);
      syncTooltipNavigation(cached);
      setTooltip({
        ...anchor,
        contextOverrides: resolvedContextOverrides,
        payload: cached,
        status: "ready",
        word,
      });
      return;
    }

    pendingLookupRef.current?.abort();
    const controller = new AbortController();
    pendingLookupRef.current = controller;
    let nextPayload = getDisplayPayload(buildLoadingPayload(word, context));
    const seededInlineState = seedInlineSourceState(nextPayload, word);

    syncTooltipNavigation(nextPayload);
    replaceSourceSearchState(seededInlineState);

    setTooltip({
      ...anchor,
      contextOverrides: resolvedContextOverrides,
      payload: nextPayload,
      status: "loading",
      word,
    });

    try {
      const sourceResults = new Map<DictionarySourceId, DictionarySourceResult>(
        nextPayload.sources.map((source) => [source.sourceId, source]),
      );
      const priorityLimit =
        sourceIds.length <= 4 && sourceIds.includes("corpus") ? 2 : 3;
      const prioritySourceIds = sourceIds.slice(0, priorityLimit);
      const deferredSourceIds = sourceIds.slice(prioritySourceIds.length);
      const applySourceResult = (nextSource: DictionarySourceResult) => {
        sourceResults.set(nextSource.sourceId, nextSource);
        nextPayload = {
          ...nextPayload,
          sources: sourceIds.map(
            (sourceId) =>
              sourceResults.get(sourceId) ?? createLoadingSource(word, sourceId, context),
          ),
        };
        syncTooltipNavigation(nextPayload);
        setTooltip((current) => {
          if (!current || current.word !== word) {
            return current;
          }

          return mergeLiveTooltipPosition({
            ...current,
            contextOverrides: resolvedContextOverrides,
            payload: nextPayload,
            status: "loading",
          }, tooltipLivePositionRef.current);
        });
      };

      const fetchSourceBatch = async (batchSourceIds: readonly DictionarySourceId[]) => {
        await Promise.allSettled(
          batchSourceIds.map(async (sourceId) => {
            try {
              const body = await fetchLookupSourceResult(
                word,
                sourceId,
                context,
                controller.signal,
              );

              if (controller.signal.aborted) {
                return;
              }

              applySourceResult(body);
            } catch (error) {
              if (controller.signal.aborted) {
                throw error;
              }

              const message =
                error instanceof Error
                  ? error.message
                  : "Nao consegui consultar esta fonte agora.";

              applySourceResult(createUnavailableSource(word, sourceId, message, context));
            }
          }),
        );
      };

      const finalizeTooltipPayload = (status: "loading" | "ready") => {
        const finalPayload = getDisplayPayload({
          ...nextPayload,
          sources: sourceIds.map(
            (sourceId) =>
              sourceResults.get(sourceId) ??
              createUnavailableSource(word, sourceId, undefined, context),
          ),
        });

        if (status === "ready" && shouldCacheLookupPayload(finalPayload)) {
          cacheRef.current.set(cacheKey, finalPayload);
          writeLookupToBrowserCache(cacheKey, finalPayload);
        }

        syncTooltipNavigation(finalPayload);
        setTooltip((current) => {
          if (!current || current.word !== word) {
            return current;
          }

          return mergeLiveTooltipPosition({
            ...current,
            contextOverrides: resolvedContextOverrides,
            payload: finalPayload,
            status,
          }, tooltipLivePositionRef.current);
        });
      };

      await fetchSourceBatch(prioritySourceIds);

      if (controller.signal.aborted) {
        return;
      }

      if (deferredSourceIds.length === 0) {
        finalizeTooltipPayload("ready");
        return;
      }

      finalizeTooltipPayload("loading");

      void (async () => {
        await fetchSourceBatch(deferredSourceIds);

        if (controller.signal.aborted) {
          return;
        }

        finalizeTooltipPayload("ready");
      })();
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      console.error("lookup failed", error);
      setTooltip((current) => {
        if (!current || current.word !== word) {
          return current;
        }

        const fallbackPayload = getDisplayPayload({
          displayWord: word,
          requestedWord: word,
          sources: sourceIds.map((sourceId) =>
            createUnavailableSource(
              word,
              sourceId,
              "Nao consegui montar o painel agora.",
              context,
            ),
          ),
        });

        return mergeLiveTooltipPosition({
          ...current,
          contextOverrides: resolvedContextOverrides,
          payload: fallbackPayload,
          status: "ready",
        }, tooltipLivePositionRef.current);
      });
    }
  }

  const resolveLookup = useEffectEvent(
    async (
      word: string,
      anchor: Pick<
        TooltipState,
        "anchorRect" | "manualPosition" | "maxHeight" | "placement" | "width" | "x" | "y"
      >,
      selectionContextText?: string,
    ) => {
      await resolveLookupInternal(word, anchor, selectionContextText);
    },
  );

  const selectionTargetsDocumentContent = useEffectEvent((selection: Selection) => {
    if (!documentState || selection.rangeCount === 0) {
      return false;
    }

    const matchesDocumentNode = (node: Node | null) => {
      const element =
        node instanceof Element
          ? node
          : node && "parentElement" in node
            ? node.parentElement
            : null;

      if (!element) {
        return false;
      }

      if (documentState.kind === "pdf") {
        return Boolean(element.closest(".react-pdf__Page__textContent"));
      }

      return Boolean(element.closest(`.${styles.htmlDocument}`));
    };

    return (
      matchesDocumentNode(selection.anchorNode) &&
      matchesDocumentNode(selection.focusNode)
    );
  });

  const handleSelectionAttempt = useEffectEvent(() => {
    if (!documentState) {
      return;
    }

    const selection = window.getSelection();

    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return;
    }

    if (!selectionTargetsDocumentContent(selection)) {
      return;
    }

    const normalized = normalizeWordSelection(selection.toString());
    const rect = selection.getRangeAt(0).getBoundingClientRect();

    if (rect.width === 0 && rect.height === 0) {
      return;
    }

    const anchorRect = snapshotRect(rect);
    const rememberedTooltipLayout = lastTooltipLayoutRef.current;
    const anchor =
      tooltip?.manualPosition
        ? {
            anchorRect,
            manualPosition: true as const,
            maxHeight: tooltip.maxHeight,
            placement: tooltip.placement,
            width: tooltip.width,
            x: tooltip.x,
            y: tooltip.y,
          }
        : rememberedTooltipLayout?.manualPosition
          ? {
              anchorRect,
              manualPosition: true as const,
              maxHeight: rememberedTooltipLayout.maxHeight,
              placement: rememberedTooltipLayout.placement,
              width: rememberedTooltipLayout.width,
              x: rememberedTooltipLayout.x,
              y: rememberedTooltipLayout.y,
            }
        : {
            anchorRect,
            ...resolveTooltipLayout(anchorRect, undefined, showInspector),
          };

    if (normalized.kind === "empty") {
      return;
    }

    if (normalized.kind === "error") {
      setTooltip({
        ...anchor,
        error: normalized.message,
        status: "error",
        word: selection.toString().trim(),
      });
      return;
    }

    resolveLookup(normalized.word, anchor, extractSelectionContext(selection));
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (didAttemptSessionRestoreRef.current) {
      return;
    }

    didAttemptSessionRestoreRef.current = true;

    void (async () => {
      try {
        const [savedFile, savedState] = await Promise.all([
          loadReaderSessionFile(),
          loadReaderSessionState(),
        ]);

        if (savedState?.position) {
          restorePositionRef.current = savedState.position;
        }

        restoreEditedTextRef.current = savedState?.editedText ?? null;

        if (savedFile) {
          await ingestFile(savedFile, { restoreFromSession: true });
        }
      } finally {
        setRestoringSession(false);
      }
    })();
  }, []);

  useEffect(() => {
    window.localStorage.setItem(NOTES_STORAGE_KEY, readerNotes);
  }, [readerNotes]);

  useEffect(() => {
    if (!documentState || !restorePositionRef.current || hasAppliedRestorePositionRef.current) {
      return;
    }

    const nextPosition = restorePositionRef.current;
    const stage = viewerSurfaceRef.current;

    if (!stage) {
      return;
    }

    if (documentState.kind === "pdf") {
      if (!numPages) {
        return;
      }

      hasAppliedRestorePositionRef.current = true;
      window.requestAnimationFrame(() => {
        scrollToPdfPage(stage, nextPosition.kind === "pdf" ? nextPosition.pageNumber : 1);
      });
      return;
    }

    hasAppliedRestorePositionRef.current = true;
    window.requestAnimationFrame(() => {
      stage.scrollTop = nextPosition.kind === "html" ? nextPosition.scrollTop : 0;
    });
  }, [documentState, numPages]);

  useEffect(() => {
    const stage = viewerSurfaceRef.current;

    if (!stage || !documentState) {
      return;
    }

    let ticking = false;
    let lastPersistedAt = 0;
    const onScroll = () => {
      const now = window.performance.now();

      if (now - lastPersistedAt < READER_SCROLL_PERSIST_INTERVAL_MS) {
        return;
      }

      if (ticking) {
        return;
      }

      ticking = true;
      window.requestAnimationFrame(() => {
        ticking = false;
        lastPersistedAt = window.performance.now();

        if (documentState.kind === "pdf") {
          const pageNumber = getNearestVisiblePdfPage(stage);

          if (pageNumber) {
            queuePersistReaderState({ kind: "pdf", pageNumber });
          }

          return;
        }

        queuePersistReaderState({
          kind: "html",
          scrollTop: stage.scrollTop,
        });
      });
    };

    stage.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      stage.removeEventListener("scroll", onScroll);
    };
  }, [documentState, documentEditorValue]);

  useEffect(() => {
    if (!documentState || documentState.kind !== "html") {
      return;
    }

    queuePersistReaderState(
      restorePositionRef.current?.kind === "html"
        ? restorePositionRef.current
        : {
            kind: "html",
            scrollTop: viewerSurfaceRef.current?.scrollTop ?? 0,
          },
    );
  }, [documentEditorValue, documentState?.kind]);

  useEffect(() => {
    const stage = viewerSurfaceRef.current;

    if (!stage) {
      return;
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const baseWidth = Math.floor(entries[0].contentRect.width - 52);
      setPageWidth(Math.max(300, Math.min(1120, baseWidth)));
    });

    resizeObserver.observe(stage);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    const stage = viewerSurfaceRef.current;

    if (!stage) {
      return;
    }

    const handleMouseUp = () => {
      window.requestAnimationFrame(handleSelectionAttempt);
    };

    stage.addEventListener("mouseup", handleMouseUp);
    return () => {
      stage.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  useEffect(() => {
    const stage = viewerSurfaceRef.current;

    if (!stage || !documentState || documentState.kind !== "html") {
      return;
    }

    const handleDocumentLink = (event: MouseEvent) => {
      if (!documentState.resolveInternalHref || !(event.target instanceof Element)) {
        return;
      }

      const link = event.target.closest("a[href]");

      if (!(link instanceof HTMLAnchorElement)) {
        return;
      }

      const href = link.getAttribute("href")?.trim();

      if (!href) {
        return;
      }

      const resolved = documentState.resolveInternalHref(href);

      if (!resolved) {
        return;
      }

      event.preventDefault();

      scrollToReaderTarget(stage, resolved);
    };

    stage.addEventListener("click", handleDocumentLink);
    return () => {
      stage.removeEventListener("click", handleDocumentLink);
    };
  }, [documentState]);

  useEffect(() => {
    if (!tooltip) {
      return;
    }

    const syncTooltipLayout = () => {
      if (tooltip.manualPosition) {
        const measured = tooltipRef.current?.getBoundingClientRect();
        const nextMaxHeight = getTooltipMetrics().maxHeight;
        const livePosition = tooltipLivePositionRef.current;
        const nextPosition = clampTooltipPosition(
          livePosition?.x ?? tooltip.x,
          livePosition?.y ?? tooltip.y,
          measured?.width ?? tooltip.width,
          measured?.height ?? tooltip.maxHeight,
        );

        tooltipLivePositionRef.current = nextPosition;

        setTooltip((current) => {
          if (!current || current.word !== tooltip.word) {
            return current;
          }

          if (
            current.maxHeight === nextMaxHeight &&
            Math.abs(current.x - nextPosition.x) < 1 &&
            Math.abs(current.y - nextPosition.y) < 1
          ) {
            return current;
          }

          return {
            ...current,
            maxHeight: nextMaxHeight,
            x: nextPosition.x,
            y: nextPosition.y,
          };
        });

        return;
      }

      const measuredHeight = tooltipRef.current?.getBoundingClientRect().height;
      const nextLayout = resolveTooltipLayout(
        tooltip.anchorRect,
        measuredHeight,
        showInspector,
      );

      setTooltip((current) => {
        if (!current || current.word !== tooltip.word) {
          return current;
        }

        if (
          current.maxHeight === nextLayout.maxHeight &&
          current.placement === nextLayout.placement &&
          Math.abs(current.width - nextLayout.width) < 1 &&
          Math.abs(current.x - nextLayout.x) < 1 &&
          Math.abs(current.y - nextLayout.y) < 1
        ) {
          return current;
        }

        return {
          ...current,
          ...nextLayout,
        };
      });
    };

    syncTooltipLayout();
    window.addEventListener("resize", syncTooltipLayout);

    return () => {
      window.removeEventListener("resize", syncTooltipLayout);
    };
  }, [showInspector, tooltip]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        dismissTooltipEvent();
      }
    };

    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, []);

  useEffect(() => {
    return () => {
      documentRequestRef.current += 1;
      releaseLoadedDocument();
      pendingLookupRef.current?.abort();
      sourceSearchRef.current.controller?.abort();
      if (sourceSearchRef.current.timeoutId) {
        window.clearTimeout(sourceSearchRef.current.timeoutId);
      }
      if (persistReaderStateTimeoutRef.current) {
        window.clearTimeout(persistReaderStateTimeoutRef.current);
      }
      shouldAutoTranscribeRef.current = false;

      if (audioRecorderRef.current?.state !== "inactive") {
        audioRecorderRef.current?.stop();
      }

      stopAudioStream();

      if (audioObjectUrlRef.current) {
        URL.revokeObjectURL(audioObjectUrlRef.current);
      }
    };
  }, []);

  const visibleSources = tooltip?.payload?.sources.map(getDisplaySource) ?? [];
  const hasPendingSources = visibleSources.some((source) => source.status === "loading");
  const fallbackSourceId = getDefaultSourceId(visibleSources);
  const resolvedSourceId =
    activeSourceId && visibleSources.some((source) => source.sourceId === activeSourceId)
      ? activeSourceId
      : fallbackSourceId;
  const activeSource = resolvedSourceId
    ? visibleSources.find((source) => source.sourceId === resolvedSourceId) ?? null
    : null;
  const activeSourceQuery =
    activeSource && isInlineSearchSource(activeSource.sourceId)
      ? sourceSearchQueries[activeSource.sourceId] ??
        sourceSearchQueries[visibleSources.find((source) => isInlineSearchSource(source.sourceId))?.sourceId ?? activeSource.sourceId] ??
        tooltip?.word ??
        activeSource.canonicalWord
      : "";
  const activeSourceSearchPlaceholder = (() => {
    if (
      activeSource?.sourceId === "johnson" ||
      activeSource?.sourceId === "webster" ||
      activeSource?.sourceId === "infopedia_en" ||
      activeSource?.sourceId === "infopedia_enpt" ||
      activeSource?.sourceId === "english_analogico" ||
      activeSource?.sourceId === "wiktionary"
    ) {
      return "Digite a palavra inglesa";
    }

    if (
      tooltip?.contextOverrides?.documentLanguage === "latin" ||
      activeSource?.sourceId === "logeion" ||
      activeSource?.sourceId === "faria" ||
      activeSource?.sourceId === "tabelas"
    ) {
      return "Digite a forma latina";
    }

    return "Digite a palavra que deseja consultar";
  })();
  const currentLookupLanguage =
    (visibleSources.some((source) =>
      ["faria", "johnson", "webster", "wiktionary", "infopedia_en", "infopedia_enpt", "english_analogico", "logeion", "tabelas"].includes(source.sourceId),
    )
      ? visibleSources.some((source) =>
          ["johnson", "webster", "wiktionary", "infopedia_en", "infopedia_enpt", "english_analogico"].includes(source.sourceId),
        )
        ? "english"
        : "latin"
      : tooltip?.word
        ? detectLookupLanguage(tooltip.word, tooltip.contextOverrides)
        : tooltip?.contextOverrides?.documentLanguage) ??
    tooltip?.contextOverrides?.documentLanguage;
  const isManualLookupPanel = Boolean(
    tooltip?.payload?.requestedWord === "" &&
      tooltip?.payload?.displayWord === "" &&
      !tooltip?.word,
  );
  const panelLookupLanguage: LookupLanguage = isManualLookupPanel
    ? manualLookupLanguage
    : currentLookupLanguage === "english" ||
        currentLookupLanguage === "latin" ||
        currentLookupLanguage === "portuguese"
      ? currentLookupLanguage
      : manualLookupLanguage;
  const shouldShowManualControls = Boolean(tooltip?.manualPosition);
  const shouldShowManualLookupBar =
    shouldShowManualControls && panelLookupLanguage !== "latin";
  const displaySource =
    activeSource && isInlineSearchSource(activeSource.sourceId)
      ? sourceSearchResults[activeSource.sourceId] ?? activeSource
      : activeSource;
  const isActiveSourceSearching =
    displaySource && isInlineSearchSource(displaySource.sourceId)
      ? Boolean(sourceSearchLoading[displaySource.sourceId])
      : false;
  const activeVisibleSections = displaySource ? getVisibleSections(displaySource) : [];
  const activeSectionKey = displaySource
    ? activeSectionKeys[displaySource.sourceId] ?? getDefaultSectionKey(displaySource)
    : null;
  const activeSection = displaySource
    ? activeVisibleSections.find(
        (section) =>
          buildSectionKey(displaySource.sourceId, section.label) === activeSectionKey,
      ) ?? activeVisibleSections[0] ?? null
    : null;
  const documentFormatChip = documentLoadingLabel
    ? "Preparando leitura"
    : getDocumentFormatLabel(documentState);
  const documentSummaryChip = documentState
    ? describeDocumentForChip(documentState, numPages)
    : documentLoadingLabel
      ? "Abrindo arquivo"
      : "Aguardando arquivo";
  const canEditDocumentText = documentState?.kind === "html";
  const tooltipSourceSignature =
    tooltip?.payload?.sources
      .map((source) => `${source.sourceId}:${source.status}:${source.canonicalWord}`)
      .join("|") ?? "";

  function syncInlineSourceQueries(nextQuery: string) {
    const payload = tooltip?.payload;

    if (!payload) {
      return;
    }

    setSourceSearchQueries((current) => {
      const next = { ...current };

      for (const source of payload.sources) {
        if (!isInlineSearchSource(source.sourceId)) {
          continue;
        }

        next[source.sourceId] = nextQuery;
      }

      return next;
    });
  }

  useEffect(() => {
    if (!tooltip?.payload) {
      return;
    }

    const seededQueries: Partial<Record<DictionarySourceId, string>> = {};
    const seededResults: Partial<Record<DictionarySourceId, DictionarySourceResult>> = {};

    for (const source of tooltip.payload.sources) {
      if (!isInlineSearchSource(source.sourceId)) {
        continue;
      }

      seededQueries[source.sourceId] = tooltip.word;
      seededResults[source.sourceId] = source;
    }

    setSourceSearchQueries(seededQueries);
    setSourceSearchResults(seededResults);
    setSourceSearchLoading(
      Object.fromEntries(
        (Object.keys(seededQueries) as DictionarySourceId[]).map((sourceId) => [
          sourceId,
          false,
        ]),
      ) as Partial<Record<DictionarySourceId, boolean>>,
    );
  }, [tooltip?.word, tooltip?.payload?.requestedWord, tooltipSourceSignature]);
  

  useEffect(() => {
    if (!activeSource || !isInlineSearchSource(activeSource.sourceId)) {
      return;
    }

    setSourceSearchQueries((current) => {
      const existing = current[activeSource.sourceId];

      if (existing && existing.trim()) {
        return current;
      }

      return {
        ...current,
        [activeSource.sourceId]: tooltip?.word ?? activeSource.canonicalWord,
      };
    });

    setSourceSearchResults((current) => {
      if (
        current[activeSource.sourceId]?.canonicalWord === activeSource.canonicalWord &&
        current[activeSource.sourceId]?.status === activeSource.status
      ) {
        return current;
      }

      return {
        ...current,
        [activeSource.sourceId]: activeSource,
      };
    });
  }, [activeSource?.sourceId, activeSource?.canonicalWord, activeSource?.status, tooltip?.word]);

  useEffect(() => {
    if (!tooltip?.payload || !activeSource || !displaySource || !isInlineSearchSource(activeSource.sourceId)) {
      return;
    }

    const searchableSources = tooltip.payload.sources.filter((source) =>
      isInlineSearchSource(source.sourceId),
    );
    const trimmedQuery = activeSourceQuery.trim().normalize("NFC");
    const baseWord = tooltip.word.trim().normalize("NFC");

    if (!trimmedQuery || trimmedQuery === baseWord) {
      setSourceSearchLoading((current) => {
        const next = { ...current };

        for (const source of searchableSources) {
          next[source.sourceId] = false;
        }

        return next;
      });
      setSourceSearchResults((current) => {
        const next = { ...current };

        for (const source of searchableSources) {
          next[source.sourceId] = source;
        }

        return next;
      });
      return;
    }

    if (sourceSearchRef.current.timeoutId) {
      window.clearTimeout(sourceSearchRef.current.timeoutId);
      sourceSearchRef.current.timeoutId = null;
    }

    sourceSearchRef.current.controller?.abort();
    const controller = new AbortController();
    sourceSearchRef.current = {
      controller,
      timeoutId: window.setTimeout(async () => {
        setSourceSearchLoading((current) => {
          const next = { ...current };

          for (const source of searchableSources) {
            next[source.sourceId] = true;
          }

          return next;
        });

        try {
          const context = {
            ...buildLookupContext(documentState, undefined, tooltip?.contextOverrides),
            documentLanguage: panelLookupLanguage,
          };
          const results = await Promise.all(
            searchableSources.map(async (source) => {
              try {
                return await fetchLookupSourceResult(
                  trimmedQuery,
                  source.sourceId,
                  context,
                  controller.signal,
                );
              } catch {
                if (controller.signal.aborted) {
                  throw new Error("aborted");
                }

                return createUnavailableSource(
                  trimmedQuery,
                  source.sourceId,
                  "Nao consegui atualizar esta busca agora.",
                  context,
                );
              }
            }),
          );

          if (controller.signal.aborted) {
            return;
          }

          setSourceSearchResults((current) => {
            const next = { ...current };

            for (const result of results) {
              next[result.sourceId] = result;
            }

            return next;
          });
        } catch {
          if (controller.signal.aborted) {
            return;
          }
        } finally {
          if (!controller.signal.aborted) {
            setSourceSearchLoading((current) => {
              const next = { ...current };

              for (const source of searchableSources) {
                next[source.sourceId] = false;
              }

              return next;
            });
          }
        }
      }, 120),
    };

    return () => {
      if (sourceSearchRef.current.timeoutId) {
        window.clearTimeout(sourceSearchRef.current.timeoutId);
        sourceSearchRef.current.timeoutId = null;
      }

      controller.abort();
    };
  }, [
    activeSource?.sourceId,
    activeSourceQuery,
    documentState?.meta.author,
    panelLookupLanguage,
    documentState?.meta.language,
    documentState?.meta.title,
    documentState?.label,
    tooltip?.contextOverrides?.documentLanguage,
    tooltip?.payload?.requestedWord,
    tooltip?.word,
  ]);

  useEffect(() => {
    if (
      !tooltip?.manualPosition ||
      tooltip.word ||
      tooltip.contextOverrides?.documentLanguage !== "latin" ||
      !tooltip.payload?.sources.some(
        (source) => source.sourceId === "tabelas" && source.status === "loading",
      )
    ) {
      return;
    }

    const controller = new AbortController();
    const context: LookupContext = { documentLanguage: "latin" };

    void (async () => {
      try {
        const tables = await fetchLookupSourceResult(
          "sum",
          "tabelas",
          context,
          controller.signal,
        );

        if (controller.signal.aborted) {
          return;
        }

        setTooltip((current) => {
          if (
            !current?.manualPosition ||
            current.word ||
            current.contextOverrides?.documentLanguage !== "latin" ||
            !current.payload
          ) {
            return current;
          }

          const payload = {
            ...current.payload,
            sources: current.payload.sources.map((source) =>
              source.sourceId === "tabelas" ? tables : source,
            ),
          };

          syncTooltipNavigation(payload);

          return {
            ...current,
            payload,
          };
        });
      } catch {
        if (controller.signal.aborted) {
          return;
        }

        setTooltip((current) => {
          if (
            !current?.manualPosition ||
            current.word ||
            current.contextOverrides?.documentLanguage !== "latin" ||
            !current.payload
          ) {
            return current;
          }

          const payload = {
            ...current.payload,
            sources: current.payload.sources.map((source) =>
              source.sourceId === "tabelas"
                ? createUnavailableSource(
                    "sum",
                    "tabelas",
                    "Nao consegui carregar as tabelas latinas agora.",
                    context,
                  )
                : source,
            ),
          };

          syncTooltipNavigation(payload);

          return {
            ...current,
            payload,
          };
        });
      }
    })();

    return () => {
      controller.abort();
    };
  }, [
    tooltip?.contextOverrides?.documentLanguage,
    tooltip?.manualPosition,
    tooltip?.payload?.sources,
    tooltip?.word,
  ]);

  function activateSource(source: DictionarySourceResult) {
    setActiveSourceId(source.sourceId);

    const defaultSectionKey = getDefaultSectionKey(source);

    if (!defaultSectionKey) {
      return;
    }

    setActiveSectionKeys((current) =>
      current[source.sourceId]
        ? current
        : {
            ...current,
            [source.sourceId]: defaultSectionKey,
          },
    );
  }

  function handleSourceTabClick(source: DictionarySourceResult) {
    activateSource(source);
  }

  function handleManualLookupLanguageChange(nextLanguage: LookupLanguage) {
    setManualLookupLanguage(nextLanguage);
    setManualLookupWord("");

    if (!tooltip?.manualPosition) {
      return;
    }

    const payload = getDisplayPayload(buildManualEmptyPayload(nextLanguage));
    syncTooltipNavigation(payload);
    setActiveSourceId(null);
    resetSourceSearchState();

    setTooltip((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        contextOverrides: {
          ...current.contextOverrides,
          documentLanguage: nextLanguage,
        },
        payload,
        status: "ready",
        word: "",
      };
    });
  }

  function submitManualLookup() {
    const rawInput = manualLookupWord.trim();

    const lookupLanguage = panelLookupLanguage;

    if (!rawInput) {
      const payload = getDisplayPayload(buildManualEmptyPayload(lookupLanguage));
      syncTooltipNavigation(payload);
      setTooltip((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          contextOverrides: { documentLanguage: lookupLanguage },
          payload,
          status: "ready",
          word: "",
        };
      });
      return;
    }

    const normalized = normalizeWordSelection(rawInput);

    if (normalized.kind === "error") {
      setViewerError(normalized.message);
      return;
    }

    if (normalized.kind !== "word") {
      return;
    }

    syncInlineSourceQueries(normalized.word);

    const { floatingWidth, maxHeight, viewportPadding } = getTooltipMetrics();
    const width =
      tooltip?.width ?? Math.min(window.innerWidth - viewportPadding * 2, floatingWidth);
    const x =
      tooltip?.x ??
      clampValue(
        window.innerWidth / 2 - width / 2,
        viewportPadding,
        window.innerWidth - viewportPadding - width,
      );
    const y =
      tooltip?.y ??
      clampValue(
        window.innerHeight * 0.16,
        viewportPadding,
        window.innerHeight - viewportPadding - maxHeight,
      );
    const anchorRect =
      tooltip?.anchorRect ?? {
        bottom: y + 44,
        height: 44,
        left: x,
        right: x + width,
        top: y,
        width,
      };

    void resolveLookupInternal(
      normalized.word,
      {
        anchorRect,
        manualPosition: true,
        maxHeight: tooltip?.maxHeight ?? maxHeight,
        placement: tooltip?.placement ?? "right",
        width,
        x,
        y,
      },
      undefined,
      { documentLanguage: lookupLanguage },
    );
  }

  function moveSource(direction: -1 | 1) {
    if (visibleSources.length === 0) {
      return;
    }

    const nextSourceId = getRelativeSourceId(visibleSources, resolvedSourceId, direction);

    if (!nextSourceId) {
      return;
    }

    const nextSource =
      visibleSources.find((source) => source.sourceId === nextSourceId) ?? null;

    if (!nextSource) {
      return;
    }

    activateSource(nextSource);
  }

  function triggerTooltipLookup(nextWord: string) {
    if (!tooltip) {
      return;
    }

    const normalized = normalizeWordSelection(nextWord);

    if (normalized.kind !== "word") {
      return;
    }

    void resolveLookupInternal(normalized.word, {
      anchorRect: tooltip.anchorRect,
      manualPosition: tooltip.manualPosition,
      maxHeight: tooltip.maxHeight,
      placement: tooltip.placement,
      width: tooltip.width,
      x: tooltip.x,
      y: tooltip.y,
    }, undefined, tooltip.contextOverrides);
  }

  function handleSectionStageClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!(event.target instanceof Element)) {
      return;
    }

    const trigger = event.target.closest<HTMLElement>("[data-lookup-word]");
    const nextWord = trigger?.dataset.lookupWord?.trim();

    if (!nextWord) {
      return;
    }

    event.preventDefault();
    triggerTooltipLookup(nextWord);
  }

  function handleSourceTabsPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const list = sourceTabListRef.current;

    if (!list) {
      return;
    }

    if (event.target instanceof Element && event.target.closest("button")) {
      sourceDragRef.current = null;
      return;
    }

    sourceDragRef.current = {
      left: list.scrollLeft,
      moved: false,
      x: event.clientX,
    };
    list.setPointerCapture(event.pointerId);
  }

  function handleSourceTabsPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const list = sourceTabListRef.current;
    const drag = sourceDragRef.current;

    if (!list || !drag) {
      return;
    }

    const delta = event.clientX - drag.x;

    if (Math.abs(delta) > 4) {
      drag.moved = true;
    }

    if (drag.moved) {
      list.scrollLeft = drag.left - delta;
    }
  }

  function handleSourceTabsPointerEnd() {
    sourceDragRef.current = null;
  }

  function handleTooltipHeaderPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (showInspector) {
      return;
    }

    if (event.target instanceof Element && event.target.closest("button")) {
      return;
    }

    const tooltipElement = tooltipRef.current;

    if (!tooltipElement || !tooltip) {
      return;
    }

    const rect = tooltipElement.getBoundingClientRect();
    tooltipDragRef.current = {
      height: rect.height,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      pointerId: event.pointerId,
      width: rect.width,
    };
    tooltipLivePositionRef.current = {
      x: tooltip.x,
      y: tooltip.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsTooltipDragging(true);
    event.preventDefault();
  }

  function handleTooltipHeaderPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = tooltipDragRef.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const nextPosition = clampTooltipPosition(
      event.clientX - drag.offsetX,
      event.clientY - drag.offsetY,
      drag.width,
      drag.height,
    );
    tooltipLivePositionRef.current = nextPosition;
    const tooltipElement = tooltipRef.current;

    if (tooltipElement) {
      tooltipElement.style.left = `${nextPosition.x}px`;
      tooltipElement.style.top = `${nextPosition.y}px`;
    }
  }

  function handleTooltipHeaderPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (tooltipDragRef.current?.pointerId !== event.pointerId) {
      return;
    }

    tooltipDragRef.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const livePosition = tooltipLivePositionRef.current;

    if (livePosition) {
      setTooltip((current) =>
        current
          ? {
              ...current,
              manualPosition: true,
              x: livePosition.x,
              y: livePosition.y,
            }
          : current,
      );
    }

    tooltipLivePositionRef.current = null;
    setIsTooltipDragging(false);
  }

  function buildNotesFileName(extension: string) {
    const stem = sanitizeFileStem(
      documentState?.meta.title ?? documentState?.label ?? "mathesis-notas",
    );

    return `${stem}-notas.${extension}`;
  }

  function exportNotesAsText() {
    const notes = readerNotes.trim();

    if (!notes) {
      return;
    }

    downloadBlob(
      new Blob([notes], { type: "text/plain;charset=utf-8" }),
      buildNotesFileName("txt"),
    );
  }

  function exportNotesAsDocx() {
    const notes = readerNotes.trim();

    if (!notes) {
      return;
    }

    downloadBlob(
      createDocxBlob(documentState?.meta.title ?? "Notas Mathesis", notes),
      buildNotesFileName("docx"),
    );
  }

  async function exportNotesAsPdf() {
    const notes = readerNotes.trim();

    if (!notes) {
      return;
    }

    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF({ format: "a4", unit: "pt" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 56;
    const lineHeight = 18;
    const textWidth = pageWidth - margin * 2;
    let y = margin;

    pdf.setTextColor(33, 24, 18);
    pdf.setFont("times", "bold");
    pdf.setFontSize(18);
    pdf.text("Anotações", pageWidth / 2, y, { align: "center" });
    y += 32;
    pdf.setFont("times", "normal");
    pdf.setFontSize(12);

    const lines = pdf.splitTextToSize(notes, textWidth) as string[];

    for (const line of lines) {
      if (y > pageHeight - margin) {
        pdf.addPage();
        y = margin;
      }

      pdf.text(line, margin, y);
      y += lineHeight;
    }

    downloadBlob(pdf.output("blob"), buildNotesFileName("pdf"));
  }

  function toggleDocumentEditing() {
    if (!documentState || documentState.kind !== "html") {
      return;
    }

    if (isDocumentEditing) {
      const nextDocument = replaceHtmlDocumentText(documentState, documentEditorValue);
      setDocumentState(nextDocument);
      setIsDocumentEditing(false);
      queuePersistReaderState({
        kind: "html",
        scrollTop: viewerSurfaceRef.current?.scrollTop ?? 0,
      });
      return;
    }

    setDocumentEditorValue(extractEditableText(documentState) ?? "");
    setIsDocumentEditing(true);
  }

  function renderTooltipPanel() {
    if (!tooltip) {
      return (
        <div className={styles.inspectorPlaceholder}>
          <p className={styles.panelLabel}>Consultas</p>
          <strong>No aguardo da sua escolha.</strong>
          <p>
            Selecione uma palavra no texto; os verbetes, a etimologia, a
            gramática, a mitologia, a Wikipedia, as imagens e o corpus aparecem
            aqui.
          </p>
        </div>
      );
    }

    return (
      <>
        <div
          className={styles.tooltipHeader}
          onPointerCancel={handleTooltipHeaderPointerEnd}
          onPointerDown={handleTooltipHeaderPointerDown}
          onPointerMove={handleTooltipHeaderPointerMove}
          onPointerUp={handleTooltipHeaderPointerEnd}
        >
          <div className={styles.tooltipWord}>
            <strong>{tooltip.payload?.displayWord || tooltip.word || "Consulta manual"}</strong>
            <span>
              {showInspector
                ? "Painel lateral para comparar fontes com calma"
                : "Popup arrastável de leitura"}
            </span>
          </div>
          <div className={styles.tooltipActions}>
            {!showInspector ? (
              <button
                aria-label={tooltip.expanded ? "Recolher popup" : "Expandir popup"}
                className={styles.expandButton}
                onClick={toggleTooltipExpansion}
                type="button"
              >
                {tooltip.expanded ? "Menor" : "Maior"}
              </button>
            ) : null}
            <button
              aria-label="Fechar painel"
              className={styles.closeButton}
              onClick={() => dismissTooltip()}
              type="button"
            >
              x
            </button>
          </div>
        </div>

        {hasPendingSources ? (
          <p className={styles.tooltipStatus}>
            Abrindo o painel agora e completando as fontes em paralelo...
          </p>
        ) : null}

        {tooltip.status === "error" ? (
          <p className={`${styles.tooltipMessage} ${styles.tooltipError}`}>
            {tooltip.error}
          </p>
        ) : null}

        {shouldShowManualControls ? (
          <div className={styles.inlineSourceSearch}>
            <label className={styles.inlineSourceSearchLabel}>
              {shouldShowManualLookupBar ? "Busca manual" : "Idioma do painel"}
            </label>
            <div className={styles.manualLookupRow}>
              {shouldShowManualLookupBar ? (
                <input
                  className={styles.inlineSourceSearchInput}
                  onChange={(event) => setManualLookupWord(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      submitManualLookup();
                    }
                  }}
                  placeholder="Digite a palavra que deseja consultar"
                  spellCheck={false}
                  type="search"
                  value={manualLookupWord}
                />
              ) : null}
              <select
                className={styles.manualLookupSelect}
                onChange={(event) =>
                  handleManualLookupLanguageChange(
                    event.target.value as LookupLanguage,
                  )
                }
                value={panelLookupLanguage}
              >
                <option value="portuguese">Português</option>
                <option value="latin">Latim</option>
                <option value="english">Inglês</option>
              </select>
              {shouldShowManualLookupBar ? (
                <button
                  className={styles.manualLookupButton}
                  onClick={submitManualLookup}
                  type="button"
                >
                  Buscar
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {tooltip.payload ? (
          displaySource ? (
            <div className={styles.sourceDeck}>
              <div className={styles.sourceNavigator}>
                <button
                  aria-label="Fonte anterior"
                  className={styles.navArrow}
                  onClick={() => moveSource(-1)}
                  type="button"
                >
                  &lt;
                </button>

                <div
                  aria-label="Fontes consultadas"
                  className={styles.sourceTabList}
                  onPointerCancel={() => {
                    handleSourceTabsPointerEnd();
                  }}
                  onPointerDown={handleSourceTabsPointerDown}
                  onPointerLeave={() => {
                    handleSourceTabsPointerEnd();
                  }}
                  onPointerMove={handleSourceTabsPointerMove}
                  onPointerUp={() => {
                    handleSourceTabsPointerEnd();
                  }}
                  ref={sourceTabListRef}
                  role="tablist"
                >
                  {tooltip.payload.sources.map((source) => {
                    const isActive = source.sourceId === displaySource.sourceId;

                    return (
                      <button
                        aria-selected={isActive}
                        className={`${styles.sourceTab} ${
                          isActive ? styles.sourceTabActive : ""
                        }`}
                        key={source.sourceId}
                        onClick={() => handleSourceTabClick(source)}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                        }}
                        role="tab"
                        type="button"
                      >
                        <span
                          className={`${styles.sourceTabMarker} ${sourceTabMarkerClassName(
                            source.status,
                          )}`}
                        />
                        <span className={styles.sourceTabLabel}>
                          {getDisplaySourceLabel(source)}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <button
                  aria-label="Proxima fonte"
                  className={styles.navArrow}
                  onClick={() => moveSource(1)}
                  type="button"
                >
                  &gt;
                </button>
              </div>

              <article className={styles.sourceCard}>
                <div className={styles.sourceHeader}>
                  <div className={styles.sourceHeading}>
                    <p className={styles.sourceEyebrow}>{displaySource.label}</p>
                    <strong>{displaySource.canonicalWord}</strong>
                  </div>
                  <span
                    className={`${styles.sourceStatus} ${sourceStatusClassName(
                      displaySource.status,
                    )}`}
                  >
                    {sourceStatusLabel(displaySource.status)}
                  </span>
                </div>

                {displaySource.note ? (
                  <p
                    className={`${styles.sourceNote} ${
                      displaySource.status === "found" ||
                      displaySource.status === "loading"
                        ? ""
                        : styles.sourceNoteWarning
                    }`}
                  >
                    {displaySource.note}
                  </p>
                ) : null}

                {activeSource && isInlineSearchSource(activeSource.sourceId) ? (
                  <div className={styles.inlineSourceSearch}>
                    <label className={styles.inlineSourceSearchLabel}>
                      Buscar em {getDisplaySourceLabel(activeSource)}
                    </label>
                    <div className={styles.inlineSourceSearchRow}>
                      <input
                        className={styles.inlineSourceSearchInput}
                        onChange={(event) => syncInlineSourceQueries(event.target.value)}
                        placeholder={activeSourceSearchPlaceholder}
                        spellCheck={false}
                        type="search"
                        value={activeSourceQuery}
                      />
                      <span className={styles.inlineSourceSearchStatus}>
                        {isActiveSourceSearching ? "Buscando..." : "Tempo real"}
                      </span>
                    </div>
                  </div>
                ) : null}

                {activeVisibleSections.length > 1 ? (
                  <div
                    aria-label={`Blocos do ${getDisplaySourceLabel(displaySource)}`}
                    className={styles.sectionTabs}
                    role="tablist"
                  >
                    {activeVisibleSections.map((section) => {
                      const sectionKey = buildSectionKey(
                        displaySource.sourceId,
                        section.label,
                      );
                      const isActiveSection = sectionKey === activeSectionKey;

                      return (
                        <button
                          aria-selected={isActiveSection}
                          className={`${styles.sectionTab} ${
                            isActiveSection ? styles.sectionTabActive : ""
                          }`}
                          key={sectionKey}
                          onClick={() =>
                            setActiveSectionKeys((current) => ({
                              ...current,
                              [displaySource.sourceId]: sectionKey,
                            }))
                          }
                          role="tab"
                          type="button"
                        >
                          {section.label}
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {activeSection ? (
                  <div
                    className={styles.sectionStage}
                    onClick={handleSectionStageClick}
                  >
                    {renderSection(activeSection)}
                  </div>
                ) : displaySource.status === "loading" || isActiveSourceSearching ? (
                  <p className={styles.sectionEmptyState}>
                    Esta fonte ainda esta chegando. Voce ja pode trocar de aba sem
                    esperar o lote inteiro.
                  </p>
                ) : !displaySource.note ? (
                  <p className={styles.sectionEmptyState}>
                    Esta fonte nao devolveu um bloco legivel para esta consulta.
                  </p>
                ) : null}

                <div className={styles.sourceFooter}>
                  <span className={styles.sourceLabel}>
                    Fonte consultada: {getDisplaySourceLabel(displaySource)}
                  </span>
                  {displaySource.sourceUrl &&
                  displaySource.sourceId !== "etimologia" &&
                  displaySource.sourceId !== "gramatica" ? (
                    <a
                      className={styles.sourceLink}
                      href={displaySource.sourceUrl}
                      rel="noreferrer noopener"
                      target="_blank"
                    >
                      Abrir fonte
                    </a>
                  ) : null}
                </div>
              </article>
            </div>
          ) : null
        ) : null}
      </>
    );
  }

  return (
    <section className={styles.workspace}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarMeta}>
          <span className={styles.chip}>
            {documentState ? documentState.label : "Nenhum arquivo carregado"}
          </span>
          <span className={styles.chip}>{documentFormatChip}</span>
          <span className={styles.chip}>{documentSummaryChip}</span>
        </div>
        <div className={styles.toolbarAside}>
          <p className={styles.toolbarHint}>
            Abra um arquivo e selecione a palavra que desejar.
          </p>
          <div className={styles.toolbarControls}>
            {canEditDocumentText ? (
              <button
                className={styles.themeToggle}
                onClick={toggleDocumentEditing}
                type="button"
              >
                <span className={styles.themeToggleLabel}>Texto</span>
                <strong>{isDocumentEditing ? "Salvar edição" : "Editar texto"}</strong>
              </button>
            ) : null}
            <button
              className={styles.themeToggle}
              onClick={openManualLookup}
              type="button"
            >
              <span className={styles.themeToggleLabel}>Painel</span>
              <strong>Abrir popup</strong>
            </button>
            <label className={styles.uploadButton}>
              <span className={styles.themeToggleLabel}>Arquivo</span>
              <strong>Escolher</strong>
              <input
                accept={SUPPORTED_DOCUMENT_ACCEPT}
                className={styles.hiddenInput}
                onChange={(event) => ingestFile(event.target.files?.[0] ?? null)}
                type="file"
              />
            </label>
            <button
              aria-label={
                theme === "night" ? "Voltar ao modo claro" : "Ativar modo noturno"
              }
              aria-pressed={theme === "night"}
              className={styles.themeToggle}
              onClick={() =>
                setTheme((currentTheme) =>
                  currentTheme === "night" ? "day" : "night",
                )
              }
              type="button"
            >
              <span className={styles.themeToggleLabel}>Tema</span>
              <strong>{theme === "night" ? "Noturno" : "Claro"}</strong>
            </button>
          </div>
        </div>
      </div>

      <div className={`${styles.frame} ${isExpanded ? styles.frameExpanded : ""}`}>
        {!isExpanded ? (
          <aside className={styles.sidebar}>
            <div className={styles.panel}>
              <p className={styles.panelLabel}>Seu arquivo</p>
              <label
                className={`${styles.dropzone} ${isDragging ? styles.dropzoneActive : ""}`}
                onDragEnter={() => setIsDragging(true)}
                onDragLeave={() => setIsDragging(false)}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setIsDragging(false);
                  ingestFile(event.dataTransfer.files[0] ?? null);
                }}
              >
                <strong>Arraste um arquivo aqui ou clique para escolher.</strong>
                <p>
                  O documento fica no navegador. Este leitor aceita{" "}
                  {SUPPORTED_DOCUMENT_SUMMARY}. As consultas lexicais,
                  etimologicas, gramaticais, mitologicas, visuais e de
                  corpus aparecem so quando voce seleciona uma palavra.
                </p>
                <input
                  accept={SUPPORTED_DOCUMENT_ACCEPT}
                  className={styles.hiddenInput}
                  onChange={(event) => ingestFile(event.target.files?.[0] ?? null)}
                  type="file"
                />
              </label>
              <button
                className={styles.sampleButton}
                onClick={loadSamplePdf}
                type="button"
              >
                Abrir PDF de exemplo
              </button>
            </div>

            <div className={styles.panel}>
              <p className={styles.panelLabel}>Formatos e leitura</p>
              <div className={styles.helperList}>
                <div className={styles.helperItem}>
                  <strong>E-books</strong>
                  <span>
                    EPUB, MOBI, AZW/AZW3 e FB2 entram como texto selecionavel no
                    mesmo painel.
                  </span>
                </div>
                <div className={styles.helperItem}>
                  <strong>Documentos</strong>
                  <span>
                    PDF, EPUB, MOBI, AZW3, FB2, DOCX, TXT e HTML entram como
                    texto selecionável.
                    <br />
                    <br />
                    Depois, basta selecionar uma palavra para que a mágica
                    aconteça.
                  </span>
                </div>
                <div className={styles.helperItem}>
                  <strong>Camadas de consulta</strong>
                  <span>
                    Aulete, Priberam, Infopédia, Etimologia, Gramática e Analogia
                    convivem no mesmo popup, com troca lateral.
                  </span>
                </div>
                <div className={styles.helperItem}>
                  <strong>Mitologia clássica</strong>
                  <span>
                    A aba Mitologia consulta uma base mitológica curada e monta
                    notas de apoio durante a leitura.
                  </span>
                </div>
                <div className={styles.helperItem}>
                  <strong>Corpus português</strong>
                  <span>
                    A aba Corpus agora consulta a antologia local em PDF, separando
                    poesia e prosa; o Wikisource fica como reserva quando faltar
                    ocorrência local.
                  </span>
                </div>
                <div className={styles.helperItem}>
                  <strong>Limites reais</strong>
                  <span>
                    KFX e alguns arquivos Kindle com DRM ainda podem falhar no
                    navegador.
                  </span>
                </div>
              </div>
            </div>
          </aside>
        ) : null}

        <div
          className={`${styles.viewerShell} ${
            isExpanded ? styles.viewerShellExpanded : ""
          } ${showInspector ? styles.viewerShellWithInspector : ""}`}
        >
          {showInspector ? (
            <aside className={styles.inspectorPane} ref={tooltipRef} tabIndex={-1}>
              {renderTooltipPanel()}
            </aside>
          ) : null}

          <div
            className={`${styles.viewerStage} ${
              !documentState && !documentLoadingLabel ? styles.viewerStageEmpty : ""
            } ${isDragging ? styles.viewerStageDragging : ""}`}
            onDragEnter={() => setIsDragging(true)}
            onDragLeave={() => setIsDragging(false)}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              ingestFile(event.dataTransfer.files[0] ?? null);
            }}
            ref={viewerSurfaceRef}
          >
            {documentLoadingLabel || restoringSession ? (
              <div className={styles.viewerLoading}>
                <div>
                  <strong>Preparando a leitura.</strong>
                  <p>{documentLoadingLabel ?? "Restaurando seu arquivo anterior."}</p>
                </div>
              </div>
            ) : !documentState ? (
              <div className={styles.emptyState}>
                <strong>Solte um arquivo aqui para começar.</strong>
                <p>
                  PDF, EPUB, MOBI, AZW3, FB2, DOCX, TXT e HTML entram como texto
                  selecionável.
                </p>
                <p>Depois, basta selecionar uma palavra para que a mágica aconteça.</p>
                <label className={styles.emptyUploadButton}>
                  Escolher arquivo
                  <input
                    accept={SUPPORTED_DOCUMENT_ACCEPT}
                    className={styles.hiddenInput}
                    onChange={(event) => ingestFile(event.target.files?.[0] ?? null)}
                    type="file"
                  />
                </label>
              </div>
            ) : documentState.kind === "pdf" ? (
              <div className={styles.documentArea}>
                <Document
                  error={
                    <div className={styles.viewerError}>
                      <div>
                        <strong>Nao consegui abrir esse arquivo PDF.</strong>
                        <p>
                          Tente um arquivo com texto selecionavel ou verifique se
                          ele nao esta protegido.
                        </p>
                      </div>
                    </div>
                  }
                  file={documentState.file}
                  loading={<div className={styles.viewerLoading}>Carregando PDF...</div>}
                  onItemClick={({ pageNumber }) =>
                    scrollToPdfPage(viewerSurfaceRef.current, pageNumber)
                  }
                  onLoadError={(error) => setViewerError(error.message)}
                  onLoadSuccess={(pdf) => {
                    setNumPages(pdf.numPages);
                    setViewerError(null);
                  }}
                >
                  {Array.from({ length: numPages }, (_, index) => (
                    <LazyPdfPage
                      eager={index < PDF_EAGER_PAGE_COUNT}
                      key={`page_${index + 1}`}
                      pageNumber={index + 1}
                      rootRef={viewerSurfaceRef}
                      width={pageWidth}
                    />
                  ))}
                </Document>
              </div>
            ) : (
              <div className={styles.htmlDocumentShell}>
                {documentState.meta.title ||
                documentState.meta.author ||
                documentState.meta.description ||
                documentState.meta.coverSrc ? (
                  <header className={styles.documentMetaCard}>
                    {documentState.meta.coverSrc ? (
                      <Image
                        alt={`Capa de ${documentState.meta.title ?? documentState.label}`}
                        className={styles.documentCover}
                        src={documentState.meta.coverSrc}
                        unoptimized
                        width={118}
                        height={170}
                      />
                    ) : null}

                    <div className={styles.documentMetaCopy}>
                      <p className={styles.documentMetaEyebrow}>
                        {documentState.formatLabel}
                      </p>
                      <h2 className={styles.documentMetaTitle}>
                        {documentState.meta.title ?? documentState.label}
                      </h2>
                      {documentState.meta.author ? (
                        <p className={styles.documentMetaSubtitle}>
                          {documentState.meta.author}
                        </p>
                      ) : null}
                      {documentState.meta.description ? (
                        <p className={styles.documentMetaSummary}>
                          {documentState.meta.description}
                        </p>
                      ) : null}

                      <div className={styles.documentMetaList}>
                        {documentState.meta.language ? (
                          <span className={styles.documentMetaItem}>
                            Idioma: {documentState.meta.language}
                          </span>
                        ) : null}
                        {documentState.meta.publisher ? (
                          <span className={styles.documentMetaItem}>
                            Editora: {documentState.meta.publisher}
                          </span>
                        ) : null}
                        {documentState.meta.published ? (
                          <span className={styles.documentMetaItem}>
                            Data: {documentState.meta.published}
                          </span>
                        ) : null}
                        {documentState.meta.chapterCount ? (
                          <span className={styles.documentMetaItem}>
                            Secoes: {documentState.meta.chapterCount}
                          </span>
                        ) : null}
                      </div>

                      {documentState.meta.note ? (
                        <p className={styles.documentMetaNote}>
                          {documentState.meta.note}
                        </p>
                      ) : null}
                    </div>
                  </header>
                ) : null}

                {documentState.tableOfContents?.length ? (
                  <section className={styles.documentTocPanel}>
                    <button
                      aria-expanded={isTocOpen}
                      className={styles.documentTocToggle}
                      onClick={() => setIsTocOpen((current) => !current)}
                      type="button"
                    >
                      <span>Índice</span>
                      <small>{documentState.tableOfContents.length} entradas</small>
                    </button>

                    {isTocOpen ? (
                      <div className={styles.documentTocList}>
                        {documentState.tableOfContents.map((entry) => (
                          <button
                            className={styles.documentTocItem}
                            key={entry.id}
                            onClick={() => jumpToTocEntry(entry)}
                            style={{
                              paddingLeft: `${12 + Math.min(entry.level, 4) * 14}px`,
                            }}
                            type="button"
                          >
                            {entry.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </section>
                ) : null}

                {isDocumentEditing ? (
                  <textarea
                    aria-label="Editor de texto do documento"
                    className={styles.documentEditor}
                    onChange={(event) => setDocumentEditorValue(event.target.value)}
                    spellCheck={false}
                    value={documentEditorValue}
                  />
                ) : (
                  <article
                    className={styles.htmlDocument}
                    dangerouslySetInnerHTML={{ __html: documentState.html }}
                  />
                )}
              </div>
            )}

            {viewerError ? (
              <div className={styles.viewerError}>
                <div>
                  <strong>Houve um erro no documento.</strong>
                  <p>{viewerError}</p>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <section className={styles.notesPanel}>
        <div className={styles.notesHeader}>
          <h2>Anotações</h2>
          <div className={styles.notesActions}>
            <button
              disabled={!readerNotes.trim()}
              onClick={exportNotesAsText}
              type="button"
            >
              TXT
            </button>
            <button
              disabled={!readerNotes.trim()}
              onClick={exportNotesAsDocx}
              type="button"
            >
              DOCX
            </button>
            <button
              disabled={!readerNotes.trim()}
              onClick={exportNotesAsPdf}
              type="button"
            >
              PDF
            </button>
          </div>
        </div>
        <textarea
          aria-label="Anotações de leitura"
          className={styles.notesTextarea}
          onChange={(event) => setReaderNotes(event.target.value)}
          placeholder="Não se preocupe: suas notas ficam salvas aqui."
          value={readerNotes}
        />
      </section>

      {tooltip && !showInspector ? (
        <div
          className={`${styles.tooltip} ${isTooltipDragging ? styles.tooltipDragging : ""}`}
          ref={tooltipRef}
          tabIndex={-1}
          style={{
            left: tooltip.x,
            maxHeight: tooltip.maxHeight,
            top: tooltip.y,
            width: tooltip.width,
          }}
        >
          {renderTooltipPanel()}
        </div>
      ) : null}
    </section>
  );
}

