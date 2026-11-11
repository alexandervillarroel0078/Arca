// Dictado de movimientos (ENTREGA A): de una frase a tipo, cuenta, cuenta destino y monto. Módulo PURO: sin DOM, sin red,
// sin almacenes y sin registros en consola. Solo usa los datos que la pantalla ya tiene en memoria (las cuentas donde se
// puede registrar). No hay IA: son reglas simples. Persona y nota NO se interpretan (entrega B).
import type { Cuenta, TipoMovimiento } from "./api";
import { esNumerico, leerMonto, monedaHablada, monedaNombrada, tokens } from "./dictadoNumeros";
import { DECIMALES, errorDeMonto, NOMBRE_MONEDA, type Moneda } from "./montos";
import { destinosDeTraspaso } from "./permisos";

export type CampoDictado = "tipo" | "cuenta" | "destino" | "monto";

/** Más de una cuenta encaja: se pide elegir con un toque. */
export interface Eleccion {
  campo: "cuenta" | "destino";
  opciones: number[]; // ids de cuenta
}

export interface ResultadoDictado {
  /** Dijo «ajuste»: eso no se dicta. Si es true, no se cambia nada. */
  ajuste: boolean;
  /** null = no se entendió: el formulario conserva lo que tenía. */
  tipo: TipoMovimiento | null;
  cuentaId: number | null;
  destinoId: number | null;
  /** Texto decimal ("1500", "100.50") ya validado para la moneda de la cuenta; null = no se entendió o no era válido. */
  monto: string | null;
  /** Campos que hay que revisar, con el motivo. */
  porRevisar: Partial<Record<CampoDictado, string>>;
  elecciones: Eleccion[];
  /** Cuántos campos quedaron rellenados sin dudas. */
  rellenados: number;
}

export interface ContextoDictado {
  /** Cuentas donde se puede registrar (las mismas que ofrece el formulario). */
  cuentas: Cuenta[];
  /** La cuenta que tiene elegida el formulario ahora (se usa cuando no dice cuál). */
  cuentaActualId: number | null;
}

const vacio = (): ResultadoDictado => ({ ajuste: false, tipo: null, cuentaId: null, destinoId: null, monto: null, porRevisar: {}, elecciones: [], rellenados: 0 });

// ---------------------------------------------------------------- tipo
const PALABRAS_TIPO: [TipoMovimiento, RegExp][] = [
  ["ajuste", /^(ajust|conteo|cuadre)/],
  ["deposito", /^(deposit|ingres|abon)/],
  ["retiro", /^(retir|saco$|saca$|sacar$|saque$|extraer$|extrae$)/],
  ["traspaso", /^(traspas|transfer|transfier)|^(pasar|pasa|pase|mover|mueve)$/],
];

function tipoDe(w: string): TipoMovimiento | null {
  for (const [tipo, re] of PALABRAS_TIPO) if (re.test(w)) return tipo;
  return null;
}

// ---------------------------------------------------------------- letras sueltas («b c p», «be ce pe» -> «bcp»)
const LETRAS_HABLADAS: Record<string, string> = {
  be: "b", ce: "c", pe: "p", efe: "f", ge: "g", hache: "h", jota: "j", ka: "k", ele: "l", eme: "m", ene: "n", erre: "r", ese: "s",
  cu: "q", uve: "v", equis: "x", zeta: "z",
};
const esLetraSuelta = (w: string) => w.length === 1 && /[bcdfghjklmnpqrstvwxz]/.test(w);

function unirLetras(t: string[]): string[] {
  const salida: string[] = [];
  for (let i = 0; i < t.length; ) {
    let j = i;
    let letras = "";
    let sueltas = 0;
    while (j < t.length && (esLetraSuelta(t[j]) || t[j] in LETRAS_HABLADAS)) {
      letras += esLetraSuelta(t[j]) ? t[j] : LETRAS_HABLADAS[t[j]];
      if (esLetraSuelta(t[j])) sueltas++;
      j++;
    }
    const n = j - i;
    if (n >= 3 || (n >= 2 && sueltas === n)) {
      salida.push(letras);
      i = j;
    } else {
      salida.push(t[i]);
      i++;
    }
  }
  return salida;
}

