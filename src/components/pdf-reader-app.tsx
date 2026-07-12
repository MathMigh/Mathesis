"use client";

import {
  startTransition,
  useEffect,
  useEffectEvent,
  useReducer,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  describeDocumentForChip,
  extractEditableText,
  getDocumentFormatLabel,
  loadReaderDocument,
  replaceHtmlDocumentText,
  SUPPORTED_DOCUMENT_ACCEPT,
  type ReaderDocument,
  type ReaderTocEntry,
} from "@/lib/local-reader-documents";
import {
  createLoadingSource,
  createUnavailableSource,
} from "@/lib/lookup-source-config";
import {
  detectLookupLanguage,
  type LookupLanguage,
} from "@/lib/lookup-language";
import {
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
  buildLookupContext,
  buildManualEmptyPayload,
  fetchLookupSourceResult,
  isInlineSearchSource,
  seedInlineSourceState,
} from "./reader/lookup-request";
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
  createDocxBlob,
  downloadBlob,
  resolveInitialNotes,
  sanitizeFileStem,
} from "./reader/notes-export";
import { NotesPanel } from "./reader/notes-panel";
import { ReaderDocumentView } from "./reader/reader-document-view";
import { ReaderToolbar } from "./reader/reader-toolbar";
import styles from "./pdf-reader-app.module.css";

const THEME_STORAGE_KEY = "pdf-reader-theme";
const NOTES_STORAGE_KEY = "mathesis-reader-notes";
const READER_SCROLL_PERSIST_INTERVAL_MS = 350;

