// Intérprete del dictado: de una frase a tipo, cuenta, destino y monto. Sin DOM ni red.
import { describe, expect, it } from "vitest";
import { cuentaDe } from "../../test/cuentas";
import { interpretarDictado, type ContextoDictado } from "./dictadoInterprete";

const CAJA = cuentaDe({ id: 1, nombre: "Caja", tipo: "efectivo" });
const BCP = cuentaDe({ id: 2, nombre: "BCP", tipo: "corriente", banco: "BCP" });
const PRINCIPAL = cuentaDe({ id: 3, nombre: "Principal", tipo: "corriente", banco: "Banco Unión", ultimos4: "4821" });
const AHORRO = cuentaDe({ id: 4, nombre: "Ahorro", tipo: "ahorro" });
const DOLARES = cuentaDe({ id: 5, nombre: "Dólares", tipo: "ahorro", moneda: "USD" });
const BTC = cuentaDe({ id: 6, nombre: "Billetera BTC", tipo: "cripto", moneda: "BTC", banco: "Binance" });
const TETHER = cuentaDe({ id: 7, nombre: "Tether", tipo: "cripto", moneda: "USDT" });

const normal: ContextoDictado = { cuentas: [CAJA, BCP, PRINCIPAL, AHORRO, DOLARES, BTC, TETHER], cuentaActualId: 1 };
// dos cuentas del mismo banco
const BCP_SUELDO = cuentaDe({ id: 12, nombre: "BCP Sueldo", tipo: "corriente", banco: "BCP" });
const BCP_AHORRO = cuentaDe({ id: 13, nombre: "BCP Ahorro", tipo: "ahorro", banco: "BCP" });
const mismoBanco: ContextoDictado = { cuentas: [CAJA, BCP_SUELDO, BCP_AHORRO], cuentaActualId: 1 };
// mismo nombre en monedas distintas
const AHORRO_BS = cuentaDe({ id: 21, nombre: "Ahorro Bs", tipo: "ahorro" });
const AHORRO_USD = cuentaDe({ id: 22, nombre: "Ahorro USD", tipo: "ahorro", moneda: "USD" });
const dosMonedas: ContextoDictado = { cuentas: [CAJA, AHORRO_BS, AHORRO_USD], cuentaActualId: 1 };

const di = (frase: string, ctx = normal) => interpretarDictado([frase], ctx);

describe("las tres frases de referencia", () => {
  it("«Depósito a la cuenta BCP, 1500 bolivianos, de Ana»", () => {
    const r = di("Depósito a la cuenta BCP, 1500 bolivianos, de Ana");
    expect(r).toMatchObject({ ajuste: false, tipo: "deposito", cuentaId: 2, destinoId: null, monto: "1500", porRevisar: {}, elecciones: [], rellenados: 3 });
  });

  it("«Retiro de cien con cincuenta de la caja, Luis»", () => {
    const r = di("Retiro de cien con cincuenta de la caja, Luis");
    expect(r).toMatchObject({ tipo: "retiro", cuentaId: 1, monto: "100.50", porRevisar: {}, rellenados: 3 });
  });

  it("«Traspaso de 200 de la principal al ahorro»", () => {
    const r = di("Traspaso de 200 de la principal al ahorro");
    expect(r).toMatchObject({ tipo: "traspaso", cuentaId: 3, destinoId: 4, monto: "200", porRevisar: {}, elecciones: [], rellenados: 4 });
  });
});

