// Dictado de movimientos: números hablados. Módulo PURO (sin DOM, sin red, sin almacenes).
// Los montos son SIEMPRE texto o BigInt: aquí no se usa Number ni float, y jamás se redondea.

/** Minúsculas, sin tildes ni signos; deja intactos los puntos y comas que van DENTRO de una cifra ("1.500", "100,50"). */
export function normalizar(frase: string): string {
  return frase
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9.,\s]/g, " ")
    .replace(/(\d)?([.,])(\d)?/g, (m, a: string | undefined, _s: string, b: string | undefined) => (a && b ? m : `${a ?? ""} ${b ?? ""}`))
    .replace(/\s+/g, " ")
    .trim();
}

export const tokens = (frase: string): string[] => {
  const n = normalizar(frase);
  return n === "" ? [] : n.split(" ");
};

const UNIDADES: Record<string, bigint> = {
  cero: 0n, un: 1n, uno: 1n, una: 1n, dos: 2n, tres: 3n, cuatro: 4n, cinco: 5n, seis: 6n, siete: 7n, ocho: 8n, nueve: 9n,
};
const ESPECIALES: Record<string, bigint> = {
  diez: 10n, once: 11n, doce: 12n, trece: 13n, catorce: 14n, quince: 15n, dieciseis: 16n, diecisiete: 17n, dieciocho: 18n, diecinueve: 19n,
  veinte: 20n, veintiun: 21n, veintiuno: 21n, veintiuna: 21n, veintidos: 22n, veintitres: 23n, veinticuatro: 24n, veinticinco: 25n,
  veintiseis: 26n, veintisiete: 27n, veintiocho: 28n, veintinueve: 29n,
};
const DECENAS: Record<string, bigint> = { treinta: 30n, cuarenta: 40n, cincuenta: 50n, sesenta: 60n, setenta: 70n, ochenta: 80n, noventa: 90n };
const CENTENAS: Record<string, bigint> = {
  cien: 100n, ciento: 100n, doscientos: 200n, doscientas: 200n, trescientos: 300n, trescientas: 300n, cuatrocientos: 400n, cuatrocientas: 400n,
  quinientos: 500n, quinientas: 500n, seiscientos: 600n, seiscientas: 600n, setecientos: 700n, setecientas: 700n,
  ochocientos: 800n, ochocientas: 800n, novecientos: 900n, novecientas: 900n,
};

