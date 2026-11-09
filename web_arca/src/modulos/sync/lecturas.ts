// Lecturas de pantallas con cache y con las operaciones pendientes superpuestas.
import { ErrorApi, ErrorRed } from "../../core/api";
import type { Apoyo } from "../apoyos/api";
import type { Categoria } from "../familia/api";
import type { Movimiento } from "../movimientos/api";
import { conCache, leerCache } from "./cache";
import { listarOperaciones, protegerLectura, resolverReferencia } from "./cola";
import * as ent from "./entidades";
import { aplicarOperaciones, type Aplicado, type Entorno } from "./superponer";

export const CLAVE_USUARIO = "arca-usuario";

export async function entorno(): Promise<Entorno> {
  let yo = { id: 0, nombre: "" };
  try {
    const u = JSON.parse(localStorage.getItem(CLAVE_USUARIO) ?? "null") as { id: number; nombre: string } | null;
    if (u) yo = { id: u.id, nombre: u.nombre };
  } catch {
    /* sin usuario guardado */
  }
  const categorias = (await leerCache<Categoria[]>("categorias"))?.datos ?? [];
  return { yo, categorias, ids: await ent.leerIds() };
}

/** Los registros conocidos con la cola aplicada encima; null si no hay nada pendiente. */
export async function aplicadoActual(): Promise<Aplicado | null> {
  const ops = await listarOperaciones();
  if (ops.length === 0) return null;
  return aplicarOperaciones(await ent.todasLasBases(), ops, await entorno());
}

interface Opciones<T, R> {
  alLeer?: (d: T) => Promise<void>;
  superponer?: (d: T, ap: Aplicado) => R;
}

/** Lee una pantalla: del servidor (y guarda copia) o, sin conexion, la ultima copia; y le superpone la cola. */
export function leerPantalla<T, R = T>(clave: string, cargar: () => Promise<T>, o: Opciones<T, R> = {}): Promise<R> {
  return protegerLectura(async () => {
    const { datos } = await conCache(clave, cargar, o.alLeer);
    if (!o.superponer) return datos as unknown as R;
    const ap = await aplicadoActual();
    return ap ? o.superponer(datos, ap) : (datos as unknown as R);
  });
}

async function idReal(entidad: "movimiento" | "apoyo", id: number): Promise<number> {
  if (id >= 0) return id;
  const ref = await resolverReferencia(entidad, id).catch(() => null);
  return ref?.id ?? id;
}

/** Un registro por id (para abrirlo a editar): del servidor si se puede; si no, el guardado, con la cola encima. */
export function leerRegistro<T extends Movimiento | Apoyo>(
  entidad: "movimiento" | "apoyo",
  id: number,
  cargar: (id: number) => Promise<T>,
  guardar: (d: T) => Promise<void>,
): Promise<T> {
  return protegerLectura(async () => {
    const real = await idReal(entidad, id);
    if (real > 0) {
      try {
        await guardar(await cargar(real));
      } catch (e) {
        if (!(e instanceof ErrorRed)) throw e;
      }
    }
    const ap = await aplicadoActual();
    const local = ap?.finales.get(`${entidad}:${real}`) ?? (entidad === "movimiento" ? await ent.leerMovimiento(real) : await ent.leerApoyo(real));
    if (!local) throw new ErrorApi(404, "Sin conexión y este registro no está guardado en el teléfono");
    return local as T;
  });
}

/** El registro tal como se ve ahora (con la cola aplicada). */
export async function registroLocal(entidad: "movimiento" | "apoyo", id: number): Promise<Movimiento | Apoyo | undefined> {
  const real = await idReal(entidad, id);
  const ap = await aplicadoActual();
  return ap?.finales.get(`${entidad}:${real}`) ?? (entidad === "movimiento" ? await ent.leerMovimiento(real) : await ent.leerApoyo(real));
}
