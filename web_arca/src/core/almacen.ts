// Almacen local en IndexedDB para trabajar sin internet (Fase 12): cola de operaciones, rechazos, cache de
// pantallas, copia de los registros conocidos y datos sueltos. Si IndexedDB no esta disponible (navegacion
// privada de algunos navegadores) se usa memoria: la app sigue andando pero no sobrevive a cerrar la pestana.
export type NombreAlmacen = "cola" | "rechazos" | "cache" | "entidades" | "meta";

const BASE = "arca-offline";
const VERSION = 1;
const LLAVES: Record<NombreAlmacen, { keyPath: string; autoIncrement?: boolean }> = {
  cola: { keyPath: "seq", autoIncrement: true },
  rechazos: { keyPath: "id" },
  cache: { keyPath: "clave" },
  entidades: { keyPath: "clave" },
  meta: { keyPath: "clave" },
};

let conexion: Promise<IDBDatabase | null> | null = null;
const memoria: Record<NombreAlmacen, Map<unknown, unknown>> = {
  cola: new Map(), rechazos: new Map(), cache: new Map(), entidades: new Map(), meta: new Map(),
};
let secuenciaMemoria = 0;

function abrir(): Promise<IDBDatabase | null> {
  if (conexion) return conexion;
  conexion = new Promise((resolver) => {
    if (typeof indexedDB === "undefined") return resolver(null);
    try {
      const pedido = indexedDB.open(BASE, VERSION);
      pedido.onupgradeneeded = () => {
        const db = pedido.result;
        for (const [nombre, cfg] of Object.entries(LLAVES)) if (!db.objectStoreNames.contains(nombre)) db.createObjectStore(nombre, cfg);
      };
      pedido.onsuccess = () => resolver(pedido.result);
      pedido.onerror = () => resolver(null);
      pedido.onblocked = () => resolver(null);
    } catch {
      resolver(null);
    }
  });
  return conexion;
}

function promesa<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((ok, mal) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => mal(r.error);
  });
}

async function almacen(nombre: NombreAlmacen, modo: IDBTransactionMode): Promise<IDBObjectStore | null> {
  const db = await abrir();
  return db ? db.transaction(nombre, modo).objectStore(nombre) : null;
}

const llaveDe = (nombre: NombreAlmacen, v: unknown) => (v as Record<string, unknown>)[LLAVES[nombre].keyPath];

export async function todos<T>(nombre: NombreAlmacen): Promise<T[]> {
  const s = await almacen(nombre, "readonly");
  if (!s) return [...memoria[nombre].values()] as T[];
  return promesa(s.getAll()) as Promise<T[]>;
}

export async function obtener<T>(nombre: NombreAlmacen, llave: IDBValidKey): Promise<T | undefined> {
  const s = await almacen(nombre, "readonly");
  if (!s) return memoria[nombre].get(llave) as T | undefined;
  return promesa(s.get(llave)) as Promise<T | undefined>;
}

/** Guarda (o reemplaza) un valor. En la cola, un valor nuevo sin `seq` recibe el siguiente numero de orden. */
export async function poner<T extends object>(nombre: NombreAlmacen, valor: T): Promise<T & Record<string, unknown>> {
  const s = await almacen(nombre, "readwrite");
  if (!s) {
    const v = { ...valor } as Record<string, unknown>;
    if (LLAVES[nombre].autoIncrement && v[LLAVES[nombre].keyPath] === undefined) v[LLAVES[nombre].keyPath] = ++secuenciaMemoria;
    memoria[nombre].set(llaveDe(nombre, v), v);
    return v as T & Record<string, unknown>;
  }
  const llave = await promesa(s.put(valor));
  return { ...valor, ...(LLAVES[nombre].autoIncrement ? { [LLAVES[nombre].keyPath]: llave } : {}) } as T & Record<string, unknown>;
}

export async function quitar(nombre: NombreAlmacen, llave: IDBValidKey): Promise<void> {
  const s = await almacen(nombre, "readwrite");
  if (!s) {
    memoria[nombre].delete(llave);
    return;
  }
  await promesa(s.delete(llave));
}

export async function vaciar(nombre: NombreAlmacen): Promise<void> {
  const s = await almacen(nombre, "readwrite");
  if (!s) {
    memoria[nombre].clear();
    return;
  }
  await promesa(s.clear());
}

/** Borra TODO lo guardado en el aparato (cache, registros conocidos, cola y rechazos). Se usa al cerrar sesion. */
export async function vaciarTodo(): Promise<void> {
  for (const n of Object.keys(LLAVES) as NombreAlmacen[]) await vaciar(n);
}

/** Solo para pruebas: olvida la conexion abierta para empezar con una base nueva. */
export async function reiniciarParaPruebas(): Promise<void> {
  const db = await conexion;
  db?.close();
  conexion = null;
  for (const m of Object.values(memoria)) m.clear();
  secuenciaMemoria = 0;
}
