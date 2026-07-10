# Mathesis

Mathesis is a Next.js reader for close reading with lexical panels. It opens local
documents, lets the reader select a word, and shows dictionary, grammar,
etymology, mythology, corpus, image, and reference material without leaving the
page.

## Current Scope

The main app focuses on:

- Portuguese reading support with Aulete, Priberam, Infopedia, grammar, analogy,
  corpus, Wikipedia, etymology, mythology, and images.
- Latin reading support with Logeion, Ernesto Faria, Latin tables, and corpus.
- English reading support with historical dictionaries, etymology, mythology,
  corpus, Wikipedia, images, and English-Portuguese references.
- Local document formats: PDF, EPUB, MOBI, AZW3, FB2, DOCX, TXT, and HTML.
- Persistent local reader state: notes, edited text, and reader position.

## Project Layout

```text
src/app/                  Next.js routes and API handlers
src/components/           React UI components
src/components/reader/    Reader-specific helpers split out of the main UI
src/lib/                  Lookup clients, corpus loaders, parsers, and data access
data/                     Local indexes and corpus data used by lookup sources
scripts/                  Offline data preparation and OCR/index helpers
public/                   Static validation fixtures and small public assets
```

The biggest UI surface is still `src/components/pdf-reader-app.tsx`, but its
most mechanical responsibilities have been moved into focused helpers under
`src/components/reader/`:

- `tooltip-geometry.ts`: selection normalization, tooltip placement, and drag
  position handling.
- `lookup-display.ts`: display-safe labels, markdown-to-HTML formatting, source
  navigation helpers, and loading payloads.
- `lookup-cache.ts`: browser lookup-cache policy and localStorage persistence.
- `source-search-state.ts`: reducer for per-source search boxes.
- `notes-export.ts`: note download, DOCX generation, and notes bootstrap.

## Environment Variables

Do not commit real keys. Use `.env.local` locally and Vercel environment
variables in production.

```env
AI_API_KEY=
AI_API_KEYS=
AI_MODEL=
AI_IMAGE_MODEL=
GOOGLE_CSE_API_KEY=
GOOGLE_CSE_ID=
PIXABAY_API_KEY=
PEXELS_API_KEY=
UNSPLASH_ACCESS_KEY=
```

Multiple Gemini keys can be supplied through `AI_API_KEYS` or `GEMINI_API_KEYS`
as comma-, semicolon-, or newline-separated values. The runtime cycles through
the available keys when a source receives rate-limit or transient API failures.

## Large Files

The repository uses Git LFS for large local data:

- `data/porto-latim.pdf`
- `data/portuguese-corpus/corpus.json`
- `data/portuguese-corpus/corpus.json.gz`

Install Git LFS before cloning or pushing large-data updates:

```bash
git lfs install
```

## Development

```bash
npm install
npm run dev
```

The app defaults to `http://localhost:3000`. If another process is using the
port, Next.js will offer another local port.

## Verification

Before pushing changes, run:

```bash
npm run lint -- --quiet
npm run build
```

Also run a quick secret scan before public commits:

```bash
rg -n "known-key-prefix|secret-token|apikey" src data scripts README.md .env.example
```

The expected matches are environment-variable names and code references, not
literal secret values.

## Notes For Maintainers

- Keep lookup source behavior in `src/lib/` whenever possible; keep React
  components focused on state orchestration and rendering.
- Keep source labels centralized in `src/lib/lookup-source-config.ts`.
- Avoid adding raw OCR dumps directly to UI code. Put generated data in `data/`
  and parsing/indexing logic in `scripts/` or `src/lib/`.
- Do not cache negative results for volatile web sources unless the source is
  known to be stable.
- If a new source needs credentials, read them from environment variables only.
