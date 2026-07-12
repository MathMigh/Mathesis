"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import { type RefObject } from "react";

import type { ReaderDocument, ReaderTocEntry } from "@/lib/local-reader-documents";

import styles from "../pdf-reader-app.module.css";

const PdfDocumentStage = dynamic(
  () => import("./pdf-document-stage").then((module) => module.PdfDocumentStage),
  {
    loading: () => (
      <div className={styles.viewerLoading}>Carregando visualizador do PDF...</div>
    ),
    ssr: false,
  },
);

type ReaderDocumentViewProps = {
  accept: string;
  documentEditorValue: string;
  documentLoadingLabel: string | null;
  documentState: ReaderDocument | null;
  isDocumentEditing: boolean;
  isDragging: boolean;
  isTocOpen: boolean;
  numPages: number;
  pageWidth: number;
  viewerError: string | null;
  viewerSurfaceRef: RefObject<HTMLDivElement | null>;
  onDocumentEditorValueChange: (value: string) => void;
  onDragStateChange: (isDragging: boolean) => void;
  onFileSelected: (file: File | null) => void;
  onJumpToTocEntry: (entry: ReaderTocEntry) => void;
  onPdfItemClick: (pageNumber: number | null | undefined) => void;
  onPdfLoadError: (message: string) => void;
  onPdfLoadSuccess: (pageCount: number) => void;
  onToggleToc: () => void;
};

export function ReaderDocumentView({
  accept,
  documentEditorValue,
  documentLoadingLabel,
  documentState,
  isDocumentEditing,
  isDragging,
  isTocOpen,
  numPages,
  pageWidth,
  viewerError,
  viewerSurfaceRef,
  onDocumentEditorValueChange,
  onDragStateChange,
  onFileSelected,
  onJumpToTocEntry,
  onPdfItemClick,
  onPdfLoadError,
  onPdfLoadSuccess,
  onToggleToc,
}: ReaderDocumentViewProps) {
  return (
    <div
      className={`${styles.viewerStage} ${
        !documentState && !documentLoadingLabel ? styles.viewerStageEmpty : ""
      } ${isDragging ? styles.viewerStageDragging : ""}`}
      onDragEnter={() => onDragStateChange(true)}
      onDragLeave={() => onDragStateChange(false)}
      onDragOver={(event) => {
        event.preventDefault();
        onDragStateChange(true);
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDragStateChange(false);
        onFileSelected(event.dataTransfer.files[0] ?? null);
      }}
      ref={viewerSurfaceRef}
    >
      {documentLoadingLabel ? (
        <div className={styles.viewerLoading}>
          <div>
            <strong>Preparando a leitura.</strong>
            <p>{documentLoadingLabel}</p>
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
              accept={accept}
              className={styles.hiddenInput}
              onChange={(event) => onFileSelected(event.target.files?.[0] ?? null)}
              type="file"
            />
          </label>
        </div>
      ) : documentState.kind === "pdf" ? (
        <PdfDocumentStage
          documentState={documentState}
          numPages={numPages}
          onPdfItemClick={onPdfItemClick}
          onPdfLoadError={onPdfLoadError}
          onPdfLoadSuccess={onPdfLoadSuccess}
          pageWidth={pageWidth}
          viewerSurfaceRef={viewerSurfaceRef}
        />
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
                  <p className={styles.documentMetaNote}>{documentState.meta.note}</p>
                ) : null}
              </div>
            </header>
          ) : null}

          {documentState.tableOfContents?.length ? (
            <section className={styles.documentTocPanel}>
              <button
                aria-expanded={isTocOpen}
                className={styles.documentTocToggle}
                onClick={onToggleToc}
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
                      onClick={() => onJumpToTocEntry(entry)}
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
              onChange={(event) => onDocumentEditorValueChange(event.target.value)}
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
  );
}
