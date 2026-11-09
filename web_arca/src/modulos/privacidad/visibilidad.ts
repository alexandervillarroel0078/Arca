// Reglas y textos de la privacidad (Fase 17). Funciones puras: el backend es quien manda (aqui solo se decide que mostrar).
export type Visibilidad = "solo_yo" | "familia" | "elegidas";
export type Preferencia = "solo_yo" | "familia";

/** Lo minimo que se necesita de un movimiento o apoyo para hablar de su visibilidad. */
export interface ConVisibilidad {
  usuario_id: number;
  usuario_nombre: string;
  visibilidad?: Visibilidad;
  /** Solo el dueno recibe esta lista (a los demas llega vacia). */
  compartido_con?: number[];
}
export interface QuienSoy {
  id: number;
  rol: "admin" | "miembro";
}

export const visibilidadDe = (r: { visibilidad?: Visibilidad }): Visibilidad => r.visibilidad ?? "familia";
export const esMio = (r: ConVisibilidad, yo: QuienSoy | null | undefined) => !!yo && r.usuario_id === yo.id;

/** Solo el dueno edita lo privado o compartido; el admin edita lo que ve y es de la familia (como siempre). */
export function puedeEditar(r: ConVisibilidad, yo: QuienSoy | null | undefined): boolean {
  if (!yo) return false;
  return r.usuario_id === yo.id || (yo.rol === "admin" && visibilidadDe(r) === "familia");
}
/** Devolucion de un apoyo: en uno de la familia cualquiera la registra; en uno privado o compartido, solo su dueno. */
export const puedeRegistrarDevolucion = (a: ConVisibilidad, yo: QuienSoy | null | undefined) =>
  !!yo && (a.usuario_id === yo.id || visibilidadDe(a) === "familia");

export const NOMBRES: Record<Visibilidad, string> = { solo_yo: "Solo yo", familia: "Familia", elegidas: "Personas..." };

/** Texto de la etiqueta de una fila, o null si no hay nada que decir (lo de la familia no lleva etiqueta). */
export function etiquetaVisibilidad(r: ConVisibilidad, yo: QuienSoy | null | undefined): string | null {
  const v = visibilidadDe(r);
  if (v === "familia") return null;
  if (esMio(r, yo)) {
    if (v === "solo_yo") return "Solo tú";
    const n = r.compartido_con?.length ?? 0;
    return n > 0 ? `Compartido con ${n}` : "Compartido";
  }
  return `Compartido por ${r.usuario_nombre}`;
}

/** "Incluye tus 3 registros privados" (null si no hay). */
export function textoPrivados(n: number | undefined | null): string | null {
  if (!n || n < 1) return null;
  return n === 1 ? "Incluye tu 1 registro privado" : `Incluye tus ${n} registros privados`;
}

/** Resumen debajo del selector: "Solo tú lo ves", "Toda la familia", "Ana y Luis". */
export function resumenSeleccion(v: Visibilidad, nombres: string[]): string {
  if (v === "solo_yo") return "Solo tú lo ves";
  if (v === "familia") return "Toda la familia lo ve";
  if (nombres.length === 0) return "Elige con quién compartirlo";
  if (nombres.length <= 2) return `Solo ${nombres.join(" y ")}`;
  return `Solo ${nombres.slice(0, 2).join(", ")} y ${nombres.length - 2} más`;
}
