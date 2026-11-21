import { api } from "../../core/api";
import type { Comparacion } from "../../core/comparacion";
import { claveRango, type Rango, type TipoPeriodo } from "../../core/periodo";
import { leerPantalla } from "../sync/lecturas";
import { superponerResumen } from "../sync/superponer";

export type { Comparacion };

/** Periodo con el que se compara: el anterior del mismo tipo (mes, semana, anio) o un tramo del mismo largo (dia, rango). */
export interface ComparacionResumen {
  desde: string;
  hasta: string;
  etiqueta: string; // "vs octubre 2026"
  ingresos: Comparacion;
  gastos: Comparacion;
  saldo: Comparacion;
  saldo_efectivo?: Comparacion;
}
export interface Resumen {
  mes: string;
  desde: string;
  hasta: string;
  comparacion: ComparacionResumen;
  ingresos: number;
  gastos: number;
  apoyos_entregados: number;
  devoluciones: number;
  saldo: number;
  consumido: number;
  gasto_familiar_total: number;
  apoyos_pendientes_total: number; // SIEMPRE acumulado: no depende del periodo
  apoyos_pendientes_cantidad: number;
  incluye_privados?: number; // "Incluye tus N registros privados"
  // Fuente de pago (0010): ingresos/gastos/apoyos cuentan TODO; lo de banco va aparte y "Te queda" usa solo Efectivo
  ingresos_banco?: number;
  gastos_banco?: number; // incluido en gastos
  apoyos_banco?: number; // incluido en apoyos_entregados
  saldo_efectivo?: number; // ingresos_efectivo - gastos_efectivo - apoyos_efectivo + devoluciones
}
export interface CategoriaTotal {
  categoria_id: number;
  categoria: string;
  icono: string;
  total: number;
  porcentaje: number;
  comparacion: Comparacion;
}
export interface PorCategoria {
  mes: string;
  desde: string;
  hasta: string;
  comparacion: Comparacion; // total de gastos frente al periodo anterior
  periodo_anterior: { desde: string; hasta: string; etiqueta: string };
  categorias: CategoriaTotal[];
  total_gastos: number;
  apoyos_consumidos: number;
  incluye_privados?: number;
}
export interface MiembroTotal {
  usuario_id: number;
  nombre: string;
  ingresos: number;
  gastos: number;
  apoyos_entregados: number;
}
export interface MesTotal {
  mes: string;
  ingresos: number;
  gastos: number;
  apoyos_entregados: number;
  devoluciones: number;
  consumido: number;
  saldo: number;
  // Fuente de pago (0010): ingresos/gastos/apoyos cuentan TODO; lo de banco va aparte y "Te queda" usa solo Efectivo
  ingresos_banco?: number;
  gastos_banco?: number; // incluido en gastos
  apoyos_banco?: number; // incluido en apoyos_entregados
  saldo_efectivo?: number; // ingresos_efectivo - gastos_efectivo - apoyos_efectivo + devoluciones
}

/** Filtro de Reportes por fuente de pago. "todos" no manda nada (cuenta todo, como siempre). */
export type FiltroFuente = "todos" | "efectivo" | "banco";
const conFuente = (f: FiltroFuente) => (f === "todos" ? "" : `&fuente=${f}`);
const clave = (f: FiltroFuente) => (f === "todos" ? "" : `:${f}`); // una copia por filtro

const consulta = (r: Rango) => `desde=${r.desde}&hasta=${r.hasta}`;
const conTipo = (r: Rango, tipo: TipoPeriodo) => `${consulta(r)}&tipo=${tipo}`;

// Las cuatro lecturas guardan copia para verse sin internet, UNA POR PERIODO (la clave lleva las fechas).
// Solo el resumen lleva encima los cambios pendientes.
// La cola sin conexion solo tiene Efectivo: lo pendiente se superpone en "todos" y "efectivo", nunca en "banco".
export const resumenPeriodo = (r: Rango, tipo: TipoPeriodo = "rango", f: FiltroFuente = "todos") =>
  leerPantalla(`resumen:${tipo}:${claveRango(r)}${clave(f)}`, () => api<Resumen>(`/reportes/resumen?${conTipo(r, tipo)}${conFuente(f)}`), {
    superponer: f === "banco" ? undefined : (x, ap) => superponerResumen(x, ap, r),
  });
export const porCategoria = (r: Rango, tipo: TipoPeriodo = "rango", f: FiltroFuente = "todos") =>
  leerPantalla(`por-categoria:${tipo}:${claveRango(r)}${clave(f)}`, () => api<PorCategoria>(`/reportes/por-categoria?${conTipo(r, tipo)}${conFuente(f)}`));
export const porMiembro = (r: Rango, f: FiltroFuente = "todos") =>
  leerPantalla(`por-miembro:${claveRango(r)}${clave(f)}`, () => api<{ mes: string; miembros: MiembroTotal[]; incluye_privados?: number }>(`/reportes/por-miembro?${consulta(r)}${conFuente(f)}`));
export const tendencia = (f: FiltroFuente = "todos") =>
  leerPantalla(`tendencia${clave(f)}`, () => api<{ meses: MesTotal[]; incluye_privados?: number }>(`/reportes/tendencia-mensual${f === "todos" ? "" : `?fuente=${f}`}`));
