import { crear } from "../sync/operaciones";
import type { NuevoApoyo, NuevoMovimiento } from "./api";

export type Pendiente =
  | { clase: "movimiento"; datos: NuevoMovimiento }
  | { clase: "apoyo"; datos: NuevoApoyo };

/** Envia al servidor; sin internet queda en la cola local (IndexedDB) y se sincroniza al volver la conexion.
 * Cada registro lleva un UUID: si se reenvia, el servidor devuelve el existente en vez de duplicarlo. */
export async function registrar(p: Pendiente): Promise<"enviado" | "en_cola"> {
  const { uuid_cliente, ...datos } = p.datos;
  return crear(p.clase, datos, uuid_cliente);
}
