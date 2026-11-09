import { describe, expect, it } from "vitest";
import { fechaHora, textoAnulado, type Auditoria } from "./tipos";

const base: Auditoria = {
  version: 1, uuid_cliente: null, anulado: true, anulado_por_nombre: "Ana", anulado_en: new Date(2026, 10, 3, 14, 5).toISOString(),
  motivo_anulacion: "Duplicado", editado_por_nombre: null, editado_en: null,
};

describe("fechaHora", () => {
  it("da 'd mes HH:MM' en hora local", () => {
    expect(fechaHora(new Date(2026, 10, 3, 14, 5).toISOString())).toBe("3 nov 14:05");
    expect(fechaHora(new Date(2026, 0, 31, 9, 7).toISOString())).toBe("31 ene 09:07");
  });
});

describe("textoAnulado", () => {
  it("incluye quien, cuando y el motivo", () => {
    expect(textoAnulado(base)).toBe("Anulado por Ana · 3 nov 14:05 · Duplicado");
  });
  it("omite lo que no existe", () => {
    expect(textoAnulado({ ...base, motivo_anulacion: null })).toBe("Anulado por Ana · 3 nov 14:05");
    expect(textoAnulado({ ...base, anulado_por_nombre: null, anulado_en: null })).toBe("Anulado · Duplicado");
    expect(textoAnulado({ ...base, anulado_por_nombre: null, anulado_en: null, motivo_anulacion: null })).toBe("Anulado");
  });
});