// ---------------------------------------------------------------- cuentas
const VACIAS = new Set(["cuenta", "cuentas", "cta", "banco", "bco", "de", "del", "la", "el", "los", "las", "mi", "mis", "en", "y", "a", "al", "con", "sin", "para", "por", "un", "una", "unos", "unas", "otro"]);
const SINONIMOS_TIPO: Record<Cuenta["tipo"], string[]> = {
  efectivo: ["caja", "efectivo", "cash"],
  ahorro: ["ahorro", "ahorros"],
  corriente: ["corriente"],
  cripto: ["cripto", "criptomoneda", "billetera", "wallet"],
};

const distintivos = (texto: string): string[] => [...new Set(tokens(texto).filter((w) => w.length >= 2 && !VACIAS.has(w) && !/^\d+$/.test(w)))];

/** ¿Difieren en a lo sumo una letra? */
function aLoSumoUnaLetra(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i === a.length || i === b.length) return true;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}
/** Igual, o casi igual cuando la palabra es larga (el reconocedor a veces cambia una letra). */
const parecida = (dicha: string, nombre: string) => dicha === nombre || (dicha.length >= 5 && nombre.length >= 5 && aLoSumoUnaLetra(dicha, nombre));

interface Coincidencia {
  cuenta: Cuenta;
  puntos: number;
  indices: number[]; // posiciones de las palabras que encajaron
}

function coincidencias(t: string[], cuentas: Cuenta[]): Coincidencia[] {
  const salida: Coincidencia[] = [];
  const buscar = (tok: string) => t.findIndex((w) => !/^\d/.test(w) && parecida(w, tok));
  for (const c of cuentas) {
    const indices: number[] = [];
    let puntos = 0;
    const nombre = distintivos(c.nombre);
    let aciertos = 0;
    for (const tok of nombre) {
      const i = buscar(tok);
      if (i >= 0) {
        aciertos++;
        puntos += 3;
        indices.push(i);
      }
    }
    if (nombre.length > 0 && aciertos === nombre.length) puntos += 3;
    const banco = distintivos([c.banco, c.banco_otro].filter(Boolean).join(" "));
    let aciertosBanco = 0;
    for (const tok of banco) {
      const i = buscar(tok);
      if (i >= 0) {
        aciertosBanco++;
        puntos += 2;
        indices.push(i);
      }
    }
    if (banco.length > 0 && aciertosBanco === banco.length) puntos += 1;
    if (c.ultimos4) {
      const i = t.indexOf(c.ultimos4);
      if (i >= 0) {
        puntos += 8;
        indices.push(i);
      }
    }
    const sin = SINONIMOS_TIPO[c.tipo];
    const k = t.findIndex((w) => sin.includes(w));
    if (k >= 0) {
      puntos += 1;
      indices.push(k);
    }
    if (puntos > 0) salida.push({ cuenta: c, puntos, indices });
  }
  return salida;
}

type Resolucion =
  | { tipo: "unica"; cuenta: Cuenta; indices: number[] }
  | { tipo: "empate"; cuentas: Cuenta[]; indices: number[] }
  | { tipo: "ninguna" };

/** Gana la que más puntos tiene; si empatan, la moneda nombrada desempata; si sigue el empate, se pide elegir. */
function resolver(co: Coincidencia[], moneda: Moneda | null): Resolucion {
  if (co.length === 0) return { tipo: "ninguna" };
  const top = Math.max(...co.map((c) => c.puntos));
  let empatadas = co.filter((c) => c.puntos === top);
  if (empatadas.length > 1 && moneda) {
    const m = empatadas.filter((c) => c.cuenta.moneda === moneda);
    if (m.length >= 1) empatadas = m;
  }
  const indices = empatadas.flatMap((c) => c.indices);
  if (empatadas.length === 1) return { tipo: "unica", cuenta: empatadas[0].cuenta, indices };
  return { tipo: "empate", cuentas: empatadas.slice(0, 6).map((c) => c.cuenta), indices };
}

// ---------------------------------------------------------------- traspaso: de dónde y hacia dónde
const MARCA_ORIGEN = new Set(["de", "del", "desde"]);
const MARCA_DESTINO = new Set(["a", "al", "hacia", "para"]);
const PARTE_DE_NOMBRE = new Set(["cuenta", "cuentas", "cta", "banco", "caja"]); // «cuenta de ahorro»: ese «de» no marca el origen