type ReaderTheme = "day" | "night";
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
  const cacheRef = useRef<Map<string, LookupPayload>>(new Map());
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
      }).catch(() => {
        // Session persistence is best-effort and should never delay the reader.
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
    const preferredDocumentLanguage =
      tooltip?.contextOverrides?.documentLanguage === "english" ||
      tooltip?.contextOverrides?.documentLanguage === "latin" ||
      tooltip?.contextOverrides?.documentLanguage === "portuguese"
        ? tooltip.contextOverrides.documentLanguage
        : documentState?.meta.language;
    const initialLanguage =
      preferredDocumentLanguage === "english" ||
      preferredDocumentLanguage === "latin" ||
      preferredDocumentLanguage === "portuguese"
        ? preferredDocumentLanguage
        : detectLookupLanguage(initialWord || "amor", {
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
      void saveReaderSessionFile(nextFile).catch(() => {
        // File persistence is best-effort and should never block opening the document.
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
      const deferredSourceIds: DictionarySourceId[] = sourceIds.filter((sourceId) =>
        sourceId === "corpus" || sourceId === "imagens",
      );
      const prioritySourceIds = sourceIds.filter(
        (sourceId) => !deferredSourceIds.includes(sourceId),
      );
      const initialSourceIds =
        prioritySourceIds.length > 0
          ? prioritySourceIds
          : sourceIds.slice(0, Math.min(sourceIds.length, 1));
      const backgroundSourceIds =
        prioritySourceIds.length > 0
          ? deferredSourceIds
          : sourceIds.slice(initialSourceIds.length);
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

      const priorityBatch = fetchSourceBatch(initialSourceIds);

      await Promise.race([
        priorityBatch,
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, 650);
        }),
      ]);

      if (controller.signal.aborted) {
        return;
      }

      if (backgroundSourceIds.length === 0) {
        await priorityBatch;

        if (controller.signal.aborted) {
          return;
        }

        finalizeTooltipPayload("ready");
        return;
      }

      finalizeTooltipPayload("loading");

      void (async () => {
        await Promise.allSettled([
          priorityBatch,
          fetchSourceBatch(backgroundSourceIds),
        ]);

        if (controller.signal.aborted) {
          return;
        }

        finalizeTooltipPayload("ready");
      })();
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

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
    let cancelled = false;

    const restoreSession = () => {
      void (async () => {
        let savedState = null;

        try {
          savedState = await loadReaderSessionState();
        } catch {
          savedState = null;
        }

        if (cancelled) {
          return;
        }

        if (savedState?.position) {
          restorePositionRef.current = savedState.position;
        }

        restoreEditedTextRef.current = savedState?.editedText ?? null;
        let savedFile: File | null = null;

        try {
          savedFile = await loadReaderSessionFile();
        } catch {
          savedFile = null;
        }

        if (cancelled || !savedFile) {
          return;
        }

        await ingestFile(savedFile, { restoreFromSession: true });
      })();
    };

    if (typeof window.requestIdleCallback === "function") {
      const idleId = window.requestIdleCallback(restoreSession, {
        timeout: 1200,
      });

      return () => {
        cancelled = true;
        window.cancelIdleCallback?.(idleId);
      };
    }

    const timeoutId = globalThis.setTimeout(restoreSession, 120);

    return () => {
      cancelled = true;
      globalThis.clearTimeout(timeoutId);
    };
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
        if (nextPosition.kind === "pdf") {
          stage.scrollTop = nextPosition.scrollTop;
          return;
        }

        scrollToPdfPage(stage, 1);
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

        queuePersistReaderState({
          kind: documentState.kind,
          scrollTop: stage.scrollTop,
        });
      });
    };

    stage.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      stage.removeEventListener("scroll", onScroll);
    };
  }, [documentState]);

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
      setPageWidth(Math.max(320, Math.min(1320, baseWidth)));
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
  const explicitLookupLanguage =
    tooltip?.contextOverrides?.documentLanguage === "english" ||
    tooltip?.contextOverrides?.documentLanguage === "latin" ||
    tooltip?.contextOverrides?.documentLanguage === "portuguese"
      ? tooltip.contextOverrides.documentLanguage
      : null;
  const sourceDerivedLookupLanguage = visibleSources.some((source) =>
    ["johnson", "webster", "wiktionary", "infopedia_enpt", "english_analogico"].includes(
      source.sourceId,
    ),
  )
    ? "english"
    : visibleSources.some((source) =>
          ["faria", "logeion", "tabelas"].includes(source.sourceId),
        )
      ? "latin"
      : null;
  const inferredLookupLanguage = tooltip?.word
    ? detectLookupLanguage(tooltip.word, {
        ...tooltip.contextOverrides,
        documentLanguage:
          explicitLookupLanguage ?? tooltip?.contextOverrides?.documentLanguage,
      })
    : null;
  const currentLookupLanguage =
    explicitLookupLanguage ??
    inferredLookupLanguage ??
    sourceDerivedLookupLanguage ??
    manualLookupLanguage;
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

        const context = {
          ...buildLookupContext(documentState, undefined, tooltip?.contextOverrides),
          documentLanguage: panelLookupLanguage,
        };

        await Promise.allSettled(
          searchableSources.map(async (source) => {
            let result: DictionarySourceResult;

            try {
              result = await fetchLookupSourceResult(
                trimmedQuery,
                source.sourceId,
                context,
                controller.signal,
              );
            } catch {
              if (controller.signal.aborted) {
                throw new Error("aborted");
              }

              result = createUnavailableSource(
                trimmedQuery,
                source.sourceId,
                "Nao consegui atualizar esta busca agora.",
                context,
              );
            }

            if (controller.signal.aborted) {
              return;
            }

            setSourceSearchResults((current) => ({
              ...current,
              [result.sourceId]: result,
            }));

            setSourceSearchLoading((current) => ({
              ...current,
              [source.sourceId]: false,
            }));
          }),
        );

        if (!controller.signal.aborted) {
          setSourceSearchLoading((current) => {
            const next = { ...current };

            for (const source of searchableSources) {
              next[source.sourceId] = false;
            }

            return next;
          });
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
      <ReaderToolbar
        accept={SUPPORTED_DOCUMENT_ACCEPT}
        canEditDocumentText={canEditDocumentText}
        documentFormatChip={documentFormatChip}
        documentLabel={documentState ? documentState.label : "Nenhum arquivo carregado"}
        documentSummaryChip={documentSummaryChip}
        isDocumentEditing={isDocumentEditing}
        onFileSelected={ingestFile}
        onOpenManualLookup={openManualLookup}
        onToggleDocumentEditing={toggleDocumentEditing}
        onToggleTheme={() =>
          setTheme((currentTheme) => (currentTheme === "night" ? "day" : "night"))
        }
        theme={theme}
      />

      <div className={`${styles.frame} ${isExpanded ? styles.frameExpanded : ""}`}>
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

          <ReaderDocumentView
            accept={SUPPORTED_DOCUMENT_ACCEPT}
            documentEditorValue={documentEditorValue}
            documentLoadingLabel={documentLoadingLabel}
            documentState={documentState}
            isDocumentEditing={isDocumentEditing}
            isDragging={isDragging}
            isTocOpen={isTocOpen}
            numPages={numPages}
            onDocumentEditorValueChange={setDocumentEditorValue}
            onDragStateChange={setIsDragging}
            onFileSelected={ingestFile}
            onJumpToTocEntry={jumpToTocEntry}
            onPdfItemClick={(pageNumber) =>
              scrollToPdfPage(viewerSurfaceRef.current, pageNumber)
            }
            onPdfLoadError={(message) => {
              setNumPages(0);
              setViewerError(message);
            }}
            onPdfLoadSuccess={(pageCount) => {
              setNumPages(pageCount);
              setViewerError(null);
            }}
            onToggleToc={() => setIsTocOpen((current) => !current)}
            pageWidth={pageWidth}
            viewerError={viewerError}
            viewerSurfaceRef={viewerSurfaceRef}
          />
        </div>
      </div>

      <NotesPanel
        notes={readerNotes}
        onChange={setReaderNotes}
        onExportDocx={exportNotesAsDocx}
        onExportPdf={exportNotesAsPdf}
        onExportText={exportNotesAsText}
      />

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
