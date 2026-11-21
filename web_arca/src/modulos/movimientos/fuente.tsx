// Fuente de pago (0010): Efectivo o una cuenta de banco. Lo que lleva banco va SIEMPRE directo al servidor y en línea
// (crea un movimiento en Cuentas); la cola sin conexión solo acepta Efectivo (ver sync/operaciones.exigirEfectivo).
import { api, ErrorRed } from "../../core/api";
import type { Apoyo } from "../apoyos/api";
import type { CuentaFuente } from "../cuentas/api";
import * as ent from "../sync/entidades";
import { MENSAJE_BANCO_SIN_COLA } from "../sync/operaciones";
import type { CamposFuente, Movimiento, NuevoApoyo, NuevoMovimiento } from "./api";

/** La fuente elegida en la hoja o en el chip "Pagado con". null = Efectivo. */
export type FuenteElegida = Pick<CuentaFuente, "id" | "nombre" | "directo" | "confirma_nombre">;

export const enLinea = () => typeof navigator === "undefined" || navigator.onLine;

/** Errores de red de un pago con banco: el mensaje claro de "necesita conexión". */
async function directo<T>(llamar: () => Promise<T>): Promise<T> {
  if (!enLinea()) throw new ErrorRed(MENSAJE_BANCO_SIN_COLA);
  try {
    return await llamar();
  } catch (e) {
    if (e instanceof ErrorRed) throw new ErrorRed(MENSAJE_BANCO_SIN_COLA);
    throw e;
  }
}

export const crearConBanco = (clase: "movimiento" | "apoyo", datos: NuevoMovimiento | NuevoApoyo) =>
  directo(async () => {
    if (clase === "apoyo") {
      const a = await api<Apoyo>("/apoyos", { metodo: "POST", cuerpo: datos });
      await ent.guardarApoyos([a]).catch(() => {});
      return a;
    }
    const m = await api<Movimiento>("/movimientos", { metodo: "POST", cuerpo: datos });
    await ent.guardarMovimientos([m]).catch(() => {});
    return m;
  });

/** Editar un registro cambiando su fuente a una cuenta de banco (o de una cuenta a otra): directo, con su version. */
export const editarConBanco = (clase: "movimiento" | "apoyo", id: number, cambios: Record<string, unknown>, version: number | undefined) =>
  directo(async () => {
    const cuerpo = { ...cambios, ...(version ? { version_base: version } : {}) };
    if (clase === "apoyo") {
      const a = await api<Apoyo>(`/apoyos/${id}`, { metodo: "PATCH", cuerpo });
      await ent.guardarApoyos([a]).catch(() => {}); // la version nueva: la proxima edicion por la cola no choca
      return a;
    }
    const m = await api<Movimiento>(`/movimientos/${id}`, { metodo: "PATCH", cuerpo });
    await ent.guardarMovimientos([m]).catch(() => {});
    return m;
  });

/** Texto de la marca de un registro según su fuente (null = Efectivo sin nada que decir). */
export function marcaFuente(r: CamposFuente): { texto: string; tono: "pendiente" | "ok" | "rechazo" } | null {
  if (r.fuente === "banco") {
    const nombre = r.cuenta_nombre ?? "Banco";
    if (r.estado_cuenta === "pendiente") return { texto: `Pendiente de confirmar · ${nombre}`, tono: "pendiente" };
    return { texto: `Confirmado · ${nombre}`, tono: "ok" };
  }
  if (r.rechazado_por_nombre) return { texto: `Rechazado por ${r.rechazado_por_nombre} · ahora Efectivo`, tono: "rechazo" };
  return null;
}

const TONO = {
  pendiente: "bg-apoyo-claro text-apoyo-texto",
  ok: "bg-arca-claro text-arca",
  rechazo: "bg-red-50 text-red-800",
} as const;

/** Píldora con la fuente de un gasto, ingreso o apoyo pagado con banco (o rechazado y vuelto a Efectivo). */
export function EtiquetaFuente({ registro }: { registro: CamposFuente }) {
  const m = marcaFuente(registro);
  if (!m) return null;
  return (
    <span data-testid="etiqueta-fuente" data-tono={m.tono} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${TONO[m.tono]}`}>
      <span aria-hidden>{m.tono === "rechazo" ? "↩" : m.tono === "pendiente" ? "⏳" : "🏦"}</span>
      {m.texto}
    </span>
  );
}
