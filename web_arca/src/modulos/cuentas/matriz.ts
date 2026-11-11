// Reglas del formulario de cuentas: tipos, monedas permitidas por tipo y bancos. Funciones puras; el servidor es quien manda.
import { DECIMALES, errorDeMonto, type Moneda } from "./montos";

export type TipoCuenta = "ahorro" | "corriente" | "cripto" | "efectivo";
export const TIPOS: TipoCuenta[] = ["ahorro", "corriente", "cripto", "efectivo"];
export const NOMBRE_TIPO: Record<TipoCuenta, string> = {
  ahorro: "Caja de ahorro",
  corriente: "Cuenta corriente",
  cripto: "Cripto",
  efectivo: "Efectivo",
};
export const ICONO_TIPO: Record<TipoCuenta, string> = { ahorro: "🏦", corriente: "🏦", cripto: "🪙", efectivo: "💵" };

/** Cripto solo USDT o BTC; las bancarias y el efectivo, solo Bs o USD. */
export const MONEDAS_POR_TIPO: Record<TipoCuenta, Moneda[]> = {
  ahorro: ["BS", "USD"],
  corriente: ["BS", "USD"],
  efectivo: ["BS", "USD"],
  cripto: ["USDT", "BTC"],
};
export const OTRO = "Otro";
export const BANCOS_INICIALES = [
  "Banco Nacional de Bolivia", "Banco Mercantil Santa Cruz", "Banco de Crédito de Bolivia", "Banco Unión", "Banco BISA",
  "Banco Ganadero", "Banco Económico", "Banco Fassil", "Banco Sol", "Banco FIE", "Banco Prodem", OTRO,
];
export const PLATAFORMAS_INICIALES = ["Binance", "Bybit", "Coinbase", "Kraken", "OKX", "Trust Wallet", "Ledger", "MetaMask", OTRO];

export const monedasDe = (tipo: TipoCuenta): Moneda[] => MONEDAS_POR_TIPO[tipo];
export const usaBanco = (tipo: TipoCuenta) => tipo !== "efectivo";
/** Moneda que queda al cambiar de tipo: la actual si sigue valida; si no, la primera permitida. */
export const monedaTrasCambiarTipo = (tipo: TipoCuenta, actual: Moneda): Moneda => (monedasDe(tipo).includes(actual) ? actual : monedasDe(tipo)[0]);
export const decimalesDeMoneda = (m: Moneda) => DECIMALES[m];

/** Deja solo cifras y recorta a 4: lo que se escribe en "últimos 4 dígitos". */
export const soloUltimos4 = (texto: string) => texto.replace(/\D/g, "").slice(0, 4);
export const ultimos4Valido = (texto: string) => texto === "" || /^\d{4}$/.test(texto);

export interface FormCuenta {
  nombre: string;
  tipo: TipoCuenta;
  moneda: Moneda;
  banco: string;
  banco_otro: string;
  ultimos4: string;
  saldo_inicial: string;
}

/** Errores por campo (vacio si todo esta bien). */
export function erroresDeCuenta(f: FormCuenta): Partial<Record<keyof FormCuenta, string>> {
  const e: Partial<Record<keyof FormCuenta, string>> = {};
  if (!f.nombre.trim()) e.nombre = "Escribe el nombre de la cuenta";
  if (!monedasDe(f.tipo).includes(f.moneda)) e.moneda = f.tipo === "cripto" ? "Una cuenta cripto solo admite USDT o BTC" : "Esta cuenta solo admite Bs o USD";
  if (usaBanco(f.tipo)) {
    if (!f.banco) e.banco = f.tipo === "cripto" ? "Elige la plataforma" : "Elige el banco";
    else if (f.banco === OTRO && !f.banco_otro.trim()) e.banco_otro = "Escribe el nombre";
    if (!ultimos4Valido(f.ultimos4)) e.ultimos4 = "Escribe solo los 4 últimos dígitos";
  }
  const s = errorDeMonto(f.saldo_inicial, f.moneda, { positivo: false, obligatorio: false });
  if (s) e.saldo_inicial = s;
  return e;
}
