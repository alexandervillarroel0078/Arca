// Cola de operaciones sin internet (Fase 12). Vive en IndexedDB y se envia EN ORDEN al volver la conexion.
//
//  - Cada operacion (crear, editar, anular, reactivar) tiene su propio UUID; el servidor es idempotente por ese UUID.
//  - Editar/anular algo creado sin internet que aun no se envio se FUSIONA con la creacion (sale con el valor final).
//  - Cada edicion/anulacion envia la version en la que se baso el usuario; si el servidor responde 409 la operacion se
//    conserva "en conflicto" hasta que el usuario elija. Si el servidor rechaza (403, 422...) se revierte y se avisa.
//  - Nunca se descarta una operacion sin avisar.
import * as almacen from "../../core/almacen";
import { ErrorApi, ErrorRed, api } from "../../core/api";
import { nuevoUuid } from "../../core/uuid";
import type { Apoyo, Devolucion } from "../apoyos/api";
import type { Movimiento } from "../movimientos/api";
import * as ent from "./entidades";
import type {
  Entidad, NuevaOperacion, Operacion, Rechazo, ResultadoOperacion, ResultadoPasada,
} from "./tipos";

export const EVENTO = "arca-sync-cambio";
const avisarCambio = () => window.dispatchEvent(new Event(EVENTO));

// ---------------------------------------------------------------- estado en memoria
let enCurso = false;
let pasadaActiva: Promise<ResultadoPasada> | null = null;
const enEnvio = new Set<string>(); // operaciones cuya peticion ya salio: no se pueden fusionar
const resultados = new Map<string, ResultadoOperacion>();
const lecturas = new Set<Promise<unknown>>();

export const estaSincronizando = () => enCurso;

/** Las operaciones sobre la cola se hacen de a una (evita que dos fusiones se pisen). */
let candado: Promise<unknown> = Promise.resolve();
function enSerie<T>(f: () => Promise<T>): Promise<T> {
  const r = candado.then(f, f);
  candado = r.catch(() => {});
  return r;
}

/**
 * Las lecturas de pantallas y el envio de la cola NO se solapan: asi un dato leido del servidor nunca incluye una
 * operacion que todavia figura como pendiente (evitaria contarla dos veces al superponer la cola sobre el cache).
 */
export async function protegerLectura<T>(f: () => Promise<T>): Promise<T> {
  while (pasadaActiva) await pasadaActiva.catch(() => {});
  const p = f();
  lecturas.add(p);
  try {
    return await p;
  } finally {
    lecturas.delete(p);
  }
}

// ---------------------------------------------------------------- lectura de la cola
export async function listarOperaciones(): Promise<Operacion[]> {
  return (await almacen.todos<Operacion>("cola")).sort((a, b) => a.seq - b.seq);
}
export const cantidadEnCola = async () => (await listarOperaciones()).length;
export async function listarRechazos(): Promise<Rechazo[]> {
  // en el orden en que el usuario hizo las acciones (la clave es un UUID: no sirve para ordenar)
  return (await almacen.todos<Rechazo>("rechazos")).sort((a, b) => a.operacion.seq - b.operacion.seq);
}

type Ids = Record<string, number>;

/** Clave del registro al que apunta la operacion (por id del servidor o, si aun no existe alla, por su UUID). */
export function claveObjetivo(o: Pick<Operacion, "entidad" | "entidadId" | "uuid">, ids: Ids): string {
  if (o.entidadId != null) return `${o.entidad}:${o.entidadId}`;
  const real = o.uuid ? ids[ent.claveUuid(o.entidad, o.uuid)] : undefined;
  return real != null ? `${o.entidad}:${real}` : `${o.entidad}:u:${o.uuid}`;
}

/** Id (o UUID) de un registro mostrado en pantalla: los creados sin internet tienen un id temporal negativo (-seq). */
export async function resolverReferencia(entidad: Entidad, n: number): Promise<{ id: number | null; uuid: string | null }> {
  if (n > 0) return { id: n, uuid: null };
  const crear = (await listarOperaciones()).find((o) => o.entidad === entidad && o.accion === "crear" && o.seq === -n);
  if (crear) return { id: null, uuid: crear.uuid };
  const real = (await ent.leerIds())[ent.claveTemporal(entidad, -n)];
  if (real != null) return { id: real, uuid: null };
  throw new ErrorApi(404, "Este registro ya no está disponible");
}

// ---------------------------------------------------------------- encolar (con fusion)
const LIMPIAR_ANULACION = ["anulado", "motivo_anulacion", "fecha_cliente_anulacion"];

