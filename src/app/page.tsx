import PdfReaderMount from "@/components/pdf-reader-mount";
import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.page}>
      <header className={styles.brandBar} aria-label="Mathesis">
        <h1>Mathesis</h1>
      </header>
      <div className={styles.shell}>
        <PdfReaderMount />
      </div>
    </main>
  );
}
