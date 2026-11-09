import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  anterior, calcular, claveRango, contiene, enRango, etiqueta, etiquetaComparacion, hoyLaPaz, periodoComparacion, resolverPeriodo, siguiente,
  sumarDias, type TipoPeriodo,
} from "./periodo";

interface Caso {
  tipo: TipoPeriodo;
  dia_inicio_mes: number;
  referencia: string;
  desde: string;
  hasta: string;
  etiqueta: string;
  anterior: [string, string];
  siguiente: [string, string];
  comparacion: [string, string];
  comparacion_etiqueta: string;
}

// La MISMA tabla que usa el backend (backend_arca/tests): si los dos calculan igual, las pantallas y el servidor coinciden.
const CASOS: Caso[] = JSON.parse(readFileSync(resolve(__dirname, "../../../compartido/periodos_casos.json"), "utf-8"));

describe("calculo de periodos: tabla compartida con el backend", () => {
  it("la tabla tiene casos de todos los tipos", () => {
    expect(CASOS.length).toBeGreaterThan(400);
    expect(new Set(CASOS.map((c) => c.tipo))).toEqual(new Set(["dia", "semana", "mes", "anio", "rango"]));
    expect(new Set(CASOS.map((c) => c.dia_inicio_mes))).toEqual(new Set([1, 15, 28]));
  });

  it.each(CASOS.map((c) => [`${c.tipo} dia_inicio=${c.dia_inicio_mes} ref=${c.referencia}`, c] as const))("%s", (_n, c) => {
    const r = c.tipo === "rango" ? calcular("rango", c.referencia, 1, c.desde, c.hasta) : calcular(c.tipo, c.referencia, c.dia_inicio_mes);
    expect([r.desde, r.hasta]).toEqual([c.desde, c.hasta]);
    expect(etiqueta(c.tipo, r)).toBe(c.etiqueta);
    const a = anterior(c.tipo, r, c.dia_inicio_mes);
    const s = siguiente(c.tipo, r, c.dia_inicio_mes);
    expect([a.desde, a.hasta]).toEqual(c.anterior);
    expect([s.desde, s.hasta]).toEqual(c.siguiente);
    const cmp = periodoComparacion(c.tipo, r, c.dia_inicio_mes);
    expect([cmp.desde, cmp.hasta]).toEqual(c.comparacion);
    expect(etiquetaComparacion(c.tipo, r, c.dia_inicio_mes)).toBe(c.comparacion_etiqueta);
  });
});

describe("calculo de periodos: casos de borde explicitos", () => {
  it("mes calendario: primer y ultimo dia, diciembre, cambio de anio, febrero y bisiesto", () => {
    expect(calcular("mes", "2026-11-01")).toEqual({ desde: "2026-11-01", hasta: "2026-11-30" });
    expect(calcular("mes", "2026-11-30")).toEqual({ desde: "2026-11-01", hasta: "2026-11-30" });
    expect(calcular("mes", "2026-12-31")).toEqual({ desde: "2026-12-01", hasta: "2026-12-31" });
    expect(calcular("mes", "2027-01-01")).toEqual({ desde: "2027-01-01", hasta: "2027-01-31" });
    expect(calcular("mes", "2026-02-10")).toEqual({ desde: "2026-02-01", hasta: "2026-02-28" });
    expect(calcular("mes", "2028-02-10")).toEqual({ desde: "2028-02-01", hasta: "2028-02-29" });
    expect(calcular("mes", "2100-02-10")).toEqual({ desde: "2100-02-01", hasta: "2100-02-28" });
  });

  it("mes con dia de inicio 15 y 28", () => {
    expect(calcular("mes", "2026-11-14", 15)).toEqual({ desde: "2026-10-15", hasta: "2026-11-14" });
    expect(calcular("mes", "2026-11-15", 15)).toEqual({ desde: "2026-11-15", hasta: "2026-12-14" });
    expect(calcular("mes", "2027-01-10", 15)).toEqual({ desde: "2026-12-15", hasta: "2027-01-14" });
    expect(calcular("mes", "2026-02-27", 28)).toEqual({ desde: "2026-01-28", hasta: "2026-02-27" });
    expect(calcular("mes", "2028-02-29", 28)).toEqual({ desde: "2028-02-28", hasta: "2028-03-27" });
  });

  it("semana de lunes a domingo, cruzando mes y anio", () => {
    expect(calcular("semana", "2026-11-08")).toEqual({ desde: "2026-11-02", hasta: "2026-11-08" }); // domingo
    expect(calcular("semana", "2026-11-02")).toEqual({ desde: "2026-11-02", hasta: "2026-11-08" }); // lunes
    expect(calcular("semana", "2026-10-29")).toEqual({ desde: "2026-10-26", hasta: "2026-11-01" });
    expect(calcular("semana", "2026-12-31")).toEqual({ desde: "2026-12-28", hasta: "2027-01-03" });
  });

  it("anio y rango", () => {
    expect(calcular("anio", "2026-06-15", 15)).toEqual({ desde: "2026-01-01", hasta: "2026-12-31" });
    expect(calcular("rango", "2026-01-01", 1, "2026-10-01", "2026-11-15")).toEqual({ desde: "2026-10-01", hasta: "2026-11-15" });
  });

  it("datos invalidos se rechazan", () => {
    expect(() => calcular("mes", "2026-11-08", 0)).toThrow();
    expect(() => calcular("mes", "2026-11-08", 29)).toThrow();
    expect(() => calcular("rango", "2026-11-08", 1)).toThrow();
    expect(() => calcular("rango", "2026-11-08", 1, "2026-11-09", "2026-11-08")).toThrow();
  });

  it("los periodos encajan sin huecos ni solapes (4 anios, dia de inicio 1, 15 y 28)", () => {
    for (const dia of [1, 15, 28]) {
      for (const tipo of ["dia", "semana", "mes"] as const) {
        for (let ref = "2026-01-01"; ref < "2030-01-01"; ref = sumarDias(ref, tipo === "dia" ? 1 : 3)) {
          const r = calcular(tipo, ref, dia);
          expect(contiene(r, ref)).toBe(true);
          const a = anterior(tipo, r, dia);
          expect(a.hasta).toBe(sumarDias(r.desde, -1));
          expect(siguiente(tipo, a, dia)).toEqual(r);
        }
      }
    }
  });

  it("claveRango y enRango", () => {
    expect(claveRango({ desde: "2026-11-01", hasta: "2026-11-30" })).toBe("2026-11-01_2026-11-30");
    const r = { desde: "2026-11-01", hasta: "2026-11-30" };
    expect(enRango("2026-11-01", r) && enRango("2026-11-30", r)).toBe(true);
    expect(enRango("2026-10-31", r) || enRango("2026-12-01", r)).toBe(false);
  });
});

