// Cache de la ultima respuesta correcta de cada pantalla (IndexedDB). Si no hay conexion se muestra lo ultimo
// que se vio, con el aviso "Datos de hace X min, sin conexion".
import * as almacen from "../../core/almacen";
import { ErrorRed } from "../../core/api";

interface EntradaCache {
  clave: string;
  datos: unknown;
  guardado: number; // ms desde 1970
}

export const EVENTO_CACHE = "arca-cache-cambio";

/** Lecturas de la pantalla actual que salieron del cache (clave -> cuando se guardo). */
const desdeCache = new Map<string, number>();
const avisar = () => window.dispatchEvent(new Event(EVENTO_CACHE));

export const datosDeCache = (): number | null => (desdeCache.size ? Math.min(...desdeCache.values()) : null);
export function olvidarLecturasDeCache() {
  if (desdeCache.size) {
    desdeCache.clear();
    avisar();
  }
}
export const alCambiarCache = (f: () => void) => {
  window.addEventListener(EVENTO_CACHE, f);
  return () => window.removeEventListener(EVENTO_CACHE, f);
};

export async function leerCache<T>(clave: string): Promise<{ datos: T; guardado: number } | undefined> {
  const e = await almacen.obtener<EntradaCache>("cache", clave);
  return e ? { datos: e.datos as T, guardado: e.guardado } : undefined;
}

/**
 * Lee del servidor y guarda la respuesta; si no hay conexion devuelve la ultima guardada. Los demas errores
 * (sesion vencida, servidor caido, datos invalidos) se muestran tal cual: no se esconden con datos viejos.
 * `alLeer` se llama con lo que llego del servidor (sirve para recordar los registros individuales).
 */
export async function conCache<T>(
  clave: string,
  cargar: () => Promise<T>,
  alLeer?: (d: T) => Promise<void>,
): Promise<{ datos: T; deCache: boolean }> {
  try {
    const datos = await cargar();
    await almacen.poner<EntradaCache>("cache", { clave, datos, guardado: Date.now() });
    if (alLeer) await alLeer(datos);
    if (desdeCache.delete(clave)) avisar();
    return { datos, deCache: false };
  } catch (e) {
    if (!(e instanceof ErrorRed)) throw e;
    const guardado = await leerCache<T>(clave);
    if (!guardado) throw e;
    desdeCache.set(clave, guardado.guardado);
    avisar();
    return { datos: guardado.datos, deCache: true };
  }
}

/** "hace 5 min", "hace 2 h", "hace 3 dias" */
export function haceCuanto(desde: number, ahora = Date.now()): string {
  const min = Math.max(0, Math.round((ahora - desde) / 60000));
  if (min < 1) return "hace menos de 1 min";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return `hace ${d} ${d === 1 ? "día" : "días"}`;
}
