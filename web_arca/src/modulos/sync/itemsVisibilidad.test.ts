// Fase 17: al convertir un movimiento o apoyo en fila de la lista no se pierde quien lo ve (el candado de Inicio).
import { describe, expect, it } from "vitest";
import { apoyoAItem, movimientoAItem } from "./superponer";

const base = { id: 1, usuario_id: 2, usuario_nombre: "Beto", monto: 5, fecha: "2026-11-01", nota: "x", version: 1, anulado: false } as const;

describe("movimientoAItem / apoyoAItem conservan la visibilidad", () => {
  it("movimiento privado y compartido", () => {
    const m = { ...base, tipo: "gasto", categoria_id: 1, categoria_nombre: "Comida", categoria_icono: "x", visibilidad: "elegidas", compartido_con: [3] };
    const i = movimientoAItem(m as never);
    expect(i.visibilidad).toBe("elegidas");
    expect(i.compartido_con).toEqual([3]);
  });
  it("apoyo privado", () => {
    const a = { ...base, beneficiario: "Tia", estado: "Pendiente", pendiente: 5, visibilidad: "solo_yo", compartido_con: [] };
    expect(apoyoAItem(a as never).visibilidad).toBe("solo_yo");
  });
});
