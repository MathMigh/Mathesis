"use client";

import dynamic from "next/dynamic";
import styles from "./pdf-reader-mount.module.css";

const PdfReaderApp = dynamic(() => import("./pdf-reader-app"), {
  ssr: false,
  loading: () => (
    <div className={styles.loadingCard}>
      <p>Preparando o leitor...</p>
    </div>
  ),
});

export default function PdfReaderMount() {
  return <PdfReaderApp />;
}
