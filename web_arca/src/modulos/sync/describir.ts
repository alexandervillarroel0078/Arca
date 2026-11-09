// Texto legible de cada operacion de la cola y comparacion "la mia" / "la del servidor" de un conflicto.
import { bs, fechaCorta } from "../../core/formato";
import type { Categoria } from "../familia/api";
import * as ent from "./entidades";
import type { Operacion } from "./tipos";

type Datos = Record<string, any>;

const num = (v: unknown) => Number(v);

/** "Gasto de Bs 45.00 · Almuerzo (nuevo)", "Editar apoyo de Tia Rosa (Bs 300.00)"... */
export async function describirOperacion(op: Operacion): Promise<string> {
  const d = op.datos as Datos;
  if (op.accion === "crear") {
    if (op.entidad === "movimiento") return `${d.tipo === "ingreso" ? "Ingreso" : "Gasto"} nuevo de ${bs(num(d.monto))}${d.nota ? ` · ${d.nota}` : ""}`;
    if (op.entidad === "apoyo") return `Apoyo nuevo a ${d.beneficiario} de ${bs(num(d.monto))}`;
    return `Devolución nueva de ${bs(num(d.monto))}`;
  }
  const verbo = { editar: "Editar", anular: "Anular", reactivar: "Reactivar" }[op.accion];
  if (op.entidad === "movimiento") {
    const m = op.entidadId != null ? await ent.leerMovimiento(op.entidadId) : undefined;
    return m ? `${verbo} ${m.tipo === "ingreso" ? "ingreso" : "gasto"} ${m.nota?.trim() || m.categoria_nombre || ""} (${bs(m.monto)})`.replace("  ", " ") : `${verbo} movimiento`;
  }
  const apoyoId = op.entidad === "apoyo" ? op.entidadId : op.apoyoId;
  const a = apoyoId != null ? await ent.leerApoyo(apoyoId) : undefined;
  if (op.entidad === "apoyo") return a ? `${verbo} apoyo a ${a.beneficiario} (${bs(a.monto)})` : `${verbo} apoyo`;
  const dev = a?.devoluciones.find((x) => x.id === op.entidadId);
  return a ? `${verbo} devolución de ${a.beneficiario}${dev ? ` (${bs(dev.monto)})` : ""}` : `${verbo} devolución`;
}

export interface FilaConflicto {
  campo: string;
  mia: string;
  servidor: string;
}

const ETIQUETAS: Record<string, string> = {
  tipo: "Tipo", monto: "Monto", fecha: "Fecha", categoria_id: "Categoría", nota: "Nota", beneficiario: "Beneficiario",
};

function mostrar(campo: string, v: unknown, categorias: Categoria[]): string {
  if (v === null || v === undefined || v === "") return "(vacío)";
  if (campo === "monto") return bs(num(v));
  if (campo === "fecha") return fechaCorta(String(v));
  if (campo === "categoria_id") return categorias.find((c) => c.id === v)?.nombre ?? `#${String(v)}`;
  if (campo === "tipo") return v === "ingreso" ? "Ingreso" : "Gasto";
  return String(v);
}

/** Lo que cambiaria el usuario frente a lo que hay ahora en el servidor, campo por campo. */
export function compararConflicto(op: Operacion, categorias: Categoria[]): FilaConflicto[] {
  const actual = (op.conflicto?.actual ?? {}) as Datos;
  if (op.accion === "editar") {
    return Object.entries(op.datos as Datos)
      .filter(([k]) => k !== "version_base")
      .map(([k, v]) => ({
        campo: ETIQUETAS[k] ?? k,
        mia: mostrar(k, v, categorias),
        servidor: mostrar(k, k === "categoria_id" ? actual.categoria_id : actual[k], categorias),
      }));
  }
  const quien = actual.editado_por_nombre || actual.anulado_por_nombre;
  const estado = actual.anulado ? `Anulado${actual.anulado_por_nombre ? ` por ${actual.anulado_por_nombre}` : ""}` : `Activo${quien ? ` (editado por ${quien})` : ""}`;
  return [{ campo: "Estado", mia: op.accion === "anular" ? "Anulado" : "Activo", servidor: estado }];
}
