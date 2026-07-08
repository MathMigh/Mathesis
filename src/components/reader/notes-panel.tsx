"use client";

import styles from "../pdf-reader-app.module.css";

type NotesPanelProps = {
  notes: string;
  onChange: (notes: string) => void;
  onExportDocx: () => void;
  onExportPdf: () => void;
  onExportText: () => void;
};

export function NotesPanel({
  notes,
  onChange,
  onExportDocx,
  onExportPdf,
  onExportText,
}: NotesPanelProps) {
  const hasNotes = Boolean(notes.trim());

  return (
    <section className={styles.notesPanel}>
      <div className={styles.notesHeader}>
        <h2>Anotações</h2>
        <div className={styles.notesActions}>
          <button disabled={!hasNotes} onClick={onExportText} type="button">
            TXT
          </button>
          <button disabled={!hasNotes} onClick={onExportDocx} type="button">
            DOCX
          </button>
          <button disabled={!hasNotes} onClick={onExportPdf} type="button">
            PDF
          </button>
        </div>
      </div>
      <textarea
        aria-label="Anotações de leitura"
        className={styles.notesTextarea}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Não se preocupe: suas notas ficam salvas aqui."
        value={notes}
      />
    </section>
  );
}
