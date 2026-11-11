import { describe, expect, it } from "vitest";
import {
  aMonto, aTexto, comparar, decimalesDe, errorDeMonto, formatear, formatearTexto, numero, sumar, totalesPorMoneda,
} from "./montos";

describe("montos: texto decimal <-> BigInt, sin float", () => {
  it("convierte texto a monto sin perder ningún decimal", () => {
    expect(aMonto("12")).toBe(1_200_000_000n);
    expect(aMonto("12.5")).toBe(1_250_000_000n);
    expect(aMonto("12,5")).toBe(1_250_000_000n); // coma decimal
    expect(aMonto(".5")).toBe(50_000_000n);
    expect(aMonto("0.00000001")).toBe(1n);
    expect(aMonto("-3.25")).toBe(-325_000_000n);
    expect(aMonto("12345678.12345678")).toBe(1_234_567_812_345_678n);
  });
  it("rechaza lo que no es un número o trae más de 8 decimales (nunca redondea)", () => {
    for (const t of ["", " ", "abc", "1.2.3", "1e5", "0.123456789", ".", "-", "--1", "12a"]) expect(aMonto(t), t).toBeNull();
    expect(aMonto("-1", false)).toBeNull();
  });
  it("0.1 + 0.2 da 0.3 exacto (con float daría 0.30000000000000004)", () => {
    const s = sumar([aMonto("0.1")!, aMonto("0.2")!]);
    expect(s).toBe(aMonto("0.3"));
    expect(aTexto(s, "BTC")).toBe("0.3");
    expect(0.1 + 0.2).not.toBe(0.3); // el motivo de todo esto
  });
  it("suma sin pérdida montos grandes de 8 decimales", () => {
    const s = sumar([aMonto("9007199254740993.00000001")!, aMonto("0.00000001")!]);
    expect(aTexto(s, "BTC")).toBe("9007199254740993.00000002");
  });
  it("compara sin Number", () => {
    expect(comparar(aMonto("0.00000001")!, aMonto("0")!)).toBe(1);
    expect(comparar(aMonto("-5")!, aMonto("-4.99999999")!)).toBe(-1);
    expect(comparar(aMonto("1.10")!, aMonto("1.1")!)).toBe(0);
  });
  it("cuenta los decimales significativos (los ceros finales no cuentan)", () => {
    expect(decimalesDe("10")).toBe(0);
    expect(decimalesDe("10.50")).toBe(1);
    expect(decimalesDe("10.500")).toBe(1);
    expect(decimalesDe("0,00012345")).toBe(8);
  });
});

describe("formato por moneda", () => {
  it("Bs y USD: siempre 2 decimales y miles con coma", () => {
    expect(formatear(aMonto("1234.5")!, "BS")).toBe("Bs 1,234.50");
    expect(formatear(aMonto("0")!, "BS")).toBe("Bs 0.00");
    expect(formatear(aMonto("1000000")!, "USD")).toBe("USD 1,000,000.00");
  });
  it("USDT y BTC: hasta 8 decimales sin ceros sobrantes (mínimo 2)", () => {
    expect(formatear(aMonto("0.50000000")!, "BTC")).toBe("BTC 0.50");
    expect(formatear(aMonto("0.00012345")!, "BTC")).toBe("BTC 0.00012345");
    expect(formatear(aMonto("1")!, "USDT")).toBe("USDT 1.00");
    expect(formatear(aMonto("25.5")!, "USDT")).toBe("USDT 25.50");
    expect(formatear(aMonto("1234.12345600")!, "USDT")).toBe("USDT 1,234.123456");
    expect(formatear(aMonto("0.00000001")!, "BTC")).toBe("BTC 0.00000001");
  });
  it("el signo menos va delante de todo", () => {
    expect(formatear(aMonto("-15")!, "BS")).toBe("-Bs 15.00");
    expect(formatear(aMonto("-0.00000500")!, "BTC")).toBe("-BTC 0.000005");
  });
  it("formatea el texto del servidor y deja intacto lo que no es un monto", () => {
    expect(formatearTexto("68.50000000", "USDT")).toBe("USDT 68.50");
    expect(formatearTexto("100.00", "BS")).toBe("Bs 100.00");
    expect(formatearTexto(null, "BS")).toBe("");
    expect(formatearTexto("x", "BS")).toBe("x");
  });
  it("numero(): sin moneda; aTexto(): sin separadores, para mandar al servidor", () => {
    expect(numero(aMonto("1234.5")!, "BS")).toBe("1,234.50");
    expect(aTexto(aMonto("1234.5")!, "BS")).toBe("1234.5".replace(".5", ".50"));
    expect(aTexto(aMonto("0.5")!, "BTC")).toBe("0.5");
    expect(aTexto(aMonto("-7")!, "USD")).toBe("-7.00");
  });
});

describe("validación de decimales por moneda", () => {
  it("Bs y USD admiten 2 decimales; con 3 hay error", () => {
    expect(errorDeMonto("10.05", "BS")).toBeNull();
    expect(errorDeMonto("10.050", "BS")).toBeNull();
    expect(errorDeMonto("10.005", "BS")).toMatch(/hasta 2 decimales/);
    expect(errorDeMonto("0.001", "USD")).toMatch(/hasta 2 decimales/);
  });
  it("USDT y BTC admiten 8; con 9 hay error", () => {
    expect(errorDeMonto("0.00012345", "BTC")).toBeNull();
    expect(errorDeMonto("0.000123456", "BTC")).toMatch(/hasta 8 decimales/);
    expect(errorDeMonto("1234567.12345678", "USDT")).toBeNull();
  });
  it("cero, negativos y basura", () => {
    expect(errorDeMonto("0", "BS")).toMatch(/mayor que cero/);
    expect(errorDeMonto("-5", "BS")).toMatch(/negativo/);
    expect(errorDeMonto("-5", "BS", { negativo: true, positivo: false })).toBeNull(); // saldo real de un ajuste
    expect(errorDeMonto("0", "BS", { positivo: false })).toBeNull();
    expect(errorDeMonto("abc", "BS")).toMatch(/solo números/);
    expect(errorDeMonto("", "BS")).toMatch(/Escribe el monto/);
    expect(errorDeMonto("", "BS", { obligatorio: false })).toBeNull();
    expect(errorDeMonto("1".repeat(17), "BS")).toMatch(/demasiado grande/);
  });
});

describe("totales por moneda: nunca se suman monedas distintas", () => {
  it("un total por moneda, exacto", () => {
    const t = totalesPorMoneda([
      { moneda: "BS", monto: "100.10" }, { moneda: "USD", monto: "5" }, { moneda: "BS", monto: "0.20" },
      { moneda: "BTC", monto: "0.1" }, { moneda: "BTC", monto: "0.2" }, { moneda: "BS", monto: "-50.30" },
    ]);
    expect(t.map((x) => [x.moneda, aTexto(x.total, x.moneda)])).toEqual([["BS", "50.00"], ["USD", "5.00"], ["BTC", "0.3"]]);
  });
  it("sin filas no hay bloques", () => expect(totalesPorMoneda([])).toEqual([]));
});
