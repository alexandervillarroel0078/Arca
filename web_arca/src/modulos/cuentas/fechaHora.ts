// Fecha y hora de los movimientos de Cuentas. La hora es LOCAL de La Paz ("HH:MM"), opcional; "hoy" y "ahora" se calculan
// en La Paz (no en la zona del aparato), igual que el servidor, que es quien valida al final.
import { ahoraLaPaz, fechaCorta } from "../../core/formato";

export type Ahora = { fecha: string; hora: string };

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "HH:MM" a partir de lo que da un <input type="time"> (algunos navegadores agregan segundos); "" si está vacío. */
export const normalizarHora = (h: string) => h.slice(0, 5);

/**
 * Errores de fecha y hora (o null). La hora vacía vale ("sin hora"; al registrar hoy, el servidor pone la actual).
 * Nada puede quedar en el futuro de La Paz.
 */
export function erroresFechaHora(fecha: string, hora: string, ahora: Ahora = ahoraLaPaz()): { fecha: string | null; hora: string | null } {
  if (!RE_FECHA.test(fecha)) return { fecha: "Elige una fecha", hora: null };
  if (fecha > ahora.fecha) return { fecha: "La fecha no puede ser posterior a hoy", hora: null };
  const h = normalizarHora(hora);
  if (h && !RE_HORA.test(h)) return { fecha: null, hora: "Escribe una hora válida" };
  if (h && fecha === ahora.fecha && h > ahora.hora) return { fecha: null, hora: "La hora no puede ser posterior a la hora actual" };
  return { fecha: null, hora: null };
}

/** "Hoy 14:30", "3 nov 09:05", o solo "Hoy" / "3 nov" si no tiene hora (los movimientos anteriores a la hora). */
export function fechaHoraCorta(fecha: string, hora: string | null, hoy = ahoraLaPaz().fecha): string {
  const f = fechaCorta(fecha, { hoy });
  return hora ? `${f} ${hora}` : f;
}
