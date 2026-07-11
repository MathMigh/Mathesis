"use client";

import { useEffect, useState, type ComponentType } from "react";
import styles from "./pdf-reader-mount.module.css";

const pdfReaderAppImport =
  typeof window === "undefined" ? null : import("./pdf-reader-app");

export default function PdfReaderMount() {
  const [ReaderComponent, setReaderComponent] = useState<ComponentType | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    const importTask = pdfReaderAppImport ?? import("./pdf-reader-app");

    importTask
      .then((module) => {
        if (!isActive) {
          return;
        }

        setReaderComponent(() => module.default);
      })
      .catch((error) => {
        if (!isActive) {
          return;
        }

        const message =
          error instanceof Error ? error.message : "Nao consegui abrir o leitor agora.";

        setLoadError(message);
      });

    return () => {
      isActive = false;
    };
  }, []);

  if (ReaderComponent) {
    return <ReaderComponent />;
  }

  if (loadError) {
    return (
      <div className={styles.loadingCard}>
        <p>Nao consegui abrir o leitor agora.</p>
      </div>
    );
  }

  return (
    <div className={styles.loadingCard}>
      <p>Preparando o leitor...</p>
    </div>
  );
}
