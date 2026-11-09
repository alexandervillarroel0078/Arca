import { api } from "../../core/api";
import { claveRango, type Rango } from "../../core/periodo";
import type { Auditoria } from "../../core/tipos";
import { hoyISO } from "../../core/formato";
import * as ent from "../sync/entidades";
import { leerPantalla, leerRegistro } from "../sync/lecturas";
import { exigirSinPendientes, operarApoyo, operarDevolucion } from "../sync/operaciones";
import { superponerApoyos, superponerResumenApoyos } from "../sync/superponer";
import type { Visibilidad } from "../privacidad/visibilidad";

export type EstadoApoyo = "Pendiente" | "Saldado" | "Cerrado" | "Anulado";

export interface Devolucion extends Auditoria {
  id: number;
  apoyo_id: number;
  monto: number;
  fecha: string;
  nota: string | null;
  usuario_id: number | null;
  usuario_nombre: string | null;
  anulada_con_apoyo: boolean;
}
export interface Apoyo extends Auditoria {
  id: number;
  beneficiario: string;
  monto: number;
  fecha: string;
  nota: string | null;
  usuario_id: number;
  usuario_nombre: string;
  visibilidad?: Visibilidad; // Fase 17: quien lo ve (sin dato = "familia")
  compartido_con?: number[]; // solo el dueno la recibe
  devuelto: number;
  consumido: number;
  pendiente: number;
  estado: EstadoApoyo;
  devoluciones: Devolucion[];
  devoluciones_activas: number;
}
export interface Beneficiario {
  beneficiario: string;
  entregado: number;
  devuelto: number;
  consumido: number;
  pendiente: number;
  estado: EstadoApoyo;
  cantidad_apoyos: number;
  entregado_periodo: number; // entregado con fecha dentro del periodo elegido
  devuelto_periodo: number; // devuelto con fecha de devolucion dentro del periodo
}
export interface ResumenApoyos {
  total_entregado: number;
  total_devuelto: number;
  total_consumido: number;
  total_pendiente: number; // SIEMPRE acumulado: no depende del periodo
  total_entregado_periodo: number;
  total_devuelto_periodo: number;
  beneficiarios: Beneficiario[];
  incluye_privados?: number; // "Incluye tus N registros privados"
}

export const listarApoyos = (verAnulados = false) =>
  leerPantalla(`apoyos:${verAnulados}`, () => api<Apoyo[]>(`/apoyos?ver_anulados=${verAnulados}`), {
    alLeer: ent.guardarApoyos,
    superponer: (lista, ap) => superponerApoyos(lista, ap, verAnulados),
  });
export const obtenerApoyo = (id: number) =>
  leerRegistro("apoyo", id, (real) => api<Apoyo>(`/apoyos/${real}`), (a) => ent.guardarApoyos([a]));
// El pendiente es acumulado; el periodo solo filtra lo entregado y devuelto dentro de el (una copia por periodo).
export const resumenApoyos = (r: Rango) =>
  leerPantalla(`apoyos-resumen:${claveRango(r)}`, () => api<ResumenApoyos>(`/apoyos/resumen?desde=${r.desde}&hasta=${r.hasta}`), {
    superponer: (x, ap) => superponerResumenApoyos(x, ap, r),
  });

// Escrituras: pasan por la cola de operaciones (se envian al instante si hay conexion; si no, quedan pendientes).
export const editarApoyo = (
  id: number,
  c: Partial<{ beneficiario: string; monto: number; fecha: string; nota: string | null; visibilidad: Visibilidad; compartido_con: number[] }>,
) =>
  operarApoyo("editar", id, c);
export const anularApoyo = (id: number, motivo?: string) => operarApoyo("anular", id, { motivo: motivo || null });
export const reactivarApoyo = (id: number) => operarApoyo("reactivar", id);

export const devolverApoyo = (id: number, monto: number) =>
  operarDevolucion("crear", id, null, { monto, fecha: hoyISO(), nota: null });
export const editarDevolucion = (apoyoId: number, id: number, c: Partial<{ monto: number; fecha: string; nota: string | null }>) =>
  operarDevolucion("editar", apoyoId, id, c);
export const anularDevolucion = (apoyoId: number, id: number, motivo?: string) =>
  operarDevolucion("anular", apoyoId, id, { motivo: motivo || null });
export const reactivarDevolucion = (apoyoId: number, id: number) => operarDevolucion("reactivar", apoyoId, id);

// Consumir y reabrir necesitan conexion (van directo al servidor), pero actualizan la copia local.
async function directo(id: number, ruta: string): Promise<Apoyo> {
  await exigirSinPendientes(id);
  const a = await api<Apoyo>(`/apoyos/${id}/${ruta}`, { metodo: "POST", cuerpo: {} });
  await ent.guardarApoyos([a]);
  return a;
}
export const consumirApoyo = (id: number) => directo(id, "consumir");
export const reabrirApoyo = (id: number) => directo(id, "reabrir");