describe("acentos, mayúsculas y errores típicos del reconocedor", () => {
  it("con y sin tilde da lo mismo", () => {
    const a = di("Depósito de 50 a la caja");
    const b = di("deposito de 50 a la caja");
    const c = di("DEPOSITO DE CINCUENTA A LA CAJA");
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(a).toMatchObject({ tipo: "deposito", cuentaId: 1, monto: "50" });
  });

  it("variantes del verbo: retiró, retira, saqué, depositó, ingreso, transfiere", () => {
    for (const f of ["Retiró 20 de la caja", "retira 20 de la caja", "Saque 20 de la caja", "saco veinte de la caja"]) expect(di(f), f).toMatchObject({ tipo: "retiro", cuentaId: 1, monto: "20" });
    for (const f of ["Depositó 20 a la caja", "ingreso 20 a la caja", "Deposite veinte en la caja"]) expect(di(f), f).toMatchObject({ tipo: "deposito", cuentaId: 1, monto: "20" });
    expect(di("Transfiere 20 de la caja al ahorro")).toMatchObject({ tipo: "traspaso", cuentaId: 1, destinoId: 4, monto: "20" });
  });

  it("«be ce pe» y «b c p» son BCP", () => {
    expect(di("Depósito en be ce pe 300")).toMatchObject({ tipo: "deposito", cuentaId: 2, monto: "300" });
    expect(di("Depósito en b c p 300")).toMatchObject({ tipo: "deposito", cuentaId: 2, monto: "300" });
  });

  it("una letra cambiada en una palabra larga se perdona («principl»)", () => {
    expect(di("retiro de 10 de la principl")).toMatchObject({ cuentaId: 3, monto: "10" });
  });

  it("los dígitos finales de la cuenta la identifican y no se toman por el monto", () => {
    expect(di("retiro de 30 de la cuenta terminada en 4821")).toMatchObject({ cuentaId: 3, monto: "30" });
    expect(di("retiro de treinta de la 4821")).toMatchObject({ cuentaId: 3, monto: "30" });
  });

  it("entre las alternativas del reconocedor elige la que más entiende", () => {
    const r = interpretarDictado(["deposito en vcp 300", "deposito en bcp 300"], normal);
    expect(r).toMatchObject({ cuentaId: 2, monto: "300" });
    // si la primera ya lo entiende todo, gana la primera
    const s = interpretarDictado(["deposito de 10 a la caja", "retiro de 99 de la caja"], normal);
    expect(s).toMatchObject({ tipo: "deposito", monto: "10" });
  });
});

describe("lo que no se entiende queda vacío y marcado", () => {
  it("sin tipo", () => {
    const r = di("100 bolivianos a la caja");
    expect(r.tipo).toBeNull();
    expect(r.porRevisar.tipo).toMatch(/tipo/i);
    expect(r).toMatchObject({ cuentaId: 1, monto: "100" });
  });

  it("dos tipos distintos: no adivina", () => {
    const r = di("depósito o retiro de 100 a la caja");
    expect(r.tipo).toBeNull();
    expect(r.porRevisar.tipo).toMatch(/más de un tipo/);
  });

  it("sin cuenta: conserva la elegida pero la marca", () => {
    const r = di("depósito de 100");
    expect(r.cuentaId).toBeNull();
    expect(r.porRevisar.cuenta).toMatch(/revisa la que está elegida/);
    expect(r).toMatchObject({ tipo: "deposito", monto: "100" });
    expect(r.rellenados).toBe(2);
  });

  it("sin monto", () => {
    const r = di("depósito a la caja");
    expect(r.monto).toBeNull();
    expect(r.porRevisar.monto).toMatch(/No escuché el monto/);
  });

  it("frase vacía o sin alternativas", () => {
    expect(di("")).toMatchObject({ tipo: null, cuentaId: null, monto: null, rellenados: 0 });
    const r = interpretarDictado([], normal);
    expect(r.rellenados).toBe(0);
    expect(Object.keys(r.porRevisar).sort()).toEqual(["monto", "tipo"]);
  });
});