interface Ventana {
  rol: "origen" | "destino" | null;
  desde: number;
  hasta: number;
}

function ventanasDe(t: string[]): Ventana[] {
  const salida: Ventana[] = [];
  let inicio = 0;
  let rol: Ventana["rol"] = null;
  t.forEach((w, i) => {
    const origen = MARCA_ORIGEN.has(w) && !(i > 0 && PARTE_DE_NOMBRE.has(t[i - 1]));
    if (origen || MARCA_DESTINO.has(w)) {
      salida.push({ rol, desde: inicio, hasta: i });
      rol = origen ? "origen" : "destino";
      inicio = i + 1;
    }
  });
  salida.push({ rol, desde: inicio, hasta: t.length });
  return salida;
}

const desplazar = (co: Coincidencia[], d: number): Coincidencia[] => co.map((c) => ({ ...c, indices: c.indices.map((i) => i + d) }));

// ---------------------------------------------------------------- la frase
function interpretarUna(frase: string, ctx: ContextoDictado): ResultadoDictado {
  const t = unirLetras(tokens(frase));
  const r = vacio();

  // tipo
  const tipos = [...new Set(t.map(tipoDe).filter((x): x is TipoMovimiento => x !== null))];
  if (tipos.includes("ajuste")) return { ...vacio(), ajuste: true };
  if (tipos.length === 1) r.tipo = tipos[0];
  else r.porRevisar.tipo = tipos.length === 0 ? "No entendí el tipo de movimiento: elígelo" : "Escuché más de un tipo de movimiento: elige el correcto";

  const dicha = monedaNombrada(t); // cualquier moneda nombrada: sirve para desempatar entre cuentas
  // la moneda de la CANTIDAD («100 dólares»): solo esa se compara con la moneda de la cuenta
  const dichaMonto = t.reduce<Moneda | null>((acc, w, k) => acc ?? (k > 0 && esNumerico(t[k - 1]) ? monedaHablada(w) : null), null);
  // «100 bs»: la moneda que acompaña a una cantidad no es el nombre de una cuenta
  const tc = t.map((w, k) => (k > 0 && monedaHablada(w) && esNumerico(t[k - 1]) ? "_" : w));
  const actual = ctx.cuentas.find((c) => c.id === ctx.cuentaActualId);
  const enmascarar: number[] = [];

  // ---- cuenta (origen)
  let origen: Resolucion;
  let ventanas: Ventana[] = [];
  if (r.tipo === "traspaso") {
    ventanas = ventanasDe(tc);
    origen = { tipo: "ninguna" };
    for (const v of ventanas) {
      if (v.rol === "destino") continue;
      const res = resolver(desplazar(coincidencias(tc.slice(v.desde, v.hasta), ctx.cuentas), v.desde), dicha);
      if (res.tipo !== "ninguna") {
        origen = res;
        break;
      }
    }
  } else origen = resolver(coincidencias(tc, ctx.cuentas), dicha);

  const nombreMoneda = (m: Moneda) => NOMBRE_MONEDA[m];
  let moneda: Moneda | null = null; // la que valida el monto
  let base: Cuenta | undefined; // cuenta de origen contra la que se buscan los destinos
  const quien = r.tipo === "traspaso" ? "la cuenta de origen" : "la cuenta";
  if (origen.tipo === "unica") {
    r.cuentaId = origen.cuenta.id;
    moneda = origen.cuenta.moneda;
    base = origen.cuenta;
    enmascarar.push(...origen.indices);
    if (dichaMonto && dichaMonto !== origen.cuenta.moneda) {
      r.porRevisar.cuenta = `Dijiste ${nombreMoneda(dichaMonto)}, pero «${origen.cuenta.nombre}» está en ${nombreMoneda(origen.cuenta.moneda)}: revisa ${quien}`;
    }
  } else if (origen.tipo === "empate") {
    r.elecciones.push({ campo: "cuenta", opciones: origen.cuentas.map((c) => c.id) });
    r.porRevisar.cuenta = `Hay más de una cuenta que encaja: toca la correcta`;
    const monedas = new Set(origen.cuentas.map((c) => c.moneda));
    moneda = monedas.size === 1 ? origen.cuentas[0].moneda : null;
    enmascarar.push(...origen.indices);
  } else {
    r.porRevisar.cuenta = `No entendí ${quien}: revisa la que está elegida`;
    moneda = actual?.moneda ?? null;
    base = actual;
  }

  // ---- cuenta destino (solo en un traspaso)
  if (r.tipo === "traspaso") {
    if (origen.tipo === "empate" || !base) r.porRevisar.destino = "Elige primero la cuenta de origen";
    else {
      const posibles = destinosDeTraspaso(base, ctx.cuentas);
      let res: Resolucion = { tipo: "ninguna" };
      let hayOtras = false; // encajó una cuenta que no sirve de destino
      for (const v of ventanas) {
        if (v.rol !== "destino") continue;
        const trozo = tc.slice(v.desde, v.hasta);
        const r1 = resolver(desplazar(coincidencias(trozo, posibles), v.desde), dicha);
        if (r1.tipo !== "ninguna") {
          res = r1;
          break;
        }
        if (coincidencias(trozo, ctx.cuentas.filter((c) => c.id !== base!.id)).length > 0) hayOtras = true;
      }
      if (res.tipo === "unica") {
        r.destinoId = res.cuenta.id;
        enmascarar.push(...res.indices);
      } else if (res.tipo === "empate") {
        r.elecciones.push({ campo: "destino", opciones: res.cuentas.map((c) => c.id) });
        r.porRevisar.destino = "Hay más de una cuenta que encaja: toca la correcta";
        enmascarar.push(...res.indices);
      } else {
        r.porRevisar.destino = hayOtras
          ? `Esa cuenta no sirve de destino: un traspaso une cuentas de la misma moneda (${nombreMoneda(base.moneda)})`
          : "No entendí la cuenta de destino";
      }
    }
  }

  // ---- monto (con las palabras de las cuentas tapadas: «cuenta 4821» no es un monto)
  const lectura = leerMonto(tc.map((w, k) => (enmascarar.includes(k) ? "_" : w)));
  if (lectura.tipo === "ninguno") r.porRevisar.monto = "No escuché el monto";
  else if (lectura.tipo === "dudoso") r.porRevisar.monto = `${lectura.motivo}: escríbelo tú`;
  else if (lectura.alternativa !== null && (moneda === null || DECIMALES[moneda] > 2)) {
    r.porRevisar.monto = `No supe si es ${lectura.texto} o ${lectura.alternativa}: escríbelo tú`;
  } else {
    const error = errorDeMonto(lectura.texto, moneda ?? "BTC");
    if (error) r.porRevisar.monto = `Escuché ${lectura.texto}: ${error}`;
    else r.monto = lectura.texto;
  }

  r.rellenados =
    (r.tipo !== null ? 1 : 0) +
    (r.cuentaId !== null && !r.porRevisar.cuenta ? 1 : 0) +
    (r.destinoId !== null && !r.porRevisar.destino ? 1 : 0) +
    (r.monto !== null ? 1 : 0);
  return r;
}

/**
 * Interpreta lo que dijo el usuario. `frases` son las alternativas del reconocedor (la primera es la más probable): se
 * queda con la que más campos entiende. NUNCA decide guardar: solo propone valores para el formulario.
 */
export function interpretarDictado(frases: string[], ctx: ContextoDictado): ResultadoDictado {
  let mejor: ResultadoDictado | null = null;
  let mejorPuntaje = -Infinity;
  for (let i = 0; i < frases.length; i++) {
    const r = interpretarUna(frases[i], ctx);
    // «ajuste» solo vale si lo dice la lectura más probable; en una alternativa lejana sería un error del reconocedor
    if (r.ajuste) {
      if (i === 0) return r;
      continue;
    }
    const puntaje = r.rellenados * 10 - Object.keys(r.porRevisar).length;
    if (puntaje > mejorPuntaje) {
      mejor = r;
      mejorPuntaje = puntaje;
    }
  }
  return mejor ?? { ...vacio(), porRevisar: { tipo: "No entendí el tipo de movimiento: elígelo", monto: "No escuché el monto" } };
}
