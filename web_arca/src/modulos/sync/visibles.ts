// Lo que dejo de ser visible (Fase 17): el servidor dice QUE ids puede ver esta persona ahora (solo ids) y el telefono
// OLVIDA el resto, tambien de su copia sin conexion. Asi, si alguien pasa un registro a privado, los otros aparatos lo
// pierden en su siguiente sincronizacion (no se queda en el cache).
import * as almacen from "../../core/almacen";
import { api } from "../../core/api";
import * as ent from "./entidades";

interface Visibles {
  movimientos: number[];
  apoyos: number[];
}
const CLAVE = "visibles";
/** Pantallas cuyo cache puede contener o sumar registros (el de categorias y miembros no). */
const CLAVES_DE_REGISTROS = ["movimientos:", "apoyos", "actividad:", "resumen:", "por-categoria:", "por-miembro:", "tendencia"];
interface Guardado {
  clave: string;
  valor: { movimientos: number[]; apoyos: number[] };
}

/** Pide la lista autoritativa y olvida lo que ya no se ve. Devuelve cuantos registros se olvidaron. */
export async function reconciliarVisibles(): Promise<number> {
  const t0 = Date.now();
  const respuesta = await api<Partial<Visibles>>("/sincronizacion/visibles");
  const ahora: Visibles = { movimientos: respuesta?.movimientos ?? [], apoyos: respuesta?.apoyos ?? [] };
  const vistos = {
    movimiento: new Set(ahora.movimientos),
    apoyo: new Set(ahora.apoyos),
  };
  const previo = (await almacen.obtener<Guardado>("meta", CLAVE))?.valor;
  const perdidos = new Set<string>();
  if (previo) {
    for (const id of previo.movimientos) if (!vistos.movimiento.has(id)) perdidos.add(`movimiento:${id}`);
    for (const id of previo.apoyos) if (!vistos.apoyo.has(id)) perdidos.add(`apoyo:${id}`);
  }
  // lo que el telefono recuerda de otras lecturas (con id real del servidor) y ya no esta en la lista
  for (const clave of (await ent.todasLasBases()).keys()) {
    const [entidad, id] = clave.split(":");
    const n = Number(id);
    if (n > 0 && (entidad === "movimiento" || entidad === "apoyo") && !vistos[entidad].has(n)) perdidos.add(clave);
  }
  await almacen.poner<Guardado>("meta", { clave: CLAVE, valor: { movimientos: ahora.movimientos, apoyos: ahora.apoyos } });
  if (perdidos.size === 0) return 0;
  // El cache de pantallas (listas y totales) puede contener el registro o sumarlo: se descartan las copias anteriores a
  // esta consulta (las que llegaron despues ya son las del servidor) y se vuelve a leer cuando haya conexion. Los
  // cambios propios pendientes de enviar viven en la cola y no se tocan.
  for (const e of await almacen.todos<{ clave: string; guardado: number }>("cache")) {
    if (e.guardado < t0 && CLAVES_DE_REGISTROS.some((p) => e.clave.startsWith(p))) await almacen.quitar("cache", e.clave);
  }
  for (const clave of perdidos) await almacen.quitar("entidades", clave);
  window.dispatchEvent(new Event("arca-datos-nuevos")); // las pantallas abiertas se vuelven a leer
  return perdidos.size;
}
