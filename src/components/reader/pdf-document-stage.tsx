"use client";

import { useEffect, type RefObject } from "react";
import { Document, pdfjs } from "react-pdf";

import type { ReaderDocument } from "@/lib/local-reader-documents";

import styles from "../pdf-reader-app.module.css";
import { LazyPdfPage, PDF_EAGER_PAGE_COUNT } from "./lazy-pdf-page";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

type PdfDocumentStageProps = {
  documentState: Extract<ReaderDocument, { kind: "pdf" }>;
  numPages: number;
  pageWidth: number;
  onPdfItemClick: (pageNumber: number | null | undefined) => void;
  onPdfLoadError: (message: string) => void;
  onPdfLoadSuccess: (pageCount: number) => void;
  viewerSurfaceRef: RefObject<HTMLDivElement | null>;
};

export function PdfDocumentStage({
  documentState,
  numPages,
  pageWidth,
  onPdfItemClick,
  onPdfLoadError,
  onPdfLoadSuccess,
  viewerSurfaceRef,
}: PdfDocumentStageProps) {
  useEffect(() => {
    return () => {
      onPdfLoadSuccess(0);
    };
  }, [onPdfLoadSuccess]);

  return (
    <div className={styles.documentArea}>
      <Document
        error={
          <div className={styles.viewerError}>
            <div>
              <strong>Nao consegui abrir esse arquivo PDF.</strong>
              <p>
                Tente um arquivo com texto selecionavel ou verifique se ele nao
                esta protegido.
              </p>
            </div>
          </div>
        }
        file={documentState.file}
        loading={<div className={styles.viewerLoading}>Carregando PDF...</div>}
        onItemClick={({ pageNumber }) => onPdfItemClick(pageNumber)}
        onLoadError={(error) => onPdfLoadError(error.message)}
        onLoadSuccess={(pdf) => onPdfLoadSuccess(pdf.numPages)}
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
  );
}
