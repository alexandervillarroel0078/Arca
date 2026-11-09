import { describe, expect, it } from "vitest";
import { describirComparacion, recomparar } from "./comparacion";

describe("describirComparacion: siempre flecha y texto", () => {
  it("sube: '12 % mas que el periodo anterior' con la diferencia en Bs", () => {
    expect(describirComparacion({ anterior: 1000, diferencia: 120, porcentaje: 12 })).toEqual({
      flecha: "▲", direccion: "sube", texto: "12 % más que el periodo anterior", detalle: "+Bs 120.00",
    });
  });

  it("baja: '20 % menos que el periodo anterior'", () => {
    expect(describirComparacion({ anterior: 250, diferencia: -50, porcentaje: -20 })).toEqual({
      flecha: "▼", direccion: "baja", texto: "20 % menos que el periodo anterior", detalle: "-Bs 50.00",
    });
  });

  it("con decimales los conserva ('27.5 %') y sin decimales no los inventa", () => {
    expect(describirComparacion({ anterior: 800, diferencia: 220, porcentaje: 27.5 }).texto).toBe("27.5 % más que el periodo anterior");
    expect(describirComparacion({ anterior: 100, diferencia: 50, porcentaje: 50.0 }).texto).toBe("50 % más que el periodo anterior");
  });

  it("anterior en cero: no hay porcentaje (nunca 'Infinity', 'NaN' ni '%')", () => {
    const d = describirComparacion({ anterior: 0, diferencia: 500, porcentaje: null });
    expect(d).toEqual({ flecha: "▲", direccion: "sube", texto: "Sin datos en el periodo anterior para comparar", detalle: "+Bs 500.00" });
    expect(d.texto).not.toMatch(/%|Infinity|NaN/);
  });

  it("los dos en cero: sin datos y sin diferencia", () => {
    expect(describirComparacion({ anterior: 0, diferencia: 0, porcentaje: null })).toEqual({
      flecha: "＝", direccion: "igual", texto: "Sin datos en el periodo anterior", detalle: "",
    });
  });

  it("igual: '＝ Igual que el periodo anterior'", () => {
    expect(describirComparacion({ anterior: 200, diferencia: 0, porcentaje: 0 })).toEqual({
      flecha: "＝", direccion: "igual", texto: "Igual que el periodo anterior", detalle: "",
    });
  });

  it("un cambio minimo que redondea a 0 % no se llama 'igual'", () => {
    expect(describirComparacion({ anterior: 100000, diferencia: 0.5, porcentaje: 0 }).texto).toBe("Casi igual que el periodo anterior");
  });

  it("saldo negativo anterior: la direccion sale de la diferencia, no del signo del saldo", () => {
    // de -100 a -50: mejora (sube 50 %)
    expect(describirComparacion({ anterior: -100, diferencia: 50, porcentaje: 50 })).toMatchObject({ flecha: "▲", texto: "50 % más que el periodo anterior" });
  });
});

describe("recomparar: recalcula con un valor actual nuevo", () => {
  it("mantiene el anterior y recalcula diferencia y porcentaje", () => {
    expect(recomparar({ anterior: 1000, diferencia: 120, porcentaje: 12 }, 1500)).toEqual({ anterior: 1000, diferencia: 500, porcentaje: 50 });
  });
  it("anterior en cero: porcentaje nulo", () => {
    expect(recomparar({ anterior: 0, diferencia: 0, porcentaje: null }, 80)).toEqual({ anterior: 0, diferencia: 80, porcentaje: null });
  });
  it("redondea a 1 decimal", () => {
    expect(recomparar({ anterior: 300, diferencia: 0, porcentaje: 0 }, 400).porcentaje).toBe(33.3);
  });
});
