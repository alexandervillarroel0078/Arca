// Cálculos del detalle de una cuenta (funciones puras, con BigInt). Solo cuentan los movimientos NO anulados.
import type { MovimientoCuenta } from "./api";
import { aMonto, sumar, type Monto } from "./montos";

export interface ResumenMes {
  entro: Monto; // depósitos
  salio: Monto; // retiros + comisión de red (positivo)
  traspasos: Monto; // efecto neto de los traspasos sobre ESTA cuenta (aparte: no es entrada ni salida)
  ajustes: Monto; // efecto neto de los ajustes por conteo (aparte)
}

const efectoDe = (m: MovimientoCuenta): Monto => (m.efecto != null ? aMonto(m.efecto) ?? 0n : 0n);

/** Entró = depósitos; Salió = retiros + comisión; traspasos y ajustes van aparte, sin sumarse a ninguno. */
export function resumenMes(movs: MovimientoCuenta[]): ResumenMes {
  const vivos = movs.filter((m) => !m.anulado);
  const de = (tipo: MovimientoCuenta["tipo"]) => sumar(vivos.filter((m) => m.tipo === tipo).map(efectoDe));
  return { entro: de("deposito"), salio: -de("retiro"), traspasos: de("traspaso"), ajustes: de("ajuste") };
}

/** Clave estable de la persona de un movimiento: "sin", "m:<id>" (miembro) u "o:<nombre>" (otra persona). */
export function clavePersona(m: Pick<MovimientoCuenta, "persona_tipo" | "persona_usuario_id" | "persona_nombre">): string {
  if (m.persona_tipo === "miembro" && m.persona_usuario_id != null) return `m:${m.persona_usuario_id}`;
  if (m.persona_tipo === "otra" && m.persona_nombre) return `o:${m.persona_nombre}`;
  return "sin";
}

/** Personas que aparecen en la lista (para el filtro), con su nombre visible. */
export function personasDe(movs: MovimientoCuenta[]): { valor: string; texto: string }[] {
  const vistas = new Map<string, string>();
  for (const m of movs) {
    const k = clavePersona(m);
    if (!vistas.has(k)) vistas.set(k, k === "sin" ? "Sin identificar" : m.persona_nombre || "Sin identificar");
  }
  return [...vistas.entries()].map(([valor, texto]) => ({ valor, texto }));
}

export const filtrarPorPersona = (movs: MovimientoCuenta[], clave: string) => (clave ? movs.filter((m) => clavePersona(m) === clave) : movs);

/** Primer y último día (AAAA-MM-DD) de un mes AAAA-MM. */
export function limitesDeMes(aaaamm: string): { desde: string; hasta: string } {
  const [a, m] = aaaamm.split("-").map(Number);
  const ultimo = new Date(a, m, 0).getDate();
  return { desde: `${aaaamm}-01`, hasta: `${aaaamm}-${String(ultimo).padStart(2, "0")}` };
}

/** Nombres que ya se usaron como "otra persona" (sin repetir, más recientes primero) para sugerirlos al escribir. */
export function sugerenciasDeNombres(movs: MovimientoCuenta[], escrito: string, max = 5): string[] {
  const base = escrito.trim().toLowerCase();
  const nombres: string[] = [];
  for (const m of movs) {
    const n = m.persona_tipo === "otra" ? m.persona_nombre : null;
    if (n && !nombres.some((x) => x.toLowerCase() === n.toLowerCase())) nombres.push(n);
  }
  return nombres.filter((n) => n.toLowerCase().includes(base) && n.toLowerCase() !== base).slice(0, max);
}
