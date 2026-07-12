"use client";

type ReaderSessionPosition =
  | { kind: "html"; scrollTop: number }
  | { kind: "pdf"; scrollTop: number };

type ReaderSessionState = {
  editedText?: string | null;
  position?: ReaderSessionPosition | null;
};

type StoredReaderFile = {
  file: File;
};

const DB_NAME = "mathesis-reader-session";
const STORE_NAME = "session";
const FILE_KEY = "current-file";
const STATE_KEY = "current-state";
const STATE_STORAGE_KEY = "mathesis-reader-state";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, 1);

    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function readValue<T>(key: string): Promise<T | null> {
  const database = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(key);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
    transaction.oncomplete = () => database.close();
  });
}

async function writeValue(key: string, value: unknown) {
  const database = await openDatabase();

  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(value, key);

    request.onerror = () => reject(request.error);
    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
  });
}

async function deleteValue(key: string) {
  const database = await openDatabase();

  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(key);

    request.onerror = () => reject(request.error);
    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
  });
}

function canUseLocalStorage() {
  return typeof window !== "undefined" && "localStorage" in window;
}

function normalizeReaderSessionPosition(
  position: unknown,
): ReaderSessionPosition | null {
  if (!position || typeof position !== "object") {
    return null;
  }

  const candidate = position as {
    kind?: unknown;
    pageNumber?: unknown;
    scrollTop?: unknown;
  };

  if (candidate.kind === "html" && Number.isFinite(candidate.scrollTop)) {
    return {
      kind: "html",
      scrollTop: Number(candidate.scrollTop),
    };
  }

  if (candidate.kind === "pdf") {
    if (Number.isFinite(candidate.scrollTop)) {
      return {
        kind: "pdf",
        scrollTop: Number(candidate.scrollTop),
      };
    }

    if (Number.isFinite(candidate.pageNumber)) {
      const legacyPageNumber = Math.max(1, Number(candidate.pageNumber));
      return {
        kind: "pdf",
        scrollTop: Math.max(0, (legacyPageNumber - 1) * 1120),
      };
    }
  }

  return null;
}

function normalizeReaderSessionState(
  state: ReaderSessionState | null,
): ReaderSessionState | null {
  if (!state) {
    return null;
  }

  return {
    editedText: state.editedText ?? null,
    position: normalizeReaderSessionPosition(state.position),
  };
}

export async function loadReaderSessionFile() {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return null;
  }

  const payload = await readValue<StoredReaderFile>(FILE_KEY);
  return payload?.file ?? null;
}

export async function saveReaderSessionFile(file: File) {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return;
  }

  await writeValue(FILE_KEY, { file } satisfies StoredReaderFile);
}

export async function clearReaderSessionFile() {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return;
  }

  await deleteValue(FILE_KEY);
}

export async function loadReaderSessionState() {
  if (canUseLocalStorage()) {
    try {
      const rawState = window.localStorage.getItem(STATE_STORAGE_KEY);

      if (rawState) {
        return normalizeReaderSessionState(
          JSON.parse(rawState) as ReaderSessionState | null,
        );
      }
    } catch {
      window.localStorage.removeItem(STATE_STORAGE_KEY);
    }
  }

  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return null;
  }

  try {
    const state = normalizeReaderSessionState(
      await readValue<ReaderSessionState>(STATE_KEY),
    );

    if (state && canUseLocalStorage()) {
      window.localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(state));
    }

    return state;
  } catch {
    return null;
  }
}

export async function saveReaderSessionState(state: ReaderSessionState) {
  const normalizedState = normalizeReaderSessionState(state);

  if (canUseLocalStorage()) {
    try {
      if (!normalizedState) {
        window.localStorage.removeItem(STATE_STORAGE_KEY);
      } else {
        window.localStorage.setItem(
          STATE_STORAGE_KEY,
          JSON.stringify(normalizedState),
        );
      }
    } catch {
      // Ignore local storage quota errors; session persistence is best-effort.
    }
  }

  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return;
  }

  try {
    await writeValue(STATE_KEY, normalizedState);
  } catch {
    // Ignore IndexedDB write failures here; the live reader should not stall.
  }
}

export async function clearReaderSessionState() {
  if (canUseLocalStorage()) {
    window.localStorage.removeItem(STATE_STORAGE_KEY);
  }

  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return;
  }

  try {
    await deleteValue(STATE_KEY);
  } catch {
    // Ignore cleanup failures.
  }
}

export type { ReaderSessionPosition, ReaderSessionState };
