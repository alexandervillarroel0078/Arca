// Calculo de periodos en el telefono. Es el MISMO calculo que `backend_arca/app/modulos/periodos/calculo.py`
// (lo comprueba una tabla de casos compartida: compartido/periodos_casos.json). Se calcula aqui, y no se pide
// al servidor, para que navegar entre periodos funcione tambien sin conexion.
//
// El periodo es una VISTA (un filtro de fechas): no cierra ni bloquea nada. `desde` y `hasta` son inclusivos y
// son DIAS de America/La_Paz (nunca UTC).
export type TipoPeriodo = "dia" | "semana" | "mes" | "anio" | "rango";

export interface Rango {
  desde: string; // AAAA-MM-DD, inclusivo
  hasta: string;
}

/** Lo que el usuario eligio. `referencia` null = "el actual" (el que contiene hoy), que sigue a la fecha de hoy. */
export interface Seleccion {
  tipo: TipoPeriodo;
  referencia: string | null;
  desde?: string; // solo en "rango"
  hasta?: string;
}

export interface Periodo extends Rango {
  tipo: TipoPeriodo;
  etiqueta: string;
  esActual: boolean; // contiene hoy
  anterior: Seleccion;
  siguiente: Seleccion;
}

export const SELECCION_INICIAL: Seleccion = { tipo: "mes", referencia: null };

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const dos = (n: number) => String(n).padStart(2, "0");
const iso = (a: number, m: number, d: number) => `${String(a).padStart(4, "0")}-${dos(m)}-${dos(d)}`;
const partes = (f: string): [number, number, number] => {
  const [a, m, d] = f.split("-").map(Number);
  return [a, m, d];
};
const aUTC = (f: string) => {
  const [a, m, d] = partes(f);
  return Date.UTC(a, m - 1, d);
};
const deUTC = (ms: number) => {
  const x = new Date(ms);
  return iso(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate());
};

/** Suma (o resta) dias a una fecha AAAA-MM-DD, sin depender de la zona horaria del aparato. */
export const sumarDias = (f: string, n: number) => deUTC(aUTC(f) + n * 86400000);

/** El dia de La Paz de un instante (Bolivia no cambia de horario: siempre UTC-4). */
export function hoyLaPaz(ahora: Date = new Date()): string {
  return deUTC(ahora.getTime() - 4 * 3600000);
}

const diaDeSemana = (f: string) => (new Date(aUTC(f)).getUTCDay() + 6) % 7; // lunes = 0

export function calcular(tipo: TipoPeriodo, referencia: string, diaInicioMes = 1, desde?: string, hasta?: string): Rango {
  if (!Number.isInteger(diaInicioMes) || diaInicioMes < 1 || diaInicioMes > 28) throw new Error("El día de inicio del mes debe ser de 1 a 28");
  if (tipo === "dia") return { desde: referencia, hasta: referencia };
  if (tipo === "semana") {
    const lunes = sumarDias(referencia, -diaDeSemana(referencia));
    return { desde: lunes, hasta: sumarDias(lunes, 6) };
  }
  if (tipo === "mes") {
    const [a, m, d] = partes(referencia);
    const [ia, im] = d >= diaInicioMes ? [a, m] : m === 1 ? [a - 1, 12] : [a, m - 1];
    const [sa, sm] = im === 12 ? [ia + 1, 1] : [ia, im + 1];
    return { desde: iso(ia, im, diaInicioMes), hasta: sumarDias(iso(sa, sm, diaInicioMes), -1) };
  }
  if (tipo === "anio") {
    const [a] = partes(referencia);
    return { desde: iso(a, 1, 1), hasta: iso(a, 12, 31) };
  }
  if (!desde || !hasta) throw new Error("Un rango necesita las fechas desde y hasta");
  if (desde > hasta) throw new Error("La fecha desde no puede ser posterior a la fecha hasta");
  return { desde, hasta };
}

const largo = (r: Rango) => (aUTC(r.hasta) - aUTC(r.desde)) / 86400000 + 1;

export function anterior(tipo: TipoPeriodo, r: Rango, diaInicioMes = 1): Rango {
  if (tipo === "rango") return { desde: sumarDias(r.desde, -largo(r)), hasta: sumarDias(r.desde, -1) };
  return calcular(tipo, sumarDias(r.desde, -1), diaInicioMes);
}

export function siguiente(tipo: TipoPeriodo, r: Rango, diaInicioMes = 1): Rango {
  if (tipo === "rango") return { desde: sumarDias(r.hasta, 1), hasta: sumarDias(r.hasta, largo(r)) };
  return calcular(tipo, sumarDias(r.hasta, 1), diaInicioMes);
}

