// Montos de Cuentas: SIEMPRE texto decimal. Sumar, comparar y restar se hace con BigInt (escala fija de 8 decimales),
// nunca con Number ni float: 0.1 + 0.2 tiene que dar 0.3 exacto y 0.00000001 BTC no se puede perder.
export type Moneda = "BS" | "USD" | "USDT" | "BTC";
export const MONEDAS: Moneda[] = ["BS", "USD", "USDT", "BTC"];

/** Decimales que admite cada moneda (la misma regla que valida el servidor). */
export const DECIMALES: Record<Moneda, number> = { BS: 2, USD: 2, USDT: 8, BTC: 8 };
export const NOMBRE_MONEDA: Record<Moneda, string> = { BS: "Bs", USD: "USD", USDT: "USDT", BTC: "BTC" };

const ESCALA = 8;
const FACTOR = 10n ** BigInt(ESCALA);
const MAX_ENTEROS = 16; // Numeric(24,8) en el servidor

/** Un monto es un entero en unidades de 0.00000001. */
export type Monto = bigint;

/**
 * Texto -> Monto. Acepta "12", "12.5", "12,5", ".5", "-3.25" (el signo solo si `conSigno`). Devuelve null si no es un numero
 * o si trae mas de 8 decimales (nunca se redondea).
 */
export function aMonto(texto: string, conSigno = true): Monto | null {
  const t = texto.trim().replace(",", ".");
  const m = /^(-)?(\d*)(?:\.(\d*))?$/.exec(t);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) return null;
  if (m[1] && !conSigno) return null;
  const decimales = m[3] ?? "";
  if (decimales.length > ESCALA) return null;
  const enteros = m[2] === "" ? "0" : m[2];
  const valor = BigInt(enteros) * FACTOR + BigInt(decimales.padEnd(ESCALA, "0") || "0");
  return m[1] ? -valor : valor;
}

/** Cantidad de decimales significativos de un texto (sin contar ceros finales): "10.500" -> 1. */
export function decimalesDe(texto: string): number {
  const t = texto.trim().replace(",", ".");
  const i = t.indexOf(".");
  if (i < 0) return 0;
  return t.slice(i + 1).replace(/0+$/, "").length;
}

/**
 * Mensaje de error de un monto escrito para esa moneda, o null si esta bien. `positivo`: debe ser mayor que cero.
 * `negativo`: se admite el signo menos (saldo real de un ajuste).
 */
export function errorDeMonto(texto: string, moneda: Moneda, o: { positivo?: boolean; negativo?: boolean; obligatorio?: boolean } = {}): string | null {
  const { positivo = true, negativo = false, obligatorio = true } = o;
  if (texto.trim() === "") return obligatorio ? "Escribe el monto" : null;
  const t = texto.trim().replace(",", ".");
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return "Escribe solo números, con punto o coma decimal";
  if (t.startsWith("-") && !negativo) return "El monto no puede ser negativo";
  if (decimalesDe(t) > DECIMALES[moneda]) {
    const n = DECIMALES[moneda];
    return `${NOMBRE_MONEDA[moneda]} admite hasta ${n} decimales`;
  }
  const entero = t.replace("-", "").split(".")[0].replace(/^0+/, "");
  if (entero.length > MAX_ENTEROS) return "El monto es demasiado grande";
  const m = aMonto(t, true);
  if (m === null) return "Monto no válido";
  if (positivo && m <= 0n) return "El monto debe ser mayor que cero";
  return null;
}

export const sumar = (montos: Monto[]): Monto => montos.reduce((a, b) => a + b, 0n);
export const comparar = (a: Monto, b: Monto): -1 | 0 | 1 => (a < b ? -1 : a > b ? 1 : 0);
export const esNegativo = (m: Monto) => m < 0n;
export const abs = (m: Monto): Monto => (m < 0n ? -m : m);

function agrupar(enteros: string): string {
  return enteros.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Numero sin moneda: Bs y USD siempre con 2 decimales; USDT y BTC hasta 8 SIN ceros sobrantes (pero minimo 2).
 * "1234.5" BS -> "1,234.50"; "0.50000000" BTC -> "0.50"; "0.00012345" BTC -> "0.00012345".
 */
export function numero(m: Monto, moneda: Moneda): string {
  const neg = m < 0n;
  const v = neg ? -m : m;
  const enteros = (v / FACTOR).toString();
  let dec = (v % FACTOR).toString().padStart(ESCALA, "0");
  const n = DECIMALES[moneda];
  if (n === 2) dec = dec.slice(0, 2); // en Bs y USD los montos vienen con 2 decimales exactos (el servidor los valida)
  else dec = dec.replace(/0+$/, "").padEnd(2, "0");
  return `${neg ? "-" : ""}${agrupar(enteros)}.${dec}`;
}

/** Con moneda: "Bs 1,234.50", "USD 10.00", "USDT 25.5000", "BTC 0.00012345". El signo menos va delante de todo. */
export function formatear(m: Monto, moneda: Moneda): string {
  const n = numero(abs(m), moneda);
  return `${m < 0n ? "-" : ""}${NOMBRE_MONEDA[moneda]} ${n}`;
}

/** Texto del servidor -> texto con formato. Si el texto no es un monto valido, se devuelve tal cual. */
export function formatearTexto(texto: string | null | undefined, moneda: Moneda): string {
  if (texto == null) return "";
  const m = aMonto(texto);
  return m === null ? texto : formatear(m, moneda);
}

/** Monto -> texto para mandar al servidor y para los campos: sin separadores, con la escala de la moneda en Bs y USD. */
export function aTexto(m: Monto, moneda: Moneda): string {
  const neg = m < 0n;
  const v = neg ? -m : m;
  const enteros = (v / FACTOR).toString();
  const dec = (v % FACTOR).toString().padStart(ESCALA, "0");
  const n = DECIMALES[moneda];
  const corto = n === 2 ? dec.slice(0, 2) : dec.replace(/0+$/, "");
  return `${neg ? "-" : ""}${enteros}${corto ? `.${corto}` : ""}`;
}

/** Suma textos del servidor agrupados por moneda: un total POR moneda, jamas se suman monedas distintas. */
export function totalesPorMoneda(filas: { moneda: Moneda; monto: string }[]): { moneda: Moneda; total: Monto }[] {
  const por = new Map<Moneda, Monto>();
  for (const f of filas) {
    const m = aMonto(f.monto);
    if (m !== null) por.set(f.moneda, (por.get(f.moneda) ?? 0n) + m);
  }
  return MONEDAS.filter((mo) => por.has(mo)).map((mo) => ({ moneda: mo, total: por.get(mo)! }));
}