export async function encolar(n: NuevaOperacion): Promise<{ operacion: Operacion; fusionada: boolean }> {
  return enSerie(async () => {
    const ops = await listarOperaciones();
    const ids = await ent.leerIds();
    const fechaCliente = new Date().toISOString();
    const base: Omit<Operacion, "seq"> = {
      id: nuevoUuid(),
      entidad: n.entidad,
      accion: n.accion,
      uuid: n.uuid ?? null,
      entidadId: n.entidadId ?? null,
      apoyoId: n.apoyoId ?? null,
      apoyoUuid: n.apoyoUuid ?? null,
      datos: { ...(n.datos ?? {}) },
      versionBase: n.versionBase ?? null,
      encadenada: false,
      fechaCliente,
      estado: "pendiente",
      intentos: 0,
    };
    const clave = claveObjetivo(base, ids);
    const previas = ops.filter((o) => claveObjetivo(o, ids) === clave);

    // Editar / anular / reactivar algo cuya CREACION sigue pendiente: la creacion sale ya con el valor final.
    // Solo si es lo unico pendiente de ese registro y nada depende de el (una devolucion de un apoyo creado sin
    // internet): en ese caso el orden importa y se encolan aparte.
    const crear = previas.find((o) => o.accion === "crear");
    const hayDependientes = !!crear?.uuid && ops.some((o) => o.apoyoUuid === crear.uuid);
    if (n.accion !== "crear" && crear && previas.length === 1 && !enEnvio.has(crear.id) && !hayDependientes) {
      const d = crear.datos;
      if (n.accion === "editar") {
        if (d.anulado) throw new ErrorApi(400, "El registro está anulado: reactívalo antes de modificarlo");
        Object.assign(d, n.datos ?? {});
        if (crear.entidad === "movimiento" && d.tipo === "ingreso") d.categoria_id = null;
      } else if (n.accion === "anular") {
        if (d.anulado) throw new ErrorApi(400, "El registro ya está anulado");
        d.anulado = true;
        d.motivo_anulacion = ((n.datos?.motivo as string | undefined) ?? "").trim() || null;
        d.fecha_cliente_anulacion = fechaCliente;
      } else {
        if (!d.anulado) throw new ErrorApi(400, "El registro no está anulado");
        for (const k of LIMPIAR_ANULACION) delete d[k];
      }
      await almacen.poner("cola", crear);
      avisarCambio();
      return { operacion: crear, fusionada: true };
    }

    // Hay otra operacion pendiente sobre el mismo registro: la version base se conocera cuando esa se aplique.
    if (n.accion !== "crear" && previas.length > 0) {
      base.encadenada = true;
      base.versionBase = null;
    }
    const operacion = (await almacen.poner("cola", base)) as unknown as Operacion;
    avisarCambio();
    return { operacion, fusionada: false };
  });
}

// ---------------------------------------------------------------- enviar
interface Peticion {
  metodo: string;
  ruta: string;
  cuerpo: unknown;
}

async function versionBaseDe(op: Operacion, apoyoIdReal: number | null): Promise<number | null> {
  if (op.accion === "crear") return null;
  if (!op.encadenada) return op.versionBase;
  // encadenada: la dejo la operacion anterior sobre este mismo registro al aplicarse
  const ids = await ent.leerIds();
  const id = op.entidadId ?? (op.uuid ? ids[ent.claveUuid(op.entidad, op.uuid)] : undefined);
  return id == null ? null : ent.versionConocida(op.entidad, id, apoyoIdReal);
}

async function construir(op: Operacion): Promise<Peticion> {
  const ids = await ent.leerIds();
  const real = (entidad: string, id: number | null, uuid: string | null) =>
    id ?? (uuid ? ids[ent.claveUuid(entidad, uuid)] : undefined);
  const sinResolver = () => new ErrorApi(422, "Depende de un registro que no se pudo sincronizar");

  const apoyoId = op.entidad === "devolucion" ? real("apoyo", op.apoyoId, op.apoyoUuid) : null;
  if (op.entidad === "devolucion" && apoyoId == null) throw sinResolver();
  const id = op.accion === "crear" ? null : real(op.entidad, op.entidadId, op.uuid);
  if (op.accion !== "crear" && id == null) throw sinResolver();

  const version_base = await versionBaseDe(op, apoyoId ?? null);
  const raiz = op.entidad === "movimiento" ? "/movimientos" : op.entidad === "apoyo" ? "/apoyos" : `/apoyos/${apoyoId}/devoluciones`;
  const url = op.accion === "crear" ? raiz : `${raiz}/${id}`;
  const conVersion = version_base != null ? { version_base } : {};

  switch (op.accion) {
    case "crear":
      return { metodo: "POST", ruta: raiz, cuerpo: { ...op.datos, uuid_cliente: op.uuid } };
    case "editar":
      return { metodo: "PATCH", ruta: url, cuerpo: { ...op.datos, ...conVersion } };
    case "anular":
      return { metodo: "POST", ruta: `${url}/anular`, cuerpo: { motivo: (op.datos.motivo as string | null) || null, ...conVersion } };
    default:
      return { metodo: "POST", ruta: `${url}/reactivar`, cuerpo: { ...conVersion } };
  }
}

