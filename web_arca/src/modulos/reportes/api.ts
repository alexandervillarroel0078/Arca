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
}

const consulta = (r: Rango) => `desde=${r.desde}&hasta=${r.hasta}`;
const conTipo = (r: Rango, tipo: TipoPeriodo) => `${consulta(r)}&tipo=${tipo}`;

// Las cuatro lecturas guardan copia para verse sin internet, UNA POR PERIODO (la clave lleva las fechas).
// Solo el resumen lleva encima los cambios pendientes.
export const resumenPeriodo = (r: Rango, tipo: TipoPeriodo = "rango") =>
  leerPantalla(`resumen:${tipo}:${claveRango(r)}`, () => api<Resumen>(`/reportes/resumen?${conTipo(r, tipo)}`), {
    superponer: (x, ap) => superponerResumen(x, ap, r),
  });
export const porCategoria = (r: Rango, tipo: TipoPeriodo = "rango") =>
  leerPantalla(`por-categoria:${tipo}:${claveRango(r)}`, () => api<PorCategoria>(`/reportes/por-categoria?${conTipo(r, tipo)}`));
export const porMiembro = (r: Rango) =>
  leerPantalla(`por-miembro:${claveRango(r)}`, () => api<{ mes: string; miembros: MiembroTotal[]; incluye_privados?: number }>(`/reportes/por-miembro?${consulta(r)}`));
export const tendencia = () => leerPantalla("tendencia", () => api<{ meses: MesTotal[]; incluye_privados?: number }>("/reportes/tendencia-mensual"));
