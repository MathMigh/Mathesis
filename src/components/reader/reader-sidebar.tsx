"use client";

import styles from "../pdf-reader-app.module.css";

type ReaderSidebarProps = {
  accept: string;
  isDragging: boolean;
  supportedDocumentSummary: string;
  onDragStateChange: (isDragging: boolean) => void;
  onFileSelected: (file: File | null) => void;
  onLoadSamplePdf: () => void;
};

export function ReaderSidebar({
  accept,
  isDragging,
  supportedDocumentSummary,
  onDragStateChange,
  onFileSelected,
  onLoadSamplePdf,
}: ReaderSidebarProps) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.panel}>
        <p className={styles.panelLabel}>Seu arquivo</p>
        <label
          className={`${styles.dropzone} ${isDragging ? styles.dropzoneActive : ""}`}
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
        >
          <strong>Arraste um arquivo aqui ou clique para escolher.</strong>
          <p>
            O documento fica no navegador. Este leitor aceita{" "}
            {supportedDocumentSummary}. As consultas lexicais, etimologicas,
            gramaticais, mitologicas, visuais e de corpus aparecem so quando voce
            seleciona uma palavra.
          </p>
          <input
            accept={accept}
            className={styles.hiddenInput}
            onChange={(event) => onFileSelected(event.target.files?.[0] ?? null)}
            type="file"
          />
        </label>
        <button className={styles.sampleButton} onClick={onLoadSamplePdf} type="button">
          Abrir PDF de exemplo
        </button>
      </div>

      <div className={styles.panel}>
        <p className={styles.panelLabel}>Formatos e leitura</p>
        <div className={styles.helperList}>
          <div className={styles.helperItem}>
            <strong>E-books</strong>
            <span>EPUB, MOBI, AZW/AZW3 e FB2 entram como texto selecionavel no painel.</span>
          </div>
          <div className={styles.helperItem}>
            <strong>Documentos</strong>
            <span>
              PDF, EPUB, MOBI, AZW3, FB2, DOCX, TXT e HTML entram como texto
              selecionável.
              <br />
              <br />
              Depois, basta selecionar uma palavra para que a mágica aconteça.
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
              A aba Mitologia consulta uma base mitológica curada e monta notas
              de apoio durante a leitura.
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
            <span>KFX e alguns arquivos Kindle com DRM ainda podem falhar no navegador.</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
