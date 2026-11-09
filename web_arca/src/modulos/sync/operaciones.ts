// Operaciones del usuario sobre movimientos, apoyos y devoluciones. Todas pasan por la cola: se envian al instante
// si hay conexion y, si no, quedan guardadas y se aplican encima de lo que se ve.
import { ErrorApi } from "../../core/api";
import { nuevoUuid } from "../../core/uuid";
import type { Apoyo } from "../apoyos/api";
import type { Movimiento } from "../movimientos/api";
import { ejecutar, listarOperaciones, resolverReferencia } from "./cola";
import * as ent from "./entidades";
import { registroLocal } from "./lecturas";
import type { Accion, NuevaOperacion } from "./tipos";

/** Envia la operacion. Devuelve la respuesta del servidor, o null si quedo pendiente (sin conexion). Lanza si se rechazo. */
export async function operar(n: NuevaOperacion): Promise<unknown | null> {
  const { resultado } = await ejecutar(n);
  switch (resultado.tipo) {
    case "aplicada":
      return resultado.respuesta ?? {};
    case "pendiente":
      return null;
    case "conflicto":
      throw new ErrorApi(409, `${resultado.mensaje}. Mira "Cambios pendientes" para elegir cuál conservar.`);
    default:
      throw new ErrorApi(resultado.estado, resultado.motivo);
  }
}

/** Crear un movimiento o un apoyo (el UUID lo genera el cliente). Dice si ya se envio o quedo en la cola. */
export async function crear(entidad: "movimiento" | "apoyo", datos: Record<string, unknown>, uuid?: string): Promise<"enviado" | "en_cola"> {
  const r = await operar({ entidad, accion: "crear", uuid: uuid ?? nuevoUuid(), datos });
  return r === null ? "en_cola" : "enviado";
}

/** Consumir / reabrir van directo al servidor: no pueden adelantarse a cambios del mismo apoyo que siguen en la cola. */
export async function exigirSinPendientes(apoyoId: number) {
  const ref = await resolverReferencia("apoyo", apoyoId);
  const hay = (await listarOperaciones()).some(
    (o) => (o.entidad === "apoyo" && (ref.id != null ? o.entidadId === ref.id : o.uuid === ref.uuid)) ||
      (o.entidad === "devolucion" && (ref.id != null ? o.apoyoId === ref.id : o.apoyoUuid === ref.uuid)),
  );
  if (hay) throw new ErrorApi(409, "Este apoyo tiene cambios sin enviar. Espera a que se sincronicen.");
}

/** Lo que devolvio el servidor, o el registro local con lo pendiente aplicado si todavia no se envio. */
const respuestaOLocal = async <T>(resp: unknown | null, entidad: "movimiento" | "apoyo", id: number) =>
  (resp && Object.keys(resp as object).length ? resp : await registroLocal(entidad, id)) as T;

export async function operarMovimiento(accion: Exclude<Accion, "crear">, id: number, datos: Record<string, unknown> = {}): Promise<Movimiento> {
  const ref = await resolverReferencia("movimiento", id);
  const versionBase = ref.id != null ? await ent.versionConocida("movimiento", ref.id) : null;
  const resp = await operar({ entidad: "movimiento", accion, entidadId: ref.id, uuid: ref.uuid, datos, versionBase });
  return respuestaOLocal<Movimiento>(resp, "movimiento", id);
}

export async function operarApoyo(accion: Exclude<Accion, "crear">, id: number, datos: Record<string, unknown> = {}): Promise<Apoyo> {
  const ref = await resolverReferencia("apoyo", id);
  const versionBase = ref.id != null ? await ent.versionConocida("apoyo", ref.id) : null;
  const resp = await operar({ entidad: "apoyo", accion, entidadId: ref.id, uuid: ref.uuid, datos, versionBase });
  return respuestaOLocal<Apoyo>(resp, "apoyo", id);
}

export async function operarDevolucion(
  accion: Accion,
  apoyoId: number,
  devolucionId: number | null,
  datos: Record<string, unknown> = {},
): Promise<Apoyo> {
  const apoyo = await resolverReferencia("apoyo", apoyoId);
  let n: NuevaOperacion;
  if (accion === "crear") {
    n = { entidad: "devolucion", accion, uuid: nuevoUuid(), apoyoId: apoyo.id, apoyoUuid: apoyo.uuid, datos };
  } else {
    const dev = await resolverReferencia("devolucion", devolucionId!);
    const versionBase = dev.id != null && apoyo.id != null ? await ent.versionConocida("devolucion", dev.id, apoyo.id) : null;
    n = { entidad: "devolucion", accion, entidadId: dev.id, uuid: dev.uuid, apoyoId: apoyo.id, apoyoUuid: apoyo.uuid, datos, versionBase };
  }
  const resp = await operar(n);
  return respuestaOLocal<Apoyo>(resp, "apoyo", apoyoId);
}
