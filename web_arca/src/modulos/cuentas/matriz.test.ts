import { describe, expect, it } from "vitest";
import {
  MONEDAS_POR_TIPO, TIPOS, erroresDeCuenta, monedaTrasCambiarTipo, monedasDe, soloUltimos4, ultimos4Valido, usaBanco, type FormCuenta,
} from "./matriz";

const base: FormCuenta = { nombre: "Caja", tipo: "ahorro", moneda: "BS", banco: "Banco Unión", banco_otro: "", ultimos4: "", saldo_inicial: "" };

describe("matriz tipo / moneda", () => {
  it("cripto solo USDT o BTC; el resto solo Bs o USD", () => {
    expect(monedasDe("cripto")).toEqual(["USDT", "BTC"]);
    for (const t of TIPOS.filter((x) => x !== "cripto")) expect(monedasDe(t)).toEqual(["BS", "USD"]);
    expect(Object.keys(MONEDAS_POR_TIPO).sort()).toEqual([...TIPOS].sort());
  });
  it("al cambiar de tipo se conserva la moneda si sigue siendo válida; si no, la primera permitida", () => {
    expect(monedaTrasCambiarTipo("efectivo", "USD")).toBe("USD");
    expect(monedaTrasCambiarTipo("cripto", "USD")).toBe("USDT");
    expect(monedaTrasCambiarTipo("cripto", "BTC")).toBe("BTC");
    expect(monedaTrasCambiarTipo("ahorro", "BTC")).toBe("BS");
  });
  it("el efectivo no lleva banco; los demás sí", () => {
    expect(usaBanco("efectivo")).toBe(false);
    for (const t of ["ahorro", "corriente", "cripto"] as const) expect(usaBanco(t)).toBe(true);
  });
  it("una cuenta cripto con Bs, o una bancaria con BTC, no es válida", () => {
    expect(erroresDeCuenta({ ...base, tipo: "cripto", moneda: "BS", banco: "Binance" }).moneda).toMatch(/USDT o BTC/);
    expect(erroresDeCuenta({ ...base, moneda: "BTC" }).moneda).toMatch(/Bs o USD/);
    expect(erroresDeCuenta({ ...base, tipo: "cripto", moneda: "BTC", banco: "Binance" })).toEqual({});
    expect(erroresDeCuenta(base)).toEqual({});
  });
});

describe("formulario de cuenta", () => {
  it("últimos 4 dígitos: solo cifras y como mucho 4", () => {
    expect(soloUltimos4("12a3-4567")).toBe("1234");
    expect(soloUltimos4("ab")).toBe("");
    expect(ultimos4Valido("")).toBe(true);
    expect(ultimos4Valido("0042")).toBe(true);
    expect(ultimos4Valido("123")).toBe(false);
    expect(ultimos4Valido("12345")).toBe(false);
    expect(ultimos4Valido("12a4")).toBe(false);
    expect(erroresDeCuenta({ ...base, ultimos4: "123" }).ultimos4).toBeDefined();
  });
  it("pide nombre, banco o plataforma y el nombre cuando se elige «Otro»", () => {
    expect(erroresDeCuenta({ ...base, nombre: "  " }).nombre).toBeDefined();
    expect(erroresDeCuenta({ ...base, banco: "" }).banco).toMatch(/banco/);
    expect(erroresDeCuenta({ ...base, tipo: "cripto", moneda: "USDT", banco: "" }).banco).toMatch(/plataforma/);
    expect(erroresDeCuenta({ ...base, banco: "Otro" }).banco_otro).toBeDefined();
    expect(erroresDeCuenta({ ...base, banco: "Otro", banco_otro: "Banco Pequeño" })).toEqual({});
  });
  it("el efectivo no necesita banco ni últimos 4", () => {
    expect(erroresDeCuenta({ ...base, tipo: "efectivo", banco: "", ultimos4: "" })).toEqual({});
  });
  it("el saldo inicial respeta los decimales de la moneda y no es negativo", () => {
    expect(erroresDeCuenta({ ...base, saldo_inicial: "10.005" }).saldo_inicial).toMatch(/2 decimales/);
    expect(erroresDeCuenta({ ...base, saldo_inicial: "-1" }).saldo_inicial).toMatch(/negativo/);
    expect(erroresDeCuenta({ ...base, tipo: "cripto", moneda: "BTC", banco: "Binance", saldo_inicial: "0.00000001" })).toEqual({});
    expect(erroresDeCuenta({ ...base, tipo: "cripto", moneda: "BTC", banco: "Binance", saldo_inicial: "0.000000001" }).saldo_inicial).toBeDefined();
  });
});