export const contiene = (r: Rango, dia: string) => r.desde <= dia && dia <= r.hasta;

const corto = (f: string, conAnio = false) => {
  const [a, m, d] = partes(f);
  return `${d} ${MESES_CORTOS[m - 1]}${conAnio ? ` ${a}` : ""}`;
};

/** Texto legible: "Noviembre 2026", "28 oct - 27 nov", "2026", "8 nov 2026". */
export function etiqueta(tipo: TipoPeriodo, r: Rango): string {
  if (tipo === "dia" || r.desde === r.hasta) return corto(r.desde, true); // un solo dia, sea cual sea el tipo
  if (tipo === "anio") return String(partes(r.desde)[0]);
  if (tipo === "mes") {
    const [a, m, d] = partes(r.desde);
    if (d === 1) return `${MESES[m - 1][0].toUpperCase()}${MESES[m - 1].slice(1)} ${a}`;
    return `${corto(r.desde)} - ${corto(r.hasta)}`;
  }
  return partes(r.desde)[0] === partes(r.hasta)[0] ? `${corto(r.desde)} - ${corto(r.hasta, true)}` : `${corto(r.desde, true)} - ${corto(r.hasta, true)}`;
}

/** Selecciona el periodo `r` de ese tipo; si contiene hoy se guarda como "el actual". */
function seleccionDe(tipo: TipoPeriodo, r: Rango, hoy: string): Seleccion {
  if (tipo === "rango") return { tipo, referencia: null, desde: r.desde, hasta: r.hasta };
  return { tipo, referencia: contiene(r, hoy) ? null : r.desde };
}

/** Resuelve lo elegido a fechas concretas, con su etiqueta, el anterior y el siguiente. */
export function resolverPeriodo(sel: Seleccion, diaInicioMes = 1, hoy: string = hoyLaPaz()): Periodo {
  const r = calcular(sel.tipo, sel.referencia ?? hoy, diaInicioMes, sel.desde, sel.hasta);
  return {
    ...r,
    tipo: sel.tipo,
    etiqueta: etiqueta(sel.tipo, r),
    esActual: contiene(r, hoy),
    anterior: seleccionDe(sel.tipo, anterior(sel.tipo, r, diaInicioMes), hoy),
    siguiente: seleccionDe(sel.tipo, siguiente(sel.tipo, r, diaInicioMes), hoy),
  };
}

/** Una seleccion para "esta semana", "este mes", etc. (el periodo actual de ese tipo). */
export const seleccionActual = (tipo: Exclude<TipoPeriodo, "rango">): Seleccion => ({ tipo, referencia: null });

export const enRango = (fecha: string, r: Rango) => r.desde <= fecha && fecha <= r.hasta;

/** Clave estable para guardar lecturas en el cache por periodo. */
export const claveRango = (r: Rango) => `${r.desde}_${r.hasta}`;

/** Texto de la pantalla "Mes actual" vs. un periodo anterior (para el aviso discreto de Inicio). */
export const NOMBRE_TIPO: Record<TipoPeriodo, string> = { dia: "Hoy", semana: "Semana", mes: "Mes", anio: "Año", rango: "Rango" };

/**
 * Contra que periodo se compara uno en Reportes (identico a `periodo_comparacion` del backend). Mes, semana y anio:
 * el periodo ANTERIOR DEL MISMO TIPO (el de la flecha "anterior", con el dia de inicio del mes). Dia y rango (o un
 * tramo que no es exactamente un periodo de su tipo): un tramo del mismo largo inmediatamente antes.
 */
function esPeriodoExacto(tipo: TipoPeriodo, r: Rango, diaInicioMes: number): boolean {
  if (tipo === "dia" || tipo === "rango") return false;
  const e = calcular(tipo, r.desde, diaInicioMes);
  return e.desde === r.desde && e.hasta === r.hasta;
}

export function periodoComparacion(tipo: TipoPeriodo, r: Rango, diaInicioMes = 1): Rango {
  if (esPeriodoExacto(tipo, r, diaInicioMes)) return anterior(tipo, r, diaInicioMes);
  return { desde: sumarDias(r.desde, -largo(r)), hasta: sumarDias(r.desde, -1) };
}

/** "vs octubre 2026", "vs 28 sep - 27 oct", "vs 2025" (identico a `etiqueta_comparacion` del backend). */
export function etiquetaComparacion(tipo: TipoPeriodo, r: Rango, diaInicioMes = 1): string {
  const c = periodoComparacion(tipo, r, diaInicioMes);
  const texto = etiqueta(esPeriodoExacto(tipo, r, diaInicioMes) || tipo === "dia" ? tipo : "rango", c);
  return `vs ${texto[0].toLowerCase()}${texto.slice(1)}`;
}
