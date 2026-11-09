// Copia local de los registros que el usuario ya vio (ultima version conocida del servidor). Sirve para:
//  - abrir un registro para editarlo sin conexion,
//  - saber en que version se baso el usuario (deteccion de conflictos),
//  - aplicar encima las operaciones pendientes y que el usuario las vea de inmediato.
import * as almacen from "../../core/almacen";
import type { Apoyo, Devolucion } from "../apoyos/api";
import type { Movimiento } from "../movimientos/api";
import type { ItemActividad } from "../movimientos/actividad";

interface Registro {
  clave: string;
  entidad: "movimiento" | "apoyo";
  id: number;
  /** Un apoyo conocido solo por la lista completa no trae sus devoluciones. */
  completo: boolean;
  datos: Movimiento | Apoyo;
}

export const claveDe = (entidad: "movimiento" | "apoyo", id: number) => `${entidad}:${id}`;

async function guardar(entidad: "movimiento" | "apoyo", datos: Movimiento | Apoyo, completo: boolean) {
  const clave = claveDe(entidad, datos.id);
  const previo = await almacen.obtener<Registro>("entidades", clave);
  // una version parcial (de la lista completa) no pisa una completa de la misma version: conserva las devoluciones
  if (previo && previo.completo && !completo && previo.datos.version >= datos.version) return;
  await almacen.poner<Registro>("entidades", { clave, entidad, id: datos.id, completo, datos });
}

export async function guardarMovimientos(lista: Movimiento[]) {
  for (const m of lista) await guardar("movimiento", m, true);
}
export async function guardarApoyos(lista: Apoyo[]) {
  for (const a of lista) await guardar("apoyo", a, true);
}

/** Convierte una fila de la lista completa en el registro que representa. */
export async function guardarActividad(items: ItemActividad[]) {
  for (const i of items) {
    if (i.clase === "movimiento") {
      await guardar("movimiento", {
        id: i.id, tipo: i.tipo as "gasto" | "ingreso", monto: i.monto, fecha: i.fecha, categoria_id: i.categoria_id,
        categoria_nombre: i.categoria_nombre, categoria_icono: i.categoria_icono, nota: i.nota, usuario_id: i.usuario_id,
        usuario_nombre: i.usuario_nombre, visibilidad: i.visibilidad, compartido_con: i.compartido_con, version: i.version, uuid_cliente: i.uuid_cliente, anulado: i.anulado,
        anulado_por_nombre: i.anulado_por_nombre, anulado_en: i.anulado_en, motivo_anulacion: i.motivo_anulacion,
        editado_por_nombre: i.editado_por_nombre, editado_en: i.editado_en,
      }, true);
    } else {
      await guardar("apoyo", {
        id: i.id, beneficiario: i.beneficiario ?? i.titulo, monto: i.monto, fecha: i.fecha, nota: i.nota,
        usuario_id: i.usuario_id, usuario_nombre: i.usuario_nombre, visibilidad: i.visibilidad, compartido_con: i.compartido_con, devuelto: i.devuelto ?? 0, consumido: i.consumido ?? 0,
        pendiente: i.pendiente ?? 0, estado: (i.estado ?? "Pendiente") as Apoyo["estado"], devoluciones: [],
        devoluciones_activas: i.devoluciones_activas ?? 0, version: i.version, uuid_cliente: i.uuid_cliente,
        anulado: i.anulado, anulado_por_nombre: i.anulado_por_nombre, anulado_en: i.anulado_en,
        motivo_anulacion: i.motivo_anulacion, editado_por_nombre: i.editado_por_nombre, editado_en: i.editado_en,
      }, false);
    }
  }
}

export async function leerMovimiento(id: number): Promise<Movimiento | undefined> {
  return (await almacen.obtener<Registro>("entidades", claveDe("movimiento", id)))?.datos as Movimiento | undefined;
}
export async function leerApoyo(id: number): Promise<Apoyo | undefined> {
  return (await almacen.obtener<Registro>("entidades", claveDe("apoyo", id)))?.datos as Apoyo | undefined;
}

export async function todasLasBases(): Promise<Map<string, Movimiento | Apoyo>> {
  const m = new Map<string, Movimiento | Apoyo>();
  for (const r of await almacen.todos<Registro>("entidades")) m.set(r.clave, r.datos);
  return m;
}

/** Version conocida en el servidor de un registro (las devoluciones viven dentro de su apoyo). */
export async function versionConocida(entidad: "movimiento" | "apoyo" | "devolucion", id: number, apoyoId?: number | null) {
  if (entidad === "devolucion") {
    const a = apoyoId ? await leerApoyo(apoyoId) : undefined;
    return a?.devoluciones.find((d) => d.id === id)?.version ?? null;
  }
  const r = entidad === "movimiento" ? await leerMovimiento(id) : await leerApoyo(id);
  return r?.version ?? null;
}

// ---------------------------------------------------------------- ids: UUID del cliente -> id del servidor
const CLAVE_IDS = "ids";
type Mapa = Record<string, number>;

export async function leerIds(): Promise<Mapa> {
  return (await almacen.obtener<{ clave: string; valor: Mapa }>("meta", CLAVE_IDS))?.valor ?? {};
}
export async function recordarId(clave: string, id: number) {
  const mapa = await leerIds();
  mapa[clave] = id;
  await almacen.poner("meta", { clave: CLAVE_IDS, valor: mapa });
}
export const claveUuid = (entidad: string, uuid: string) => `${entidad}:u:${uuid}`;
export const claveTemporal = (entidad: string, seq: number) => `${entidad}:t:${seq}`;

/** Reemplaza (o agrega) una devolucion dentro de su apoyo guardado. */
export async function guardarDevolucion(apoyoId: number, dev: Devolucion) {
  const a = await leerApoyo(apoyoId);
  if (!a) return;
  const existe = a.devoluciones.some((d) => d.id === dev.id);
  const devoluciones = existe ? a.devoluciones.map((d) => (d.id === dev.id ? dev : d)) : [...a.devoluciones, dev];
  await guardar("apoyo", { ...a, devoluciones }, true);
}