const SOLO_DIGITOS = /^\d+$/;
const MONEDAS_HABLADAS: Record<string, "BS" | "USD" | "USDT" | "BTC"> = {
  boliviano: "BS", bolivianos: "BS", boliviana: "BS", bolivianas: "BS", bs: "BS",
  dolar: "USD", dolares: "USD", usd: "USD",
  usdt: "USDT", tether: "USDT",
  bitcoin: "BTC", bitcoins: "BTC", btc: "BTC",
};
export const monedaHablada = (t: string) => MONEDAS_HABLADAS[t] ?? null;
const esMoneda = (t: string | undefined) => t !== undefined && t in MONEDAS_HABLADAS;
const esCentavos = (t: string | undefined) => t === "centavo" || t === "centavos" || t === "cts" || t === "ctvs";
const MESES = new Set(["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "setiembre", "octubre", "noviembre", "diciembre"]);

/** ¿Este token puede abrir o seguir un número? ("y" solo vale dentro de «treinta y cinco»; lo decide la máquina de estados.) */
const esPalabraNumerica = (t: string) =>
  t in UNIDADES || t in ESPECIALES || t in DECENAS || t in CENTENAS || t === "mil" || t === "millon" || t === "millones";

/** ¿Es una cifra o una palabra de número? (el intérprete lo usa para no confundir «100 bs» con el nombre de una cuenta) */
export const esNumerico = (t: string) => /^\d/.test(t) || esPalabraNumerica(t);

type Clase = "u" | "t" | "d" | "dy" | "c" | "dig" | "mil" | "millon";

interface Entero {
  valor: bigint;
  fin: number; // índice del primer token que ya no es parte del número
}

/** Lee un entero hablado o en cifras sueltas ("mil quinientos", "2 mil 500", "treinta y cinco") desde `i`. */
function leerEntero(t: string[], i: number): Entero | null {
  let total = 0n;
  let cur = 0n;
  let clase: Clase | null = null;
  let usoMil = false;
  let usoMillon = false;
  let vio = false;
  let j = i;
  for (; j < t.length; j++) {
    const w = t[j];
    if (SOLO_DIGITOS.test(w)) {
      if (clase !== null && clase !== "mil" && clase !== "millon") break;
      cur += BigInt(w);
      clase = "dig";
    } else if (w in UNIDADES) {
      const v = UNIDADES[w];
      if (v === 0n) {
        if (vio) break;
        clase = "u";
      } else if (clase === null || clase === "c" || clase === "dy" || clase === "mil" || clase === "millon") clase = "u";
      else break;
      cur += v;
    } else if (w in ESPECIALES) {
      if (clase !== null && clase !== "c" && clase !== "mil" && clase !== "millon") break;
      cur += ESPECIALES[w];
      clase = "t";
    } else if (w in DECENAS) {
      if (clase !== null && clase !== "c" && clase !== "mil" && clase !== "millon") break;
      cur += DECENAS[w];
      clase = "d";
    } else if (w in CENTENAS) {
      if (clase !== null && clase !== "mil" && clase !== "millon") break;
      cur += CENTENAS[w];
      clase = "c";
    } else if (w === "y") {
      const sig = t[j + 1];
      if (clase === "d" && sig !== undefined && sig in UNIDADES && UNIDADES[sig] > 0n) clase = "dy";
      else break;
    } else if (w === "mil") {
      if (usoMil) break;
      total += (cur === 0n ? 1n : cur) * 1000n;
      cur = 0n;
      usoMil = true;
      clase = "mil";
    } else if (w === "millon" || w === "millones") {
      if (usoMil || usoMillon) break;
      total += (cur === 0n ? 1n : cur) * 1000000n;
      cur = 0n;
      usoMillon = true;
      clase = "millon";
    } else break;
    vio = true;
  }
  if (!vio) return null;
  return { valor: total + cur, fin: j };
}

/** "1.500" puede ser mil quinientos o uno coma cinco: se devuelve la lectura de miles y, aparte, la decimal. */
interface Cifra {
  entero: string;
  decimales: string | null;
  alternativa: string | null;
}

const CIFRA_COMPUESTA = /^\d+[.,]\d+([.,]\d+)*$/;

function leerCifra(w: string): Cifra | "dudoso" | null {
  if (!CIFRA_COMPUESTA.test(w)) return null;
  const tienePunto = w.includes(".");
  const tieneComa = w.includes(",");
  const partes = w.split(/[.,]/);
  if (tienePunto && tieneComa) {
    // el ÚLTIMO separador es el decimal; los anteriores deben ser del otro tipo y agrupar de a 3
    const sepDec = w[w.length - partes[partes.length - 1].length - 1];
    const sepMil = sepDec === "." ? "," : ".";
    const grupos = w.slice(0, w.length - partes[partes.length - 1].length - 1).split(sepMil);
    if (grupos.length < 2 || grupos.some((g) => g.includes(sepDec)) || grupos[0].length > 3 || grupos.slice(1).some((g) => g.length !== 3)) return "dudoso";
    return { entero: grupos.join(""), decimales: partes[partes.length - 1], alternativa: null };
  }
  if (partes.length > 2) {
    // varios separadores iguales: solo grupos de miles
    if (partes[0].length > 3 || partes.slice(1).some((g) => g.length !== 3)) return "dudoso";
    return { entero: partes.join(""), decimales: null, alternativa: null };
  }
  const [a, b] = partes;
  if (b.length === 3 && a.length <= 3 && !a.startsWith("0")) return { entero: a + b, decimales: null, alternativa: `${a}.${b}` };
  return { entero: a, decimales: b, alternativa: null };
}

export type LecturaMonto =
  | { tipo: "ok"; texto: string; alternativa: string | null }
  | { tipo: "dudoso"; motivo: string }
  | { tipo: "ninguno" };

interface Corrida {
  inicio: number;
  fin: number;
  lectura: LecturaMonto;
  puntos: number;
}

const DIGITO_HABLADO = (w: string) => (w in UNIDADES && UNIDADES[w] < 10n ? UNIDADES[w].toString() : null);

/** Parte decimal después de «con» / «coma» / «punto». «con cincuenta» son 50 centavos; «con cinco», 05. */
function leerDecimales(t: string[], i: number): { decimales: string; fin: number } | "dudoso" | null {
  const marca = t[i];
  if (marca === "con") {
    const w = t[i + 1];
    if (w === undefined) return null;
    if (SOLO_DIGITOS.test(w) && !(w in UNIDADES)) {
      if (w.length > 2) return "dudoso";
      let fin = i + 2;
      if (esCentavos(t[fin])) fin++;
      return { decimales: w.padStart(2, "0"), fin };
    }
    const e = leerEntero(t, i + 1);
    if (!e) return null;
    if (e.valor > 99n) return "dudoso";
    let fin = e.fin;
    if (esCentavos(t[fin])) fin++;
    return { decimales: e.valor.toString().padStart(2, "0"), fin };
  }
  if (marca === "coma" || marca === "punto") {
    let d = "";
    let j = i + 1;
    for (; j < t.length; j++) {
      const w = t[j];
      const dh = DIGITO_HABLADO(w);
      if (dh !== null) d += dh;
      else if (SOLO_DIGITOS.test(w)) d += w;
      else break;
    }
    if (d === "") {
      const e = leerEntero(t, i + 1);
      if (!e || e.valor > 99n) return null;
      return { decimales: e.valor.toString().padStart(2, "0"), fin: e.fin };
    }
    return { decimales: d, fin: j };
  }
  return null;
}

/** Busca todas las cantidades de la frase y se queda con la que más parece el monto. */
export function leerMonto(t: string[]): LecturaMonto {
  const corridas: Corrida[] = [];
  for (let i = 0; i < t.length; ) {
    const w = t[i];
    const cifra = leerCifra(w);
    let c: Corrida | null = null;
    if (cifra) {
      const sig = t[i + 1];
      if (cifra === "dudoso" || sig === "mil" || sig === "millon" || sig === "millones") {
        c = { inicio: i, fin: i + (sig === "mil" || sig === "millon" || sig === "millones" ? 2 : 1), lectura: { tipo: "dudoso", motivo: "No supe leer la cantidad con puntos y comas" }, puntos: 0 };
      } else {
        const texto = cifra.decimales !== null ? `${cifra.entero}.${cifra.decimales}` : cifra.entero;
        c = { inicio: i, fin: i + 1, lectura: { tipo: "ok", texto, alternativa: cifra.alternativa }, puntos: 0 };
      }
    } else if (SOLO_DIGITOS.test(w) || esPalabraNumerica(w)) {
      const e = leerEntero(t, i);
      if (e) {
        let fin = e.fin;
        let lectura: LecturaMonto = { tipo: "ok", texto: e.valor.toString(), alternativa: null };
        // «cien bolivianos con cincuenta»: la moneda puede ir entre el entero y los decimales
        const ini = esMoneda(t[fin]) && ["con", "coma", "punto"].includes(t[fin + 1] ?? "") ? fin + 1 : fin;
        const d = ["con", "coma", "punto"].includes(t[ini] ?? "") ? leerDecimales(t, ini) : null;
        if (d === "dudoso") lectura = { tipo: "dudoso", motivo: "No supe leer los decimales" };
        else if (d) {
          lectura = { tipo: "ok", texto: `${e.valor}.${d.decimales}`, alternativa: null };
          fin = d.fin;
        }
        // un «un/una» suelto es el artículo («un depósito»), no una cantidad
        const soloArticulo = e.fin === i + 1 && (w === "un" || w === "una" || w === "uno") && !esMoneda(t[fin]) && t[fin] !== "mil";
        c = soloArticulo ? null : { inicio: i, fin, lectura, puntos: 0 };
        if (!c) {
          i = e.fin;
          continue;
        }
      }
    }
    if (!c) {
      i++;
      continue;
    }
    // Se descartan las que son otra cosa: «terminada en 4821», «3 de noviembre»
    const ant = t[c.inicio - 1];
    const ant2 = t[c.inicio - 2];
    const marcaCuenta = new Set(["terminada", "terminado", "termina", "acabada", "ultimos", "ultimo", "numero", "nro", "tarjeta"]);
    const siguiente = t[c.fin];
    const esFecha = siguiente !== undefined && (MESES.has(siguiente) || (siguiente === "de" && MESES.has(t[c.fin + 1] ?? "")));
    if ((ant !== undefined && marcaCuenta.has(ant)) || (ant === "en" && ant2 !== undefined && marcaCuenta.has(ant2)) || esFecha) {
      i = c.fin;
      continue;
    }
    if (esMoneda(siguiente) || esCentavos(siguiente)) c.puntos += 2;
    if (ant === "de" || ant === "por" || ant === "monto" || ant === "con") c.puntos += 1;
    corridas.push(c);
    i = c.fin;
  }
  if (corridas.length === 0) return { tipo: "ninguno" };
  const mejor = Math.max(...corridas.map((c) => c.puntos));
  const top = corridas.filter((c) => c.puntos === mejor);
  const claves = new Set(top.map((c) => JSON.stringify(c.lectura)));
  if (claves.size > 1) return { tipo: "dudoso", motivo: "Escuché más de una cantidad" };
  return top[0].lectura;
}

/** Moneda que el usuario nombró en la frase ("bolivianos", "dólares", "bitcoin"), si nombró una. */
export function monedaNombrada(t: string[]): "BS" | "USD" | "USDT" | "BTC" | null {
  for (const w of t) {
    const m = monedaHablada(w);
    if (m) return m;
  }
  return null;
}
