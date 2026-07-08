"use client";

import styles from "../pdf-reader-app.module.css";

type ReaderTheme = "day" | "night";

type ReaderToolbarProps = {
  accept: string;
  canEditDocumentText: boolean;
  documentFormatChip: string;
  documentLabel: string;
  documentSummaryChip: string;
  isDocumentEditing: boolean;
  onFileSelected: (file: File | null) => void;
  onOpenManualLookup: () => void;
  onToggleDocumentEditing: () => void;
  onToggleTheme: () => void;
  theme: ReaderTheme;
};

export function ReaderToolbar({
  accept,
  canEditDocumentText,
  documentFormatChip,
  documentLabel,
  documentSummaryChip,
  isDocumentEditing,
  onFileSelected,
  onOpenManualLookup,
  onToggleDocumentEditing,
  onToggleTheme,
  theme,
}: ReaderToolbarProps) {
  return (
    <div className={styles.toolbar}>
      <div className={styles.toolbarMeta}>
        <span className={styles.chip}>{documentLabel}</span>
        <span className={styles.chip}>{documentFormatChip}</span>
        <span className={styles.chip}>{documentSummaryChip}</span>
      </div>
      <div className={styles.toolbarAside}>
        <p className={styles.toolbarHint}>Abra um arquivo e selecione a palavra que desejar.</p>
        <div className={styles.toolbarControls}>
          {canEditDocumentText ? (
            <button
              className={styles.themeToggle}
              onClick={onToggleDocumentEditing}
              type="button"
            >
              <span className={styles.themeToggleLabel}>Texto</span>
              <strong>{isDocumentEditing ? "Salvar edição" : "Editar texto"}</strong>
            </button>
          ) : null}
          <button className={styles.themeToggle} onClick={onOpenManualLookup} type="button">
            <span className={styles.themeToggleLabel}>Painel</span>
            <strong>Abrir popup</strong>
          </button>
          <label className={styles.uploadButton}>
            <span className={styles.themeToggleLabel}>Arquivo</span>
            <strong>Escolher</strong>
            <input
              accept={accept}
              className={styles.hiddenInput}
              onChange={(event) => onFileSelected(event.target.files?.[0] ?? null)}
              type="file"
            />
          </label>
          <button
            aria-label={theme === "night" ? "Voltar ao modo claro" : "Ativar modo noturno"}
            aria-pressed={theme === "night"}
            className={styles.themeToggle}
            onClick={onToggleTheme}
            type="button"
          >
            <span className={styles.themeToggleLabel}>Tema</span>
            <strong>{theme === "night" ? "Noturno" : "Claro"}</strong>
          </button>
        </div>
      </div>
    </div>
  );
}
