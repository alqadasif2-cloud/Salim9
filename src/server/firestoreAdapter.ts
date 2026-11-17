import fs from 'fs';
import path from 'path';
import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  limitToLast,
  getCountFromServer,
  writeBatch,
  type Firestore,
  type QueryConstraint,
  type DocumentReference,
  type CollectionReference,
  type Query,
} from 'firebase/firestore';

function stripUndefinedDeep(value: any): any {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((v) => (v === undefined ? null : stripUndefinedDeep(v)));
  }
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v !== undefined) {
      out[k] = stripUndefinedDeep(v);
    }
  }
  return out;
}

class DocRefWrapper {
  private db: Firestore;
  private pathSegments: string[];

  constructor(db: Firestore, pathSegments: string[]) {
    this.db = db;
    this.pathSegments = pathSegments;
  }

  get rawRef(): DocumentReference {
    return doc(this.db, this.pathSegments[0], ...this.pathSegments.slice(1));
  }

  collection(subName: string): CollectionWrapper {
    return new CollectionWrapper(this.db, [...this.pathSegments, subName], []);
  }

  async get() {
    const snap = await getDoc(this.rawRef);
    return {
      exists: snap.exists(),
      id: snap.id,
      data: () => snap.data(),
    };
  }

  async set(data: Record<string, any>, options?: { merge?: boolean }) {
    const clean = stripUndefinedDeep(data) || {};
    if (options?.merge) {
      await setDoc(this.rawRef, clean, { merge: true });
    } else {
      await setDoc(this.rawRef, clean);
    }
  }

  async delete() {
    await deleteDoc(this.rawRef);
  }
}

class CollectionWrapper {
  private db: Firestore;
  private pathSegments: string[];
  private constraints: QueryConstraint[];

  constructor(db: Firestore, pathSegments: string[], constraints: QueryConstraint[]) {
    this.db = db;
    this.pathSegments = pathSegments;
    this.constraints = constraints;
  }

  private get baseCollection(): CollectionReference {
    return collection(this.db, this.pathSegments[0], ...this.pathSegments.slice(1));
  }

  private buildQuery(): Query {
    if (this.constraints.length === 0) return this.baseCollection;
    return query(this.baseCollection, ...this.constraints);
  }

  doc(docId: string): DocRefWrapper {
    return new DocRefWrapper(this.db, [...this.pathSegments, String(docId)]);
  }

  where(field: string, op: any, value: any): CollectionWrapper {
    return new CollectionWrapper(this.db, this.pathSegments, [
      ...this.constraints,
      where(field, op, value),
    ]);
  }

  orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): CollectionWrapper {
    return new CollectionWrapper(this.db, this.pathSegments, [
      ...this.constraints,
      orderBy(field, direction),
    ]);
  }

  limit(n: number): CollectionWrapper {
    return new CollectionWrapper(this.db, this.pathSegments, [
      ...this.constraints,
      limit(n),
    ]);
  }

  limitToLast(n: number): CollectionWrapper {
    return new CollectionWrapper(this.db, this.pathSegments, [
      ...this.constraints,
      limitToLast(n),
    ]);
  }

  count() {
    const q = this.buildQuery();
    return {
      get: async () => {
        const snap = await getCountFromServer(q);
        return {
          data: () => ({ count: snap.data().count }),
        };
      },
    };
  }

  async get() {
    const snap = await getDocs(this.buildQuery());
    const wrappedDocs = snap.docs.map((d) => ({
      id: d.id,
      data: () => d.data(),
    }));
    return {
      empty: snap.empty,
      size: snap.size,
      docs: wrappedDocs,
      forEach: (cb: (doc: { id: string; data: () => any }) => void) => {
        wrappedDocs.forEach(cb);
      },
    };
  }
}

export class WebSdkFirestoreAdapter {
  private db: Firestore;

  constructor(db: Firestore) {
    this.db = db;
  }

  collection(name: string): CollectionWrapper {
    return new CollectionWrapper(this.db, [name], []);
  }

  batch() {
    const b = writeBatch(this.db);
    return {
      set: (docRef: DocRefWrapper, data: Record<string, any>, options?: { merge?: boolean }) => {
        const clean = stripUndefinedDeep(data) || {};
        if (options?.merge) {
          b.set(docRef.rawRef, clean, { merge: true });
        } else {
          b.set(docRef.rawRef, clean);
        }
      },
      delete: (docRef: DocRefWrapper) => {
        b.delete(docRef.rawRef);
      },
      commit: async () => {
        await b.commit();
      },
    };
  }
}

let cachedAdapter: WebSdkFirestoreAdapter | null = null;

export function createWebSdkFirestoreClient(): WebSdkFirestoreAdapter | null {
  if (cachedAdapter) return cachedAdapter;
  try {
    const configPath = path.resolve('firebase-applet-config.json');
    if (!fs.existsSync(configPath)) return null;
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!cfg?.projectId || !cfg?.apiKey) return null;

    const appName = 'salim-server-firestore';
    const existing = getApps().find((a) => a.name === appName);
    const app: FirebaseApp = existing
      ? getApp(appName)
      : initializeApp(
          {
            apiKey: cfg.apiKey,
            authDomain: cfg.authDomain,
            projectId: cfg.projectId,
            storageBucket: cfg.storageBucket,
            messagingSenderId: cfg.messagingSenderId,
            appId: cfg.appId,
          },
          appName
        );

    const dbId =
      cfg.firestoreDatabaseId && cfg.firestoreDatabaseId !== '(default)'
        ? cfg.firestoreDatabaseId
        : undefined;
    const db = dbId ? getFirestore(app, dbId) : getFirestore(app);
    cachedAdapter = new WebSdkFirestoreAdapter(db);
    console.log(
      `[Salim DB] Firebase Web SDK Firestore client initialized for project: ${cfg.projectId}, database: ${dbId || '(default)'}`
    );
    return cachedAdapter;
  } catch (err: any) {
    console.warn('[Salim DB] Web SDK Firestore init notice:', err?.message || err);
    return null;
  }
}
