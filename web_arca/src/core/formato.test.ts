import { afterEach, describe, expect, it, vi } from "vitest";
import { bs, fechaCorta, hoyISO, iconoDe, mesActual, mesDesplazado, nombreMes } from "./formato";

describe("bs (moneda boliviana)", () => {
  it("usa dos decimales y separador de miles", () => {
    expect(bs(1250)).toBe("Bs 1,250.00");
    expect(bs(0)).toBe("Bs 0.00");
    expect(bs(45.5)).toBe("Bs 45.50");
    expect(bs(1234567.891)).toBe("Bs 1,234,567.89");
  });
  it("pone el signo menos antes de Bs", () => {
    expect(bs(-45.5)).toBe("-Bs 45.50");
    expect(bs(-0.004)).toBe("-Bs 0.00");
  });
});

describe("fechas", () => {
  afterEach(() => vi.useRealTimers());

  it("hoyISO y mesActual usan la fecha local", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 7, 23, 59)); // 7 nov 2026, hora local
    expect(hoyISO()).toBe("2026-11-07");
    expect(mesActual()).toBe("2026-11");
  });

  it("fechaCorta dice Hoy para hoy y 'd mes' para el resto", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 7, 12, 0));
    expect(fechaCorta("2026-11-07")).toBe("Hoy");
    expect(fechaCorta("2026-11-03")).toBe("3 nov");
    expect(fechaCorta("2026-01-31")).toBe("31 ene");
  });

  it("nombreMes largo y corto", () => {
    expect(nombreMes("2026-11")).toBe("Noviembre 2026");
    expect(nombreMes("2026-01")).toBe("Enero 2026");
    expect(nombreMes("2026-11", true)).toBe("nov");
  });

  it("mesDesplazado cruza los limites de anio", () => {
    expect(mesDesplazado("2026-01", -1)).toBe("2025-12");
    expect(mesDesplazado("2026-12", 1)).toBe("2027-01");
    expect(mesDesplazado("2026-11", -5)).toBe("2026-06");
    expect(mesDesplazado("2026-03", 0)).toBe("2026-03");
  });
});

describe("iconoDe", () => {
  it("traduce los iconos conocidos y cae en una etiqueta por defecto", () => {
    expect(iconoDe("bus")).toBe("🚌");
    expect(iconoDe("fuel")).toBe("⛽");
    expect(iconoDe("no-existe")).toBe("🏷️");
    expect(iconoDe(null)).toBe("🏷️");
    expect(iconoDe(undefined)).toBe("🏷️");
  });
});
