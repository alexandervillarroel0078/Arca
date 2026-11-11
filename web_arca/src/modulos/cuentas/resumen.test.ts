import { describe, expect, it } from "vitest";
import { cuentaDe, mov } from "../../test/cuentas";
import { aTexto } from "./montos";
import { permisosDeCuenta, puedeAnularMovimiento, cuentasRegistrables, destinosDeTraspaso } from "./permisos";
import { clavePersona, filtrarPorPersona, limitesDeMes, personasDe, resumenMes, sugerenciasDeNombres } from "./resumen";

describe("detalle: Entró / Salió del mes", () => {
  it("Entró = depósitos; Salió = retiros + comisión; traspasos y ajustes aparte", () => {
    const r = resumenMes([
      mov({ id: 1, tipo: "deposito", efecto: "100.00" }),
      mov({ id: 2, tipo: "deposito", efecto: "0.10" }),
      mov({ id: 3, tipo: "retiro", comision: "1.50", efecto: "-31.50" }),
      mov({ id: 4, tipo: "traspaso", efecto: "-40.00" }),
      mov({ id: 5, tipo: "traspaso", efecto: "15.00" }),
      mov({ id: 6, tipo: "ajuste", sentido: "salida", efecto: "-4.50" }),
    ]);
    expect(aTexto(r.entro, "BS")).toBe("100.10");
    expect(aTexto(r.salio, "BS")).toBe("31.50"); // el retiro de 30 + la comisión de 1.50
    expect(aTexto(r.traspasos, "BS")).toBe("-25.00");
    expect(aTexto(r.ajustes, "BS")).toBe("-4.50");
  });
  it("los anulados no cuentan", () => {
    const r = resumenMes([mov({ efecto: "50.00", anulado: true }), mov({ id: 2, efecto: "5.00" })]);
    expect(aTexto(r.entro, "BS")).toBe("5.00");
  });
  it("con criptomonedas suma 8 decimales exactos", () => {
    const r = resumenMes([mov({ moneda: "BTC", efecto: "0.1" }), mov({ id: 2, moneda: "BTC", efecto: "0.2" })]);
    expect(aTexto(r.entro, "BTC")).toBe("0.3");
  });
  it("límites del mes", () => {
    expect(limitesDeMes("2026-11")).toEqual({ desde: "2026-11-01", hasta: "2026-11-30" });
    expect(limitesDeMes("2028-02")).toEqual({ desde: "2028-02-01", hasta: "2028-02-29" });
    expect(limitesDeMes("2026-12").hasta).toBe("2026-12-31");
  });
});

describe("filtro por persona y sugerencias", () => {
  const lista = [
    mov({ id: 1, persona_tipo: "miembro", persona_usuario_id: 2, persona_nombre: "Beto" }),
    mov({ id: 2, persona_tipo: "otra", persona_nombre: "Tía Rosa" }),
    mov({ id: 3, persona_tipo: "otra", persona_nombre: "Tía Rosa" }),
    mov({ id: 4 }),
  ];
  it("agrupa por persona sin repetir", () => {
    expect(personasDe(lista)).toEqual([
      { valor: "m:2", texto: "Beto" }, { valor: "o:Tía Rosa", texto: "Tía Rosa" }, { valor: "sin", texto: "Sin identificar" },
    ]);
    expect(clavePersona(lista[3])).toBe("sin");
  });
  it("filtra", () => {
    expect(filtrarPorPersona(lista, "o:Tía Rosa").map((m) => m.id)).toEqual([2, 3]);
    expect(filtrarPorPersona(lista, "sin").map((m) => m.id)).toEqual([4]);
    expect(filtrarPorPersona(lista, "")).toHaveLength(4);
  });
  it("sugiere nombres ya usados de «otra persona»", () => {
    expect(sugerenciasDeNombres(lista, "")).toEqual(["Tía Rosa"]);
    expect(sugerenciasDeNombres(lista, "ros")).toEqual(["Tía Rosa"]);
    expect(sugerenciasDeNombres(lista, "Tía Rosa")).toEqual([]); // ya está escrito completo
    expect(sugerenciasDeNombres(lista, "zzz")).toEqual([]);
  });
});

describe("permisos en la interfaz: solo lo que dice la API", () => {
  it("el dueño edita y registra; el encargado solo registra; un lector no hace nada", () => {
    expect(permisosDeCuenta(cuentaDe({ es_dueno: true, puede_registrar: true }))).toEqual({ registrar: true, editar: true });
    expect(permisosDeCuenta(cuentaDe({ es_dueno: false, puede_registrar: true }))).toEqual({ registrar: true, editar: false });
    expect(permisosDeCuenta(cuentaDe({ es_dueno: false, puede_registrar: false }))).toEqual({ registrar: false, editar: false });
  });
  it("una cuenta anulada no se registra", () => {
    expect(permisosDeCuenta(cuentaDe({ anulado: true })).registrar).toBe(false);
  });
  it("anular un movimiento depende solo de puede_registrar", () => {
    expect(puedeAnularMovimiento({ puede_registrar: true })).toBe(true);
    expect(puedeAnularMovimiento({ puede_registrar: false })).toBe(false);
  });
  it("traspaso: solo cuentas de la misma moneda donde también puedas registrar", () => {
    const a = cuentaDe({ id: 1, moneda: "BS" });
    const cuentas = [
      a, cuentaDe({ id: 2, moneda: "BS" }), cuentaDe({ id: 3, moneda: "USD" }), cuentaDe({ id: 4, moneda: "BS", puede_registrar: false }),
      cuentaDe({ id: 5, moneda: "BS", anulado: true }),
    ];
    expect(cuentasRegistrables(cuentas).map((c) => c.id)).toEqual([1, 2, 3]);
    expect(destinosDeTraspaso(a, cuentas).map((c) => c.id)).toEqual([2]);
    expect(destinosDeTraspaso(undefined, cuentas)).toEqual([]);
  });
});
