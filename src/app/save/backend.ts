/**
 * Key-value persistence backends. Each `write` is atomic: either every entry is stored or none.
 * IndexedDB is preferred; localStorage and memory are fallbacks (e.g. storage disabled).
 */
export interface SaveBackend {
  readonly kind: 'indexeddb' | 'localstorage' | 'memory';
  get(key: string): Promise<unknown>;
  /** Atomically writes all entries. `transform` may compute them from current values in the same transaction. */
  write(entries: Record<string, unknown>, keepPreviousAs?: { key: string; from: string }): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

const DB_NAME = 'starman-reborn';
const DB_VERSION = 1;
const STORE = 'kv';

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export class IndexedDbBackend implements SaveBackend {
  readonly kind = 'indexeddb' as const;
  private dbPromise: Promise<IDBDatabase> | null = null;
  private readonly factory: IDBFactory;

  constructor(factory: IDBFactory = indexedDB) {
    this.factory = factory;
  }

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const request = this.factory.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          // Schema v1: a single key-value store. Future schema changes add upgrade steps here.
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        };
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => db.close();
          resolve(db);
        };
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('IndexedDB open blocked by another tab'));
      });
      this.dbPromise.catch(() => {
        this.dbPromise = null;
      });
    }
    return this.dbPromise;
  }

  async get(key: string): Promise<unknown> {
    const db = await this.db();
    const tx = db.transaction(STORE, 'readonly');
    return promisify(tx.objectStore(STORE).get(key));
  }

  async write(entries: Record<string, unknown>, keepPreviousAs?: { key: string; from: string }): Promise<void> {
    const db = await this.db();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('save transaction aborted'));
      const putAll = () => {
        for (const [key, value] of Object.entries(entries)) store.put(value, key);
      };
      if (keepPreviousAs) {
        const prev = store.get(keepPreviousAs.from);
        prev.onsuccess = () => {
          if (prev.result !== undefined) store.put(prev.result, keepPreviousAs.key);
          putAll();
        };
      } else {
        putAll();
      }
    });
  }

  async remove(keys: string[]): Promise<void> {
    const db = await this.db();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      for (const key of keys) tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

export class LocalStorageBackend implements SaveBackend {
  readonly kind = 'localstorage' as const;
  private readonly prefix = 'starman-reborn:';
  private readonly storage: Storage;

  constructor(storage: Storage = localStorage) {
    this.storage = storage;
  }

  async get(key: string): Promise<unknown> {
    const raw = this.storage.getItem(this.prefix + key);
    return raw === null ? undefined : JSON.parse(raw);
  }

  async write(entries: Record<string, unknown>, keepPreviousAs?: { key: string; from: string }): Promise<void> {
    // Serialize everything first so a failure (quota) cannot leave a partial write.
    const serialized = Object.entries(entries).map(([k, v]) => [this.prefix + k, JSON.stringify(v)] as const);
    const previous = keepPreviousAs ? this.storage.getItem(this.prefix + keepPreviousAs.from) : null;
    const snapshot = serialized.map(([k]) => [k, this.storage.getItem(k)] as const);
    try {
      if (keepPreviousAs && previous !== null) this.storage.setItem(this.prefix + keepPreviousAs.key, previous);
      for (const [k, v] of serialized) this.storage.setItem(k, v);
    } catch (err) {
      for (const [k, v] of snapshot) {
        if (v === null) this.storage.removeItem(k);
        else this.storage.setItem(k, v);
      }
      throw err;
    }
  }

  async remove(keys: string[]): Promise<void> {
    for (const key of keys) this.storage.removeItem(this.prefix + key);
  }
}

export class MemoryBackend implements SaveBackend {
  readonly kind = 'memory' as const;
  readonly data = new Map<string, unknown>();

  async get(key: string): Promise<unknown> {
    const v = this.data.get(key);
    return v === undefined ? undefined : structuredClone(v);
  }

  async write(entries: Record<string, unknown>, keepPreviousAs?: { key: string; from: string }): Promise<void> {
    if (keepPreviousAs && this.data.has(keepPreviousAs.from)) {
      this.data.set(keepPreviousAs.key, this.data.get(keepPreviousAs.from));
    }
    for (const [k, v] of Object.entries(entries)) this.data.set(k, structuredClone(v));
  }

  async remove(keys: string[]): Promise<void> {
    for (const key of keys) this.data.delete(key);
  }
}

/** Picks the most robust backend available in this browser. */
export async function detectBackend(): Promise<SaveBackend> {
  try {
    if (typeof indexedDB !== 'undefined') {
      const backend = new IndexedDbBackend();
      await backend.get('probe');
      return backend;
    }
  } catch {
    // Fall through (e.g. storage blocked in a private window).
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('starman-reborn:probe', '1');
      localStorage.removeItem('starman-reborn:probe');
      return new LocalStorageBackend();
    }
  } catch {
    // Fall through.
  }
  return new MemoryBackend();
}
