import { openDB, type IDBPDatabase } from 'idb';
import type { Notebook } from './notebookTypes';

const DB_NAME = 'mcp-notebooks';
const DB_VERSION = 1;
const STORE_NAME = 'notebooks';

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

export async function getAllNotebooks(): Promise<Notebook[]> {
  const db = await getDb();
  return db.getAll(STORE_NAME);
}

export async function getNotebook(id: string): Promise<Notebook | undefined> {
  const db = await getDb();
  return db.get(STORE_NAME, id);
}

export async function saveNotebook(notebook: Notebook): Promise<void> {
  const db = await getDb();
  await db.put(STORE_NAME, notebook);
}

export async function deleteNotebook(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE_NAME, id);
}