describe("empate: se elige con un toque", () => {
  it("dos cuentas del mismo banco: ninguna se rellena y se ofrecen las dos", () => {
    const r = di("Depósito a la cuenta BCP, 1500 bolivianos", mismoBanco);
    expect(r.cuentaId).toBeNull();
    expect(r.elecciones).toEqual([{ campo: "cuenta", opciones: [12, 13] }]);
    expect(r.porRevisar.cuenta).toMatch(/toca la correcta/);
    expect(r).toMatchObject({ tipo: "deposito", monto: "1500" });
  });

  it("si dice cuál de las dos, no hay empate", () => {
    expect(di("depósito de 100 al BCP ahorro", mismoBanco)).toMatchObject({ cuentaId: 13, elecciones: [] });
    expect(di("depósito de 100 al BCP sueldo", mismoBanco)).toMatchObject({ cuentaId: 12, elecciones: [] });
  });

  it("dos cuentas de distinta moneda con el mismo nombre: pide elegir, y la moneda nombrada desempata", () => {
    const sin = di("depósito de 50 al ahorro", dosMonedas);
    expect(sin.cuentaId).toBeNull();
    expect(sin.elecciones).toEqual([{ campo: "cuenta", opciones: [21, 22] }]);
    expect(sin.monto).toBe("50");
    const con = di("depósito de 50 dólares al ahorro", dosMonedas);
    expect(con).toMatchObject({ cuentaId: 22, elecciones: [], monto: "50" });
    expect(con.porRevisar).toEqual({});
  });

  it("con cuentas de distinta moneda sin decidir, un monto de decimales dudosos no se rellena", () => {
    const r = di("depósito de 1.500 al ahorro", dosMonedas);
    expect(r.monto).toBeNull();
    expect(r.porRevisar.monto).toMatch(/1500 o 1\.500/);
  });

  it("traspaso: el destino empata y se elige con un toque", () => {
    const r = di("Traspaso de 100 de la caja al BCP", mismoBanco);
    expect(r).toMatchObject({ tipo: "traspaso", cuentaId: 1, destinoId: null, monto: "100" });
    expect(r.elecciones).toEqual([{ campo: "destino", opciones: [12, 13] }]);
  });

  it("traspaso: si el origen empata, el destino espera a que se elija", () => {
    const r = di("Traspaso de 100 del BCP a la caja", mismoBanco);
    expect(r.elecciones).toEqual([{ campo: "cuenta", opciones: [12, 13] }]);
    expect(r.destinoId).toBeNull();
    expect(r.porRevisar.destino).toBe("Elige primero la cuenta de origen");
  });
});

describe("traspasos", () => {
  it("destino primero y origen después", () => {
    expect(di("traspaso al ahorro de 100 desde la caja")).toMatchObject({ cuentaId: 1, destinoId: 4, monto: "100" });
  });

  it("«cuenta de ahorro»: ese «de» no corta el nombre", () => {
    expect(di("traspaso a la cuenta de ahorro desde la caja 100")).toMatchObject({ cuentaId: 1, destinoId: 4, monto: "100" });
  });

  it("sin destino", () => {
    const r = di("traspaso de 100 de la caja");
    expect(r.destinoId).toBeNull();
    expect(r.porRevisar.destino).toBe("No entendí la cuenta de destino");
  });

  it("a una cuenta de otra moneda: avisa y no la rellena", () => {
    const r = di("Traspaso de 100 de la caja a dólares");
    expect(r.cuentaId).toBe(1);
    expect(r.destinoId).toBeNull();
    expect(r.porRevisar.destino).toMatch(/misma moneda \(Bs\)/);
    expect(r.porRevisar.cuenta).toBeUndefined(); // «dólares» es el destino, no la moneda de la cantidad
    expect(r.monto).toBe("100");
  });

  it("a la misma cuenta de origen: tampoco sirve", () => {
    const r = di("traspaso de 100 de la caja a la caja");
    expect(r.destinoId).toBeNull();
    expect(r.porRevisar.destino).toBeDefined();
  });

  it("sin origen dicho usa la cuenta elegida para buscar destinos y marca el origen", () => {
    const r = di("traspaso de 100 al ahorro");
    expect(r.cuentaId).toBeNull();
    expect(r.porRevisar.cuenta).toMatch(/cuenta de origen/);
    expect(r.destinoId).toBe(4);
  });
});

describe("«ajuste» no se dicta", () => {
  it("si lo dice la lectura más probable, no se cambia nada", () => {
    const r = interpretarDictado(["ajuste de la caja 500", "depósito de la caja 500"], normal);
    expect(r).toMatchObject({ ajuste: true, tipo: null, cuentaId: null, destinoId: null, monto: null, porRevisar: {}, elecciones: [], rellenados: 0 });
  });

  it("si solo aparece en una alternativa lejana, se ignora (sería un error del reconocedor)", () => {
    const r = interpretarDictado(["depósito de 500 a la caja", "ajuste de 500 a la caja"], normal);
    expect(r.ajuste).toBe(false);
    expect(r).toMatchObject({ tipo: "deposito", cuentaId: 1, monto: "500" });
  });

  it("«conteo» y «cuadre» también son ajuste", () => {
    expect(di("quiero hacer un conteo de la caja").ajuste).toBe(true);
    expect(di("cuadre de la caja").ajuste).toBe(true);
  });
});