describe("hoy es el dia de La Paz, nunca el de UTC", () => {
  it.each([
    ["2026-11-09T01:00:00Z", "2026-11-08"], // 21:00 del 8 en La Paz
    ["2026-11-08T04:30:00Z", "2026-11-08"], // 00:30 del 8
    ["2026-11-08T03:59:00Z", "2026-11-07"], // 23:59 del 7
    ["2027-01-01T03:00:00Z", "2026-12-31"],
  ])("%s -> %s", (instante, dia) => {
    expect(hoyLaPaz(new Date(instante))).toBe(dia);
  });
});

describe("resolverPeriodo: lo que elige el usuario", () => {
  const HOY = "2026-11-08";

  it("el mes actual: etiqueta, es actual, y el anterior es una seleccion explicita", () => {
    const p = resolverPeriodo({ tipo: "mes", referencia: null }, 1, HOY);
    expect([p.desde, p.hasta, p.etiqueta, p.esActual]).toEqual(["2026-11-01", "2026-11-30", "Noviembre 2026", true]);
    expect(p.anterior).toEqual({ tipo: "mes", referencia: "2026-10-01" });
    const ant = resolverPeriodo(p.anterior, 1, HOY);
    expect([ant.etiqueta, ant.esActual]).toEqual(["Octubre 2026", false]);
  });

  it("volver adelante hasta el periodo que contiene hoy lo guarda como 'el actual' (sigue a la fecha)", () => {
    const ant = resolverPeriodo({ tipo: "mes", referencia: "2026-10-01" }, 1, HOY);
    expect(ant.siguiente).toEqual({ tipo: "mes", referencia: null });
  });

  it("'Hoy' (dia): anterior es ayer; siguiente de ayer vuelve a 'el actual'", () => {
    const hoy = resolverPeriodo({ tipo: "dia", referencia: null }, 1, HOY);
    expect([hoy.desde, hoy.hasta, hoy.etiqueta]).toEqual([HOY, HOY, "8 nov 2026"]);
    const ayer = resolverPeriodo(hoy.anterior, 1, HOY);
    expect([ayer.desde, ayer.esActual]).toEqual(["2026-11-07", false]);
    expect(ayer.siguiente).toEqual({ tipo: "dia", referencia: null });
  });

  it("con dia de inicio 15 el mes actual va del 15 al 14 y se etiqueta con las fechas", () => {
    const p = resolverPeriodo({ tipo: "mes", referencia: null }, 15, HOY);
    expect([p.desde, p.hasta, p.etiqueta]).toEqual(["2026-10-15", "2026-11-14", "15 oct - 14 nov"]);
  });

  it("rango: conserva sus fechas; anterior y siguiente tienen el mismo largo; nunca es 'el actual' salvo que contenga hoy", () => {
    const p = resolverPeriodo({ tipo: "rango", referencia: null, desde: "2026-10-01", hasta: "2026-10-10" }, 1, HOY);
    expect([p.desde, p.hasta, p.esActual]).toEqual(["2026-10-01", "2026-10-10", false]);
    expect(p.anterior).toMatchObject({ tipo: "rango", desde: "2026-09-21", hasta: "2026-09-30" });
    expect(p.siguiente).toMatchObject({ tipo: "rango", desde: "2026-10-11", hasta: "2026-10-20" });
    const conHoy = resolverPeriodo({ tipo: "rango", referencia: null, desde: "2026-11-05", hasta: "2026-11-10" }, 1, HOY);
    expect(conHoy.esActual).toBe(true);
  });

  it("al cambiar la fecha de hoy el periodo 'actual' se mueve solo", () => {
    expect(resolverPeriodo({ tipo: "mes", referencia: null }, 1, "2026-12-01").etiqueta).toBe("Diciembre 2026");
  });
});

