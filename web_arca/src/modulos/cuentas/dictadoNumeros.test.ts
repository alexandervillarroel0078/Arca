// Números hablados del dictado: tabla de casos. Todo es texto o BigInt: aquí no hay Number ni float.
import { describe, expect, it } from "vitest";
import { leerMonto, monedaNombrada, normalizar, tokens } from "./dictadoNumeros";

const monto = (frase: string) => leerMonto(tokens(frase));
const texto = (frase: string) => {
  const r = monto(frase);
  return r.tipo === "ok" ? r.texto : r.tipo;
};

describe("normalizar", () => {
  it("quita tildes, signos y mayúsculas, pero deja los puntos y comas dentro de las cifras", () => {
    expect(normalizar("Depósito, a la cuenta BCP: ¡1.500,50 Bs.!")).toBe("deposito a la cuenta bcp 1.500,50 bs");
    expect(normalizar("  Retiro   de  100,50 ")).toBe("retiro de 100,50");
    expect(normalizar("")).toBe("");
  });
});

describe("cifras", () => {
  const casos: [string, string][] = [
    ["deposito de 1500 bolivianos", "1500"],
    ["deposito de 1500", "1500"],
    ["retiro de 100,50", "100.50"],
    ["retiro de 100.50", "100.50"],
    ["retiro de 0,5", "0.5"],
    ["traspaso de 200", "200"],
    ["retiro de 0.500", "0.500"],
    ["1.500.000", "1500000"],
    ["1.500,50", "1500.50"],
    ["1,500.50", "1500.50"],
  ];
  for (const [frase, esperado] of casos) {
    it(`"${frase}" -> ${esperado}`, () => expect(texto(frase)).toBe(esperado));
  }

  it('"1.500" es mil quinientos, y avisa de que también pudo ser 1.500 decimal (importa en USDT y BTC)', () => {
    const r = monto("deposito de 1.500 bolivianos");
    expect(r).toEqual({ tipo: "ok", texto: "1500", alternativa: "1.500" });
    const c = monto("deposito de 1,500");
    expect(c).toEqual({ tipo: "ok", texto: "1500", alternativa: "1.500" });
  });

  it('"12.345" (un solo grupo de 3 tras el separador) también deja la alternativa; "1.5" y "0.500" no', () => {
    expect(monto("retiro de 12.345")).toEqual({ tipo: "ok", texto: "12345", alternativa: "12.345" });
    expect(monto("retiro de 1.5")).toEqual({ tipo: "ok", texto: "1.5", alternativa: null });
    expect(monto("retiro de 0.500")).toEqual({ tipo: "ok", texto: "0.500", alternativa: null });
  });

  it("agrupaciones mal formadas son dudosas, no se adivinan", () => {
    expect(monto("deposito de 1.50.000").tipo).toBe("dudoso");
    expect(monto("deposito de 1.5000,50").tipo).toBe("dudoso");
  });

  it("«1,5 millones» es dudoso (no se multiplica un decimal)", () => {
    expect(monto("deposito de 1,5 millones").tipo).toBe("dudoso");
  });
});

describe("palabras", () => {
  const casos: [string, string][] = [
    ["deposito de mil quinientos bolivianos", "1500"],
    ["deposito de mil", "1000"],
    ["deposito de dos mil", "2000"],
    ["deposito de 2 mil 500", "2500"],
    ["deposito de 2 mil", "2000"],
    ["deposito de cien", "100"],
    ["deposito de ciento cinco", "105"],
    ["deposito de doscientos cincuenta", "250"],
    ["deposito de treinta y cinco", "35"],
    ["deposito de veintiuno", "21"],
    ["deposito de veintiun mil", "21000"],
    ["deposito de quince", "15"],
    ["deposito de quinientas", "500"],
    ["deposito de cien mil", "100000"],
    ["deposito de un millon", "1000000"],
    ["deposito de dos millones quinientos mil", "2500000"],
    ["deposito de nueve mil novecientos noventa y nueve", "9999"],
    ["deposito de cero", "0"],
  ];
  for (const [frase, esperado] of casos) it(`"${frase}" -> ${esperado}`, () => expect(texto(frase)).toBe(esperado));

  it("sin tildes y con tildes dan lo mismo (millón/millon, dieciséis/dieciseis)", () => {
    expect(texto("Depósito de un millón")).toBe("1000000");
    expect(texto("Depósito de dieciséis")).toBe("16");
  });

  it("«y» solo vale dentro de decena + unidad: «veinte y»… no se inventa nada", () => {
    expect(texto("retiro de cien y de la caja")).toBe("100");
  });
});

