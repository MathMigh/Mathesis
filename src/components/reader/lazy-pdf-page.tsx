"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Page } from "react-pdf";
import styles from "../pdf-reader-app.module.css";

const PDF_PAGE_ROOT_MARGIN = "700px 0px 900px 0px";

export const PDF_EAGER_PAGE_COUNT = 2;

type LazyPdfPageProps = {
  eager?: boolean;
  pageNumber: number;
  rootRef: RefObject<HTMLElement | null>;
  width: number;
};

export function LazyPdfPage({
  eager = false,
  pageNumber,
  rootRef,
  width,
}: LazyPdfPageProps) {
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
