import { describe, expect, it } from "vitest";
import { itemDe } from "../../test/ayudas";
import { agruparPorDia, etiquetaDia, totalDelDia } from "./agrupar";

const HOY = "2026-11-08";
const gasto = (id: number, fecha: string, monto: number, c: Parameters<typeof itemDe>[0] = {}) => itemDe({ id, tipo: "gasto", fecha, monto, ...c });
const ingreso = (id: number, fecha: string, monto: number) => itemDe({ id, tipo: "ingreso", fecha, monto, categoria_nombre: null });
const apoyo = (id: number, fecha: string, monto: number) => itemDe({ clase: "apoyo", id, tipo: "apoyo", fecha, monto, categoria_nombre: null });

describe("etiquetaDia", () => {
  it("Hoy, Ayer y 'd mes' para los demas", () => {
    expect(etiquetaDia("2026-11-08", HOY)).toBe("Hoy");
    expect(etiquetaDia("2026-11-07", HOY)).toBe("Ayer");
    expect(etiquetaDia("2026-11-06", HOY)).toBe("6 nov");
    expect(etiquetaDia("2026-10-31", HOY)).toBe("31 oct");
    expect(etiquetaDia("2025-03-01", HOY)).toBe("1 mar");
  });

  it("Ayer cruza el cambio de mes y de anio (usa el mismo sumarDias de los periodos)", () => {
    expect(etiquetaDia("2026-10-31", "2026-11-01")).toBe("Ayer");
    expect(etiquetaDia("2025-12-31", "2026-01-01")).toBe("Ayer");
    expect(etiquetaDia("2026-02-28", "2026-03-01")).toBe("Ayer");
  });

  it("un dia futuro no es 'Hoy' ni 'Ayer'", () => {
    expect(etiquetaDia("2026-11-09", HOY)).toBe("9 nov");
  });
});

describe("totalDelDia", () => {
  it("ingresos suman; gastos y apoyos entregados restan", () => {
    expect(totalDelDia([ingreso(1, HOY, 1000), gasto(2, HOY, 45), apoyo(3, HOY, 200)])).toBe(755);
  });

  it("lo anulado no cuenta", () => {
    expect(totalDelDia([gasto(1, HOY, 100), gasto(2, HOY, 999, { anulado: true })])).toBe(-100);
  });

  it("sin filas, o solo con anuladas, no hay total (null, no 0)", () => {
    expect(totalDelDia([])).toBeNull();
    expect(totalDelDia([gasto(1, HOY, 50, { anulado: true })])).toBeNull();
  });

  it("no arrastra errores de coma flotante (0,1 + 0,2)", () => {
    expect(totalDelDia([ingreso(1, HOY, 0.1), ingreso(2, HOY, 0.2)])).toBe(0.3);
    expect(totalDelDia([gasto(1, HOY, 12.75), gasto(2, HOY, 52.5), gasto(3, HOY, 98.75)])).toBe(-164);
  });

  it("el total puede ser positivo, negativo o cero", () => {
    expect(totalDelDia([ingreso(1, HOY, 10), gasto(2, HOY, 10)])).toBe(0);
    expect(totalDelDia([ingreso(1, HOY, 10)])).toBe(10);
  });
});

describe("agruparPorDia", () => {
  const items = [
    ingreso(1, "2026-11-08", 1000), gasto(2, "2026-11-08", 45),
    gasto(3, "2026-11-07", 30), apoyo(4, "2026-11-07", 200), gasto(5, "2026-11-07", 999, { anulado: true }),
    gasto(6, "2026-11-03", 12.5),
  ];

  it("un grupo por dia, en el orden recibido, con titulo y filas", () => {
    const g = agruparPorDia(items, HOY);
    expect(g.map((x) => x.titulo)).toEqual(["Hoy", "Ayer", "3 nov"]);
    expect(g.map((x) => x.fecha)).toEqual(["2026-11-08", "2026-11-07", "2026-11-03"]);
    expect(g.map((x) => x.items.map((i) => i.id))).toEqual([[1, 2], [3, 4, 5], [6]]);
  });

  it("cada grupo trae su total correcto (lo anulado no cuenta)", () => {
    expect(agruparPorDia(items, HOY).map((x) => x.total)).toEqual([955, -230, -12.5]);
  });

  it("un dia sin movimientos NO aparece (no hay grupos vacios entre dos fechas)", () => {
    const g = agruparPorDia([gasto(1, "2026-11-08", 5), gasto(2, "2026-11-02", 5)], HOY);
    expect(g).toHaveLength(2);
    expect(g.map((x) => x.fecha)).not.toContain("2026-11-05");
    expect(agruparPorDia([], HOY)).toEqual([]);
  });

  it("un dia solo con anulados aparece pero sin total", () => {
    const g = agruparPorDia([gasto(1, "2026-11-07", 50, { anulado: true })], HOY);
    expect(g).toHaveLength(1);
    expect(g[0].total).toBeNull();
  });

  it("agrupa filas CONSECUTIVAS: la misma fecha separada por otra sale dos veces (se respeta el orden de la lista)", () => {
    const g = agruparPorDia([gasto(1, "2026-11-08", 1), gasto(2, "2026-11-07", 1), gasto(3, "2026-11-08", 1)], HOY);
    expect(g.map((x) => x.titulo)).toEqual(["Hoy", "Ayer", "Hoy"]);
  });

  it("con paginas por cargar (hayMas) el ULTIMO dia no muestra total: puede seguir en la pagina siguiente", () => {
    const g = agruparPorDia(items, HOY, true);
    expect(g.map((x) => x.total)).toEqual([955, -230, null]);
  });

  it("sin paginas pendientes el ultimo dia si lleva total", () => {
    expect(agruparPorDia(items, HOY, false)[2].total).toBe(-12.5);
  });
});
