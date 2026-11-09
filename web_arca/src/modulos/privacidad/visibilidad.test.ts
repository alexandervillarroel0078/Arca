// Fase 17: reglas y textos de la privacidad (funciones puras).
import { describe, expect, it } from "vitest";
import {
  etiquetaVisibilidad, puedeEditar, puedeRegistrarDevolucion, resumenSeleccion, textoPrivados, type ConVisibilidad,
} from "./visibilidad";

const ana = { id: 1, rol: "admin" as const };
const beto = { id: 2, rol: "miembro" as const };
const reg = (c: Partial<ConVisibilidad> = {}): ConVisibilidad => ({ usuario_id: 2, usuario_nombre: "Beto", ...c });

describe("etiquetaVisibilidad", () => {
  it("lo de la familia no lleva etiqueta (tampoco lo anterior a la Fase 17, sin dato)", () => {
    expect(etiquetaVisibilidad(reg({ visibilidad: "familia" }), beto)).toBeNull();
    expect(etiquetaVisibilidad(reg(), beto)).toBeNull();
  });
  it("lo privado propio dice 'Solo tú'", () => {
    expect(etiquetaVisibilidad(reg({ visibilidad: "solo_yo" }), beto)).toBe("Solo tú");
  });
  it("lo propio compartido dice con cuantas personas", () => {
    expect(etiquetaVisibilidad(reg({ visibilidad: "elegidas", compartido_con: [1, 3] }), beto)).toBe("Compartido con 2");
    expect(etiquetaVisibilidad(reg({ visibilidad: "elegidas", compartido_con: [1] }), beto)).toBe("Compartido con 1");
  });
  it("lo que otro compartio contigo dice 'Compartido por X'", () => {
    expect(etiquetaVisibilidad(reg({ visibilidad: "elegidas", usuario_nombre: "Beto" }), ana)).toBe("Compartido por Beto");
  });
});

describe("puedeEditar (lo compartido es de solo lectura)", () => {
  it("el dueno siempre", () => {
    for (const v of ["solo_yo", "familia", "elegidas"] as const) expect(puedeEditar(reg({ visibilidad: v }), beto)).toBe(true);
  });
  it("el admin edita lo de la familia, pero no lo compartido con el ni lo privado", () => {
    expect(puedeEditar(reg({ visibilidad: "familia" }), ana)).toBe(true);
    expect(puedeEditar(reg(), ana)).toBe(true); // sin dato = familia
    expect(puedeEditar(reg({ visibilidad: "elegidas" }), ana)).toBe(false);
    expect(puedeEditar(reg({ visibilidad: "solo_yo" }), ana)).toBe(false);
  });
  it("un miembro no edita lo de otro", () => {
    expect(puedeEditar(reg({ usuario_id: 1, visibilidad: "familia" }), beto)).toBe(false);
  });
  it("sin sesion nadie edita", () => {
    expect(puedeEditar(reg(), null)).toBe(false);
  });
});

describe("puedeRegistrarDevolucion", () => {
  it("en un apoyo de la familia cualquiera; en uno privado o compartido solo el dueno", () => {
    expect(puedeRegistrarDevolucion(reg({ usuario_id: 1, visibilidad: "familia" }), beto)).toBe(true);
    expect(puedeRegistrarDevolucion(reg({ usuario_id: 1, visibilidad: "elegidas" }), beto)).toBe(false);
    expect(puedeRegistrarDevolucion(reg({ visibilidad: "elegidas" }), beto)).toBe(true);
  });
});

describe("textos", () => {
  it("'Incluye tus N registros privados' solo si hay", () => {
    expect(textoPrivados(0)).toBeNull();
    expect(textoPrivados(undefined)).toBeNull();
    expect(textoPrivados(1)).toBe("Incluye tu 1 registro privado");
    expect(textoPrivados(3)).toBe("Incluye tus 3 registros privados");
  });
  it("resumen del selector", () => {
    expect(resumenSeleccion("solo_yo", [])).toBe("Solo tú lo ves");
    expect(resumenSeleccion("familia", [])).toBe("Toda la familia lo ve");
    expect(resumenSeleccion("elegidas", [])).toBe("Elige con quién compartirlo");
    expect(resumenSeleccion("elegidas", ["Ana"])).toBe("Solo Ana");
    expect(resumenSeleccion("elegidas", ["Ana", "Luis"])).toBe("Solo Ana y Luis");
    expect(resumenSeleccion("elegidas", ["Ana", "Luis", "Eva", "Pedro"])).toBe("Solo Ana, Luis y 2 más");
  });
});