describe("comparacion: periodo anterior DEL MISMO TIPO (mes, semana, anio); mismo largo solo para dia y rango", () => {
  const cmp = (tipo: TipoPeriodo, desde: string, hasta: string, dia = 1) => {
    const c = periodoComparacion(tipo, { desde, hasta }, dia);
    return [c.desde, c.hasta, etiquetaComparacion(tipo, { desde, hasta }, dia)];
  };

  it.each([
    ["mes de 30 dias contra uno de 31", "mes", "2026-11-01", "2026-11-30", 1, ["2026-10-01", "2026-10-31", "vs octubre 2026"]],
    ["mes de 31 dias contra uno de 30", "mes", "2026-10-01", "2026-10-31", 1, ["2026-09-01", "2026-09-30", "vs septiembre 2026"]],
    ["marzo contra febrero de 28 dias", "mes", "2026-03-01", "2026-03-31", 1, ["2026-02-01", "2026-02-28", "vs febrero 2026"]],
    ["marzo contra febrero bisiesto", "mes", "2028-03-01", "2028-03-31", 1, ["2028-02-01", "2028-02-29", "vs febrero 2028"]],
    ["enero contra diciembre (cambio de anio)", "mes", "2027-01-01", "2027-01-31", 1, ["2026-12-01", "2026-12-31", "vs diciembre 2026"]],
    ["dia de inicio 15", "mes", "2026-11-15", "2026-12-14", 15, ["2026-10-15", "2026-11-14", "vs 15 oct - 14 nov"]],
    ["dia de inicio 15 cruzando el anio", "mes", "2027-01-15", "2027-02-14", 15, ["2026-12-15", "2027-01-14", "vs 15 dic - 14 ene"]],
    ["dia de inicio 28", "mes", "2026-10-28", "2026-11-27", 28, ["2026-09-28", "2026-10-27", "vs 28 sep - 27 oct"]],
    ["dia de inicio 28 con febrero", "mes", "2026-02-28", "2026-03-27", 28, ["2026-01-28", "2026-02-27", "vs 28 ene - 27 feb"]],
    ["semana contra la semana anterior", "semana", "2026-11-02", "2026-11-08", 1, ["2026-10-26", "2026-11-01", "vs 26 oct - 1 nov 2026"]],
    ["anio contra el anio anterior", "anio", "2026-01-01", "2026-12-31", 1, ["2025-01-01", "2025-12-31", "vs 2025"]],
    ["anio bisiesto contra uno comun", "anio", "2029-01-01", "2029-12-31", 1, ["2028-01-01", "2028-12-31", "vs 2028"]],
    ["dia contra ayer", "dia", "2026-03-01", "2026-03-01", 1, ["2026-02-28", "2026-02-28", "vs 28 feb 2026"]],
    ["rango: mismo largo inmediatamente antes", "rango", "2026-11-10", "2026-11-19", 1, ["2026-10-31", "2026-11-09", "vs 31 oct - 9 nov 2026"]],
    ["rango de un dia", "rango", "2026-11-10", "2026-11-10", 1, ["2026-11-09", "2026-11-09", "vs 9 nov 2026"]],
    ["tramo que no es un mes completo: mismo largo", "mes", "2026-11-05", "2026-11-20", 1, ["2026-10-20", "2026-11-04", "vs 20 oct - 4 nov 2026"]],
  ] as const)("%s", (_n, tipo, desde, hasta, dia, esperado) => {
    expect(cmp(tipo, desde, hasta, dia)).toEqual(esperado);
  });
});