async function enviar(op: Operacion): Promise<unknown> {
  const p = await construir(op);
  return api(p.ruta, {
    metodo: p.metodo,
    cuerpo: p.cuerpo,
    // El servidor aplica cada operacion una sola vez (X-Operacion-Id) y guarda cuando la hizo el usuario (X-Fecha-Cliente)
    headers: { "X-Operacion-Id": op.id, "X-Fecha-Cliente": op.fechaCliente },
  });
}

async function aplicarRespuesta(op: Operacion, resp: unknown) {
  if (op.entidad === "movimiento") {
    const m = resp as Movimiento;
    await ent.guardarMovimientos([m]);
    if (op.accion === "crear" && op.uuid) {
      await ent.recordarId(ent.claveUuid("movimiento", op.uuid), m.id);
      await ent.recordarId(ent.claveTemporal("movimiento", op.seq), m.id);
    }
    return;
  }
  const a = resp as Apoyo; // los endpoints de apoyos y devoluciones devuelven el apoyo completo
  await ent.guardarApoyos([a]);
  if (op.accion !== "crear" || !op.uuid) return;
  if (op.entidad === "apoyo") {
    await ent.recordarId(ent.claveUuid("apoyo", op.uuid), a.id);
    await ent.recordarId(ent.claveTemporal("apoyo", op.seq), a.id);
  } else {
    const d = a.devoluciones.find((x: Devolucion) => x.uuid_cliente === op.uuid);
    if (d) {
      await ent.recordarId(ent.claveUuid("devolucion", op.uuid), d.id);
      await ent.recordarId(ent.claveTemporal("devolucion", op.seq), d.id);
    }
  }
}

// ---------------------------------------------------------------- una pasada de envio
function esConflicto(e: ErrorApi): boolean {
  return e.estado === 409 && (e.detalle as { codigo?: string } | undefined)?.codigo === "conflicto_version";
}

async function guardarConflicto(op: Operacion, e: ErrorApi) {
  const d = e.detalle as { mensaje: string; version_actual: number; actual: Movimiento | Apoyo | Devolucion };
  // el servidor manda su version: pasa a ser la base local (la operacion pendiente se muestra encima)
  if (op.entidad === "movimiento") await ent.guardarMovimientos([d.actual as Movimiento]);
  else if (op.entidad === "apoyo") await ent.guardarApoyos([d.actual as Apoyo]);
  else {
    const apoyoId = op.apoyoId ?? (op.apoyoUuid ? (await ent.leerIds())[ent.claveUuid("apoyo", op.apoyoUuid)] : null);
    if (apoyoId != null) await ent.guardarDevolucion(apoyoId, d.actual as Devolucion);
  }
  const marcada: Operacion = {
    ...op, estado: "conflicto", intentos: op.intentos + 1,
    conflicto: { mensaje: d.mensaje, versionActual: d.version_actual, actual: d.actual },
  };
  await almacen.poner("cola", marcada);
}

async function rechazar(op: Operacion, estado: number, motivo: string, silencioso: boolean) {
  // Se revierte solo: al quitarla de la cola, lo que se muestra vuelve a ser la ultima version del servidor.
  if (!silencioso) {
    await almacen.poner<Rechazo>("rechazos", { id: nuevoUuid(), operacion: op, motivo, estado, fecha: new Date().toISOString() });
  }
  await almacen.quitar("cola", op.seq);
}

