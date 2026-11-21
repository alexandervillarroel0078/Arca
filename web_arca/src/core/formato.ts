// Formatos de moneda y fecha (Bs, es-BO).
import { diaSemanaCorto } from "./periodo";

const fmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const bs = (n: number) => `${n < 0 ? "-" : ""}Bs ${fmt.format(Math.abs(n))}`;

const dos = (n: number) => String(n).padStart(2, "0");

/** Fecha local de hoy como AAAA-MM-DD. */
export function hoyISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

/** Fecha local de ayer como AAAA-MM-DD. */
export function ayerISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

export const mesActual = () => hoyISO().slice(0, 7);

const ZONA_LA_PAZ = "America/La_Paz";
const RELOJ_LA_PAZ = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA_LA_PAZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

/**
 * Fecha ("AAAA-MM-DD") y hora ("HH:MM") actuales en La Paz, NO en la zona del aparato. Es el reloj del servidor: lo usan
 * los flujos que guardan hora (Cuentas). `hoyISO` sigue con la zona del aparato para no cambiar los demás flujos.
 */
export function ahoraLaPaz(ahora: Date = new Date()): { fecha: string; hora: string } {
  const p = Object.fromEntries(RELOJ_LA_PAZ.formatToParts(ahora).map((x) => [x.type, x.value]));
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour === "24" ? "00" : p.hour}:${p.minute}` };
}

/** Hoy en La Paz como AAAA-MM-DD. */
export const hoyLaPazISO = () => ahoraLaPaz().fecha;

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MESES_LARGO = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

/** "14 nov", o "14 nov (sáb)" con `conDia`. Sin la regla "Hoy": quien la necesite la decide antes. */
export function diaMes(iso: string, conDia = false): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MESES[m - 1]}${conDia ? ` (${diaSemanaCorto(iso)})` : ""}`;
}

/** "Hoy" si es hoy (en el aparato, o el `hoy` que se pase); si no, `diaMes`. "Hoy" nunca lleva dia. */
export function fechaCorta(iso: string, { conDia = false, hoy = hoyISO() }: { conDia?: boolean; hoy?: string } = {}): string {
  if (iso === hoy) return "Hoy";
  return diaMes(iso, conDia);
}

export function nombreMes(aaaamm: string, corto = false): string {
  const [a, m] = aaaamm.split("-").map(Number);
  return corto ? MESES[m - 1] : `${MESES_LARGO[m - 1]} ${a}`;
}

export function mesDesplazado(aaaamm: string, delta: number): string {
  const [a, m] = aaaamm.split("-").map(Number);
  const d = new Date(a, m - 1 + delta, 1);
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}`;
}

const ICONOS: Record<string, string> = {
  bus: "🚌", utensils: "🍽️", cookie: "🍪", zap: "💡", fuel: "⛽", tag: "🏷️",
  shirt: "👕", home: "🏠", heart: "❤️", book: "📚", gift: "🎁", car: "🚗", phone: "📱",
};
export const iconoDe = (nombre: string | null | undefined) => ICONOS[nombre ?? ""] ?? "🏷️";
export const ICONOS_DISPONIBLES = Object.keys(ICONOS);
