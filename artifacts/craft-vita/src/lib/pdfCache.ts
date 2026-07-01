// ─── IndexedDB PDF Cache ──────────────────────────────────────────────────────
//
// Stores PDF data-URLs keyed by project record ID.
// Using IndexedDB instead of localStorage avoids the 5 MB quota limit —
// a single A4 multi-page PDF easily exceeds it.

const IDB_NAME    = "cv_pdf_cache";
const IDB_STORE   = "pdfs";
const IDB_VERSION = 1;

function openPdfDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

export async function getPdfCache(id: string): Promise<string | null> {
  try {
    const db    = await openPdfDb();
    const tx    = db.transaction(IDB_STORE, "readonly");
    const store = tx.objectStore(IDB_STORE);
    return new Promise((resolve) => {
      const req = store.get(id);
      req.onsuccess = () =>
        resolve((req.result as { id: string; dataUrl: string } | undefined)?.dataUrl ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function setPdfCache(id: string, dataUrl: string): Promise<void> {
  try {
    const db = await openPdfDb();
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put({ id, dataUrl });
  } catch {
    // Quota exceeded or security error — silently skip
  }
}

export async function clearPdfCache(id: string): Promise<void> {
  try {
    const db = await openPdfDb();
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(id);
  } catch {
    // ignore
  }
}