async function pasada(interactiva?: string): Promise<ResultadoPasada> {
  await Promise.allSettled([...lecturas]);
  if (resultados.size > 100) resultados.clear();
  const res: ResultadoPasada = { enviados: 0, conflictos: 0, rechazados: 0, quedan: 0, sinConexion: false, sesionVencida: false };
  enCurso = true;
  avisarCambio();
  try {
    const bloqueadas = new Set<string>(); // registros con una operacion en conflicto: lo que sigue sobre ellos espera
    for (const previa of await listarOperaciones()) {
      const op = await almacen.obtener<Operacion>("cola", previa.seq); // version fresca (pudo fusionarse algo)
      if (!op) continue;
      const clave = claveObjetivo(op, await ent.leerIds());
      if (op.estado === "conflicto") {
        bloqueadas.add(clave);
        continue;
      }
      if (bloqueadas.has(clave)) continue;

      enEnvio.add(op.id);
      try {
        const resp = await enviar(op);
        await aplicarRespuesta(op, resp);
        await almacen.quitar("cola", op.seq);
        resultados.set(op.id, { tipo: "aplicada", respuesta: resp });
        res.enviados++;
      } catch (e) {
        if (e instanceof ErrorRed) {
          res.sinConexion = true;
          break;
        }
        if (!(e instanceof ErrorApi)) throw e;
        if (e.estado === 401) {
          res.sesionVencida = true;
          break;
        }
        if (esConflicto(e)) {
          await guardarConflicto(op, e);
          resultados.set(op.id, { tipo: "conflicto", mensaje: e.message });
          bloqueadas.add(clave);
          res.conflictos++;
        } else if (e.estado >= 500 || e.estado === 408 || e.estado === 429) {
          await almacen.poner("cola", { ...op, intentos: op.intentos + 1 }); // falla del servidor: se reintenta luego
          break;
        } else {
          await rechazar(op, e.estado, e.message, op.id === interactiva); // si el usuario esta mirando, ve el error en el momento
          resultados.set(op.id, { tipo: "rechazada", estado: e.estado, motivo: e.message });
          res.rechazados++;
        }
      } finally {
        enEnvio.delete(op.id);
      }
    }
  } finally {
    enCurso = false;
  }
  res.quedan = (await listarOperaciones()).length;
  // las pantallas vuelven a leer: lo enviado ahora viene del servidor, y lo rechazado o en conflicto deja de verse como pendiente
  if (res.enviados + res.rechazados + res.conflictos > 0) window.dispatchEvent(new Event("arca-datos-nuevos"));
  avisarCambio();
  return res;
}

/** Envia la cola en orden. Se detiene al faltar la conexion, vencer la sesion o fallar el servidor (reintenta despues). */
export function sincronizar(opciones: { interactiva?: string } = {}): Promise<ResultadoPasada> {
  if (!pasadaActiva) {
    pasadaActiva = pasada(opciones.interactiva).finally(() => {
      pasadaActiva = null;
    });
    return pasadaActiva;
  }
  // ya hay un envio en marcha: otra pasada despues (las operaciones nuevas no entran en la que corre)
  return pasadaActiva.then(() => sincronizar(opciones), () => sincronizar(opciones));
}

/** Encola una operacion y trata de enviarla ya. Devuelve que paso con ESTA operacion. */
export async function ejecutar(n: NuevaOperacion): Promise<{ resultado: ResultadoOperacion; operacion: Operacion; fusionada: boolean }> {
  const { operacion, fusionada } = await encolar(n);
  await sincronizar({ interactiva: operacion.id });
  if (fusionada) {
    // el cambio viajo dentro de la creacion pendiente: si esta se rechazo, el usuario lo ve ahora mismo
    const r = resultados.get(operacion.id);
    resultados.delete(operacion.id);
    if (r && r.tipo !== "aplicada") return { resultado: r, operacion, fusionada };
    const sigue = (await listarOperaciones()).some((o) => o.id === operacion.id);
    return { resultado: sigue ? { tipo: "pendiente" } : { tipo: "aplicada", respuesta: null }, operacion, fusionada };
  }
  const resultado = resultados.get(operacion.id) ?? { tipo: "pendiente" as const };
  resultados.delete(operacion.id);
  return { resultado, operacion, fusionada };
}

// ---------------------------------------------------------------- conflictos y rechazos
/** "mia": se vuelve a enviar sobre la version actual del servidor. "servidor": se descarta lo mio sobre ese registro. */
export async function resolverConflicto(operacionId: string, eleccion: "mia" | "servidor"): Promise<void> {
  await enSerie(async () => {
    const ops = await listarOperaciones();
    const op = ops.find((o) => o.id === operacionId);
    if (!op || op.estado !== "conflicto" || !op.conflicto) return;
    if (eleccion === "mia") {
      const { conflicto, ...resto } = op;
      await almacen.poner("cola", { ...resto, estado: "pendiente", versionBase: conflicto!.versionActual, encadenada: false });
    } else {
      // lo que el usuario hizo despues sobre ese mismo registro se basaba en su cambio: se descarta junto con el
      const ids = await ent.leerIds();
      const clave = claveObjetivo(op, ids);
      for (const o of ops) if (o.seq >= op.seq && claveObjetivo(o, ids) === clave) await almacen.quitar("cola", o.seq);
    }
    avisarCambio();
  });
  if (eleccion === "mia") await sincronizar();
  else window.dispatchEvent(new Event("arca-datos-nuevos"));
}

export async function descartarRechazo(id: string) {
  await almacen.quitar("rechazos", id);
  avisarCambio();
}

/** Borra la cola y los rechazos (el cache y los registros conocidos se borran aparte). */
export async function vaciarCola() {
  await almacen.vaciar("cola");
  await almacen.vaciar("rechazos");
  avisarCambio();
}

export const alCambiarCola = (f: () => void) => {
  window.addEventListener(EVENTO, f);
  return () => window.removeEventListener(EVENTO, f);
};
