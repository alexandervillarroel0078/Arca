import { api } from "../../core/api";
import type { Auditoria } from "../../core/tipos";
import * as ent from "../sync/entidades";
import { leerPantalla } from "../sync/lecturas";
import { superponerActividad } from "../sync/superponer";
import type { Visibilidad } from "../privacidad/visibilidad";

/** Una fila de la lista completa: movimiento (gasto/ingreso) o apoyo. */
export interface ItemActividad extends Auditoria {
  clase: "movimiento" | "apoyo";
  id: number;
  tipo: "gasto" | "ingreso" | "apoyo";
  titulo: string;
  monto: number;
  fecha: string;
  nota: string | null;
  usuario_id: number;
  usuario_nombre: string;
  visibilidad?: Visibilidad; // Fase 17: quien lo ve (sin dato = "familia")
  compartido_con?: number[]; // solo el dueno la recibe
  categoria_id: number | null;
  categoria_nombre: string | null;
  categoria_icono: string | null;
  beneficiario: string | null;
  estado: string | null;
  pendiente: number | null;
  devuelto?: number | null;
  consumido?: number | null;
  devoluciones_activas: number | null;
}
export interface PaginaActividad {
  items: ItemActividad[];
  total: number;
  hay_mas: boolean;
}
export interface FiltrosActividad {
  desde: string; // periodo elegido (inclusivo)
  hasta: string;
  usuario: string;
  tipo: string;
  categoria: string;
  verAnulados: boolean;
}

export function listarActividad(f: FiltrosActividad, desplazamiento: number, limite = 20) {
  const q = new URLSearchParams({ limite: String(limite), desplazamiento: String(desplazamiento) });
  if (f.desde) q.set("desde", f.desde);
  if (f.hasta) q.set("hasta", f.hasta);
  if (f.usuario) q.set("usuario", f.usuario);
  if (f.tipo) q.set("tipo", f.tipo);
  if (f.categoria) q.set("categoria", f.categoria);
  if (f.verAnulados) q.set("ver_anulados", "true");
  return leerPantalla(`actividad:${JSON.stringify(f)}:${desplazamiento}`, () => api<PaginaActividad>(`/actividad?${q.toString()}`), {
    alLeer: (p) => ent.guardarActividad(p.items),
    superponer: (p, ap) => {
      const items = superponerActividad(p.items, ap, f, desplazamiento === 0);
      return { ...p, items, total: Math.max(0, p.total + items.length - p.items.length) };
    },
  });
}
