import styles from "../pdf-reader-app.module.css";

type NotesPanelProps = {
  notes: string;
  onChange: (value: string) => void;
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
  return (
    <section className={styles.notesPanel} aria-labelledby="reader-notes-title">
      <header className={styles.notesHeader}>
        <h2 id="reader-notes-title">Anotações</h2>
        <div className={styles.notesActions}>
          <button type="button" onClick={onExportText}>
            TXT
          </button>
          <button type="button" onClick={onExportDocx}>
            DOCX
          </button>
          <button type="button" onClick={onExportPdf}>
            PDF
          </button>
        </div>
      </header>

      <textarea
        aria-label="Anotações do leitor"
        className={styles.notesTextarea}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Não se preocupe: suas notas ficam salvas aqui."
        spellCheck
        value={notes}
      />
    </section>
  );
}
