/** Datos de auditoria que devuelve el backend en movimientos, apoyos y devoluciones. */
export interface Auditoria {
  /** Sube con cada cambio del registro en el servidor; las ediciones envian la version en la que se basaron (409 si cambio). */
  version: number;
  uuid_cliente: string | null;
  /** Solo en el telefono: el registro (o un cambio sobre el) aun no se envio al servidor. */
  sinSincronizar?: boolean;
  /** Solo en el telefono: un cambio pendiente de este registro esta en conflicto con el servidor. */
  enConflicto?: boolean;
  anulado: boolean;
  anulado_por_nombre: string | null;
  anulado_en: string | null;
  motivo_anulacion: string | null;
  editado_por_nombre: string | null;
  editado_en: string | null;
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "3 nov 14:05" a partir de una fecha ISO con hora. */
export function fechaHora(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getDate()} ${MESES[d.getMonth()]} ${hh}:${mm}`;
}

/** Texto "Anulado por Ana · 3 nov 14:05 · motivo". */
export function textoAnulado(a: Auditoria): string {
  const partes = [`Anulado${a.anulado_por_nombre ? ` por ${a.anulado_por_nombre}` : ""}`];
  if (a.anulado_en) partes.push(fechaHora(a.anulado_en));
  if (a.motivo_anulacion) partes.push(a.motivo_anulacion);
  return partes.join(" · ");
}