describe("decimales hablados", () => {
  const casos: [string, string][] = [
    ["retiro de cien con cincuenta de la caja", "100.50"],
    ["retiro de cien con cinco", "100.05"],
    ["retiro de 100 con 5", "100.05"],
    ["retiro de 100 con 50", "100.50"],
    ["retiro de 100 con 05", "100.05"],
    ["retiro de cien bolivianos con cincuenta centavos", "100.50"],
    ["retiro de cien con cincuenta centavos", "100.50"],
    ["retiro de cien coma cinco", "100.5"],
    ["retiro de cien coma cero cinco", "100.05"],
    ["retiro de cien punto veinticinco", "100.25"],
    ["retiro de 0 coma 0 0 0 1", "0.0001"],
    ["retiro de mil quinientos con veinte", "1500.20"],
  ];
  for (const [frase, esperado] of casos) it(`"${frase}" -> ${esperado}`, () => expect(texto(frase)).toBe(esperado));

  it("«con» + más de dos cifras no es un centavo: dudoso", () => {
    expect(monto("retiro de cien con 505").tipo).toBe("dudoso");
    expect(monto("retiro de cien con quinientos").tipo).toBe("dudoso");
  });
});

describe("no confundir con el monto", () => {
  it("«terminada en 4821» es de la cuenta, no del monto", () => {
    expect(texto("deposito a la cuenta terminada en 4821 de 300 bolivianos")).toBe("300");
    expect(texto("deposito a la cuenta que termina en 4821 de 300")).toBe("300");
    expect(texto("deposito a la tarjeta 4821 de 300")).toBe("300");
    expect(monto("deposito a la cuenta terminada en 4821").tipo).toBe("ninguno");
  });

  it("una fecha («3 de noviembre») no es el monto", () => {
    expect(texto("retiro el 3 de noviembre de 200")).toBe("200");
    expect(monto("retiro del 3 de noviembre").tipo).toBe("ninguno");
    expect(texto("retiro el 3 de Noviembre de 200")).toBe("200");
  });

  it("«un depósito» y «una cuenta» no son el número 1, pero «un boliviano» y «un millón» sí", () => {
    expect(monto("hago un deposito a una cuenta").tipo).toBe("ninguno");
    expect(texto("hago un deposito de 50")).toBe("50");
    expect(texto("deposito un boliviano")).toBe("1");
    expect(texto("deposito un millon")).toBe("1000000");
  });

  it("con dos cantidades gana la que lleva moneda; sin pistas distintas es dudoso", () => {
    expect(texto("deposito de 20 a la cuenta 7 de 1500 bolivianos")).toBe("1500");
    expect(monto("deposito 20 y 30").tipo).toBe("dudoso");
    expect(texto("deposito de 20 y de 20")).toBe("20");
  });

  it("sin números no hay monto", () => {
    expect(monto("deposito a la caja").tipo).toBe("ninguno");
    expect(monto("").tipo).toBe("ninguno");
  });
});

describe("moneda nombrada", () => {
  it("reconoce bolivianos, dólares, usdt y bitcoin", () => {
    expect(monedaNombrada(tokens("100 bolivianos"))).toBe("BS");
    expect(monedaNombrada(tokens("100 Bs."))).toBe("BS");
    expect(monedaNombrada(tokens("cien dólares"))).toBe("USD");
    expect(monedaNombrada(tokens("50 USDT"))).toBe("USDT");
    expect(monedaNombrada(tokens("0,001 bitcoin"))).toBe("BTC");
    expect(monedaNombrada(tokens("deposito de 100"))).toBeNull();
  });
});
