import { api } from "../../core/api";

export type EntidadHistorial = "movimiento" | "apoyo" | "devolucion" | "categoria" | "miembro" | "usuario" | "cuenta" | "cuenta_mov";

/** campo -> {antes, despues}; en cambios de clave solo {"clave": "clave cambiada"} (texto fijo). */
export type CambiosHistorial = Record<string, { antes: unknown; despues: unknown } | string>;

export interface EntradaHistorial {
  id: number;
  entidad: EntidadHistorial;
  entidad_id: number;
  accion: string;
  usuario_id: number;
  usuario_nombre: string;
  fecha: string; // cuando se sincronizo (hora del servidor)
  /** Cuando el usuario hizo la accion en su aparato (si la hizo sin internet, puede ser mucho antes que `fecha`). */
  fecha_cliente?: string | null;
  cambios: CambiosHistorial;
  motivo: string | null;
  etiqueta: string | null;
}
export interface PaginaHistorial {
  items: EntradaHistorial[];
  total: number;
  hay_mas: boolean;
}

/** Cadena de un registro, en orden cronologico (la puede ver cualquier miembro de la familia). */
export const cadenaHistorial = (entidad: EntidadHistorial, id: number) =>
  api<PaginaHistorial>(`/historial?entidad=${entidad}&entidad_id=${id}&limite=100`);

export interface FiltrosActividadFamilia {
  entidad: string;
  accion: string;
  usuario: string;
}

/** Actividad global de la familia (solo admin), la mas reciente primero. */
export function actividadFamilia(f: FiltrosActividadFamilia, desplazamiento: number, limite = 20) {
  const q = new URLSearchParams({ limite: String(limite), desplazamiento: String(desplazamiento) });
  if (f.entidad) q.set("entidad", f.entidad);
  if (f.accion) q.set("accion", f.accion);
  if (f.usuario) q.set("usuario", f.usuario);
  return api<PaginaHistorial>(`/historial?${q.toString()}`);
}
