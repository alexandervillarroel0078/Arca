import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderPantalla } from "../../test/ayudas";
import * as api from "./api";
import PaginaReportes from "./PaginaReportes";

vi.mock("./api", () => ({ resumenPeriodo: vi.fn(), porCategoria: vi.fn(), porMiembro: vi.fn(), tendencia: vi.fn() }));
const A = vi.mocked(api);

const SIN_BASE: api.Comparacion = { anterior: 0, diferencia: 0, porcentaje: null };
beforeEach(() => {
  A.resumenPeriodo.mockImplementation(async (r) => ({
    mes: r.desde.slice(0, 7), ...r,
    comparacion: { desde: "2026-10-01", hasta: "2026-10-31", etiqueta: "vs octubre 2026", ingresos: SIN_BASE, gastos: SIN_BASE, saldo: SIN_BASE },
    ingresos: 1500, gastos: 200, apoyos_entregados: 200, devoluciones: 50, saldo: 1150, consumido: 0,
    gasto_familiar_total: 200, apoyos_pendientes_total: 0, apoyos_pendientes_cantidad: 0,
  }));
  A.porCategoria.mockImplementation(async (r) => ({
    mes: r.desde.slice(0, 7), ...r, total_gastos: 0, apoyos_consumidos: 0, comparacion: SIN_BASE,
    periodo_anterior: { desde: "2026-10-01", hasta: "2026-10-31", etiqueta: "vs octubre 2026" }, categorias: [],
  }));
  A.porMiembro.mockImplementation(async (r) => ({
    mes: r.desde.slice(0, 7),
    miembros: [
      { usuario_id: 1, nombre: "Ana Maria de los Angeles Perez", ingresos: 4500, gastos: 723.25, apoyos_entregados: 150 },
      { usuario_id: 2, nombre: "Beto Miembro", ingresos: 0, gastos: 65.25, apoyos_entregados: 0 },
    ],
  }));
  A.tendencia.mockResolvedValue({ meses: [] });
});

describe("Reportes: linea por persona", () => {
  const caja = async () => (await screen.findByRole("heading", { name: "Por persona" })).closest(".rounded-tarjeta") as HTMLElement;

  it("cada monto va con su etiqueta en un bloque que no se parte ('Apoyos Bs 0.00' nunca queda en dos lineas)", async () => {
    renderPantalla(<PaginaReportes />, { ruta: "/reportes", hoy: "2026-11-08" });
    const c = await caja();
    const beto = within(c).getByText("Beto Miembro").parentElement!;
    const linea = beto.querySelector("p.monto")!;
    expect(Array.from(linea.querySelectorAll("span.whitespace-nowrap")).map((e) => e.textContent)).toEqual([
      "Ingresos Bs 0.00",
      "Gastos Bs 65.25",
      "Apoyos Bs 0.00",
    ]);
  });

  it("el texto de la linea es el de siempre", async () => {
    renderPantalla(<PaginaReportes />, { ruta: "/reportes", hoy: "2026-11-08" });
    const c = await caja();
    expect(within(c).getByText("Ana Maria de los Angeles Perez").parentElement).toHaveTextContent("Ingresos Bs 4,500.00 · Gastos Bs 723.25 · Apoyos Bs 150.00");
    expect(within(c).getByText("Beto Miembro").parentElement).toHaveTextContent("Ingresos Bs 0.00 · Gastos Bs 65.25 · Apoyos Bs 0.00");
  });

  it("los bloques se separan con ' · ' que SI permiten el salto de linea (no hay un nowrap general que desborde)", async () => {
    renderPantalla(<PaginaReportes />, { ruta: "/reportes", hoy: "2026-11-08" });
    const linea = (await caja()).querySelector("li p.monto")!;
    expect(linea.className).not.toMatch(/whitespace-nowrap/);
    expect(linea.className).not.toMatch(/overflow-hidden|truncate/);
  });
});
