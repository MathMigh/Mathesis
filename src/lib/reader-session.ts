"use client";

type ReaderSessionPosition =
  | { kind: "html"; scrollTop: number }
  | { kind: "pdf"; pageNumber: number };

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
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return null;
  }

  return await readValue<ReaderSessionState>(STATE_KEY);
}

export async function saveReaderSessionState(state: ReaderSessionState) {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return;
  }

  await writeValue(STATE_KEY, state);
}

export async function clearReaderSessionState() {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return;
  }

  await deleteValue(STATE_KEY);
}

export type { ReaderSessionPosition, ReaderSessionState };
