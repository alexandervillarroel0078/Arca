import { sumarDias } from "../../core/periodo";
import type { ItemActividad } from "./actividad";

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "Hoy", "Ayer" o "6 nov". `hoy` es el dia de hoy en La Paz (el mismo que usan los periodos: `hoyLaPaz`). */
export function etiquetaDia(iso: string, hoy: string): string {
  if (iso === hoy) return "Hoy";
  if (iso === sumarDias(hoy, -1)) return "Ayer";
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MESES[m - 1]}`;
}

export interface GrupoDia {
  fecha: string; // AAAA-MM-DD
  titulo: string; // "Hoy" | "Ayer" | "6 nov"
  items: ItemActividad[];
  /**
   * Neto del dia de lo que se ve en la lista: ingresos suman; gastos y apoyos entregados restan; lo anulado no cuenta.
   * `null` si no hay nada que sumar (dia solo con anulados) o si el dia puede estar incompleto (ver `agruparPorDia`).
   */
  total: number | null;
}

/** Neto de un conjunto de filas, en centavos para no arrastrar errores de coma flotante. Lo anulado no cuenta. */
export function totalDelDia(items: ItemActividad[]): number | null {
  const activos = items.filter((i) => !i.anulado);
  if (activos.length === 0) return null;
  const centavos = activos.reduce((s, i) => s + (i.tipo === "ingreso" ? 1 : -1) * Math.round(i.monto * 100), 0);
  return centavos / 100;
}

/**
 * Agrupa filas CONSECUTIVAS de la misma fecha (la lista ya viene ordenada por fecha). Solo salen los dias que tienen filas.
 * El total se deriva de lo cargado: si quedan paginas por cargar (`hayMas`), el ultimo dia puede seguir en la pagina siguiente,
 * asi que su total aun no es seguro y no se muestra.
 */
export function agruparPorDia(items: ItemActividad[], hoy: string, hayMas = false): GrupoDia[] {
  const grupos: GrupoDia[] = [];
  for (const i of items) {
    const g = grupos[grupos.length - 1];
    if (g && g.fecha === i.fecha) g.items.push(i);
    else grupos.push({ fecha: i.fecha, titulo: etiquetaDia(i.fecha, hoy), items: [i], total: null });
  }
  grupos.forEach((g, n) => {
    g.total = hayMas && n === grupos.length - 1 ? null : totalDelDia(g.items);
  });
  return grupos;
}