describe("moneda y monto", () => {
  it("la moneda dicha distinta a la de la cuenta se avisa, sin convertir nada", () => {
    const r = di("Retiro de 100 dólares de la caja");
    expect(r).toMatchObject({ tipo: "retiro", cuentaId: 1, monto: "100" });
    expect(r.porRevisar.cuenta).toBe("Dijiste USD, pero «Caja» está en Bs: revisa la cuenta");
    expect(r.rellenados).toBe(2); // la cuenta quedó rellena pero por revisar
  });

  it("la moneda de la cantidad no se confunde con una cuenta («100 dólares» no es la cuenta Dólares)", () => {
    expect(di("Retiro de 100 dólares de la caja").cuentaId).toBe(1);
    expect(di("Retiro de 100 dólares de la cuenta dólares")).toMatchObject({ cuentaId: 5, porRevisar: {} });
  });

  it("«1.500»: 1500 en Bs y USD", () => {
    expect(di("Depósito de 1.500 a la caja")).toMatchObject({ cuentaId: 1, monto: "1500" });
    expect(di("Depósito de 1.500 a la cuenta dólares")).toMatchObject({ cuentaId: 5, monto: "1500" });
  });

  it("«1.500»: dudoso en USDT y BTC (quedaría vacío y marcado)", () => {
    for (const f of ["Depósito de 1.500 a tether", "Depósito de 1.500 a la billetera btc"]) {
      const r = di(f);
      expect(r.monto, f).toBeNull();
      expect(r.porRevisar.monto, f).toBe("No supe si es 1500 o 1.500: escríbelo tú");
    }
  });

  it("3 decimales en Bs: no se redondea, queda vacío y dice por qué", () => {
    const r = di("Depósito de 10,555 a la caja");
    // «10,555» se lee como 10555 (miles) en Bs; con coma hablada sí son decimales:
    expect(r.monto).toBe("10555");
    const s = di("Depósito de diez coma cinco cinco cinco a la caja");
    expect(s.monto).toBeNull();
    expect(s.porRevisar.monto).toBe("Escuché 10.555: Bs admite hasta 2 decimales");
    const t = di("Depósito de 10,5555 a la caja");
    expect(t.monto).toBeNull();
    expect(t.porRevisar.monto).toBe("Escuché 10.5555: Bs admite hasta 2 decimales");
    const u = di("Depósito de 5 con 5 a la cuenta dólares");
    expect(u.monto).toBe("5.05");
  });

  it("en USDT y BTC caben hasta 8 decimales, y 9 no", () => {
    expect(di("Depósito de 0,00012345 a la billetera btc")).toMatchObject({ cuentaId: 6, monto: "0.00012345" });
    const r = di("Depósito de 0,000123456 a la billetera btc");
    expect(r.monto).toBeNull();
    expect(r.porRevisar.monto).toMatch(/hasta 8 decimales/);
  });

  it("cero no es un monto", () => {
    const r = di("depósito de cero a la caja");
    expect(r.monto).toBeNull();
    expect(r.porRevisar.monto).toMatch(/mayor que cero/);
  });

  it("«cien con cinco» son 100.05", () => {
    expect(di("retiro de cien con cinco de la caja").monto).toBe("100.05");
  });

  it("«mil quinientos» y «dos mil»", () => {
    expect(di("depósito de mil quinientos bolivianos a la caja").monto).toBe("1500");
    expect(di("depósito de dos mil a la caja").monto).toBe("2000");
  });

  it("dos cantidades sin pistas: no adivina", () => {
    const r = di("depósito 20 y 30 a la caja");
    expect(r.monto).toBeNull();
    expect(r.porRevisar.monto).toMatch(/más de una cantidad/);
  });
});
