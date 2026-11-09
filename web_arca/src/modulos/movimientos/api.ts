import { api } from "../../core/api";
import { claveRango, type Rango } from "../../core/periodo";
import type { Auditoria } from "../../core/tipos";
import * as ent from "../sync/entidades";
import { leerPantalla, leerRegistro } from "../sync/lecturas";
import { operarMovimiento } from "../sync/operaciones";
import { superponerMovimientos } from "../sync/superponer";
import type { Visibilidad } from "../privacidad/visibilidad";

export interface Movimiento extends Auditoria {
  id: number;
  tipo: "gasto" | "ingreso";
  monto: number;
  fecha: string;
  categoria_id: number | null;
  categoria_nombre: string | null;
  categoria_icono: string | null;
  nota: string | null;
  usuario_id: number;
  usuario_nombre: string;
  visibilidad?: Visibilidad; // Fase 17: quien lo ve (sin dato = "familia")
  compartido_con?: number[]; // solo el dueno la recibe
}

export interface NuevoMovimiento {
  tipo: "gasto" | "ingreso";
  monto: number;
  fecha: string;
  categoria_id: number | null;
  nota: string | null;
  uuid_cliente?: string;
  visibilidad?: Visibilidad;
  compartido_con?: number[];
}
export interface NuevoApoyo {
  beneficiario: string;
  monto: number;
  fecha: string;
  nota: string | null;
  uuid_cliente?: string;
  visibilidad?: Visibilidad;
  compartido_con?: number[];
}

// Todas las lecturas guardan copia (se ven sin internet) y las escrituras pasan por la cola de operaciones (Fase 12).
export const listarMovimientos = (r: Rango) =>
  leerPantalla(`movimientos:${claveRango(r)}`, () => api<Movimiento[]>(`/movimientos?desde=${r.desde}&hasta=${r.hasta}`), {
    alLeer: ent.guardarMovimientos,
    superponer: (lista, ap) => superponerMovimientos(lista, ap, r),
  });
export const obtenerMovimiento = (id: number) =>
  leerRegistro("movimiento", id, (real) => api<Movimiento>(`/movimientos/${real}`), (m) => ent.guardarMovimientos([m]));

export type CambiosMovimiento = Partial<Omit<NuevoMovimiento, "uuid_cliente">>;
export const editarMovimiento = (id: number, c: CambiosMovimiento) => operarMovimiento("editar", id, c);
export const anularMovimiento = (id: number, motivo?: string) => operarMovimiento("anular", id, { motivo: motivo || null });
export const reactivarMovimiento = (id: number) => operarMovimiento("reactivar", id);
