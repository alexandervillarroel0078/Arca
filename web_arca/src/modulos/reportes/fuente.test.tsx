// Fuente de pago (0010) en Inicio y Reportes: "Te queda" solo con Efectivo, lo de banco aparte para que cuadre, y el filtro.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { admin, renderPantalla } from "../../test/ayudas";
import type { Yo } from "../auth/api";
import PaginaInicio from "../inicio/PaginaInicio";
import * as mov from "../movimientos/api";
import * as api from "./api";
import { ingresadoAlBanco, pagadoConBanco, saldoEfectivo } from "./fuente";
import PaginaReportes from "./PaginaReportes";

const sesion = vi.hoisted(() => ({ usuario: null as Yo | null, salir: vi.fn() }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => sesion }));
vi.mock("./api", () => ({ resumenPeriodo: vi.fn(), porCategoria: vi.fn(), porMiembro: vi.fn(), tendencia: vi.fn() }));
vi.mock("../movimientos/api", () => ({ listarMovimientos: vi.fn(), anularMovimiento: vi.fn(), reactivarMovimiento: vi.fn() }));
vi.mock("../apoyos/api", () => ({ anularApoyo: vi.fn(), reactivarApoyo: vi.fn() }));
const A = vi.mocked(api);

const cmp = { anterior: 0, diferencia: 0, porcentaje: null };
// ingresos 1500 (500 al banco), gastos 540 (340 con banco), apoyos 50 (con banco), devoluciones 0
// Te queda = (1500-500) - (540-340) - (50-50) + 0 = 800
const RESUMEN: api.Resumen = {
  mes: "2026-11", desde: "2026-11-01", hasta: "2026-11-30",
  comparacion: { desde: "2026-10-01", hasta: "2026-10-31", etiqueta: "vs octubre 2026", ingresos: cmp, gastos: cmp, saldo: cmp, saldo_efectivo: cmp },
  ingresos: 1500, gastos: 540, apoyos_entregados: 50, devoluciones: 0, saldo: 910, consumido: 0, gasto_familiar_total: 540,
  apoyos_pendientes_total: 0, apoyos_pendientes_cantidad: 0,
  ingresos_banco: 500, gastos_banco: 340, apoyos_banco: 50, saldo_efectivo: 800,
};
const MES: api.MesTotal = {
  mes: "2026-11", ingresos: 1500, gastos: 540, apoyos_entregados: 50, devoluciones: 0, consumido: 0, saldo: 910,
  ingresos_banco: 500, gastos_banco: 340, apoyos_banco: 50, saldo_efectivo: 800,
};

beforeEach(() => {
  sesion.usuario = admin;
  A.resumenPeriodo.mockReset().mockResolvedValue(RESUMEN);
  A.porCategoria.mockReset().mockResolvedValue({
    mes: "2026-11", desde: "2026-11-01", hasta: "2026-11-30", total_gastos: 540, apoyos_consumidos: 0, categorias: [],
    comparacion: cmp, periodo_anterior: { desde: "2026-10-01", hasta: "2026-10-31", etiqueta: "vs octubre 2026" },
  });
  A.porMiembro.mockReset().mockResolvedValue({ mes: "2026-11", miembros: [] });
  A.tendencia.mockReset().mockResolvedValue({ meses: [MES] });
  vi.mocked(mov.listarMovimientos).mockResolvedValue([]);
});

describe("Cálculos", () => {
  it("saldo de efectivo, pagado con banco e ingresado al banco (sin dato = como antes)", () => {
    expect(saldoEfectivo(RESUMEN)).toBe(800);
    expect(pagadoConBanco(RESUMEN)).toBe(390);
    expect(ingresadoAlBanco(RESUMEN)).toBe(500);
    expect(saldoEfectivo({ saldo: 10 })).toBe(10);
    expect(pagadoConBanco({ saldo: 10 })).toBe(0);
  });
});

describe("Inicio: la tarjeta cuadra con lo de banco", () => {
  it("Saldo de efectivo, «+ Pagado con banco» y «− Ingresado al banco»", async () => {
    renderPantalla(<PaginaInicio />, { ruta: "/", hoy: "2026-11-08" });
    expect(await screen.findByTestId("saldo")).toHaveTextContent("Bs 800.00");
    const cuadre = within(screen.getByTestId("cuadre-saldo"));
    expect(cuadre.getByText(/Pagado con banco/).parentElement).toHaveTextContent("Bs 390.00");
    expect(cuadre.getByText(/Pagado con banco/)).toHaveTextContent("＋");
    expect(cuadre.getByText(/Ingresado al banco/).parentElement).toHaveTextContent("Bs 500.00");
    expect(cuadre.getByText(/Ingresado al banco/)).toHaveTextContent("－");
  });

  it("sin nada de banco no aparecen esas líneas", async () => {
    A.resumenPeriodo.mockResolvedValue({ ...RESUMEN, ingresos_banco: 0, gastos_banco: 0, apoyos_banco: 0, saldo_efectivo: 910 });
    renderPantalla(<PaginaInicio />, { ruta: "/", hoy: "2026-11-08" });
    expect(await screen.findByTestId("saldo")).toHaveTextContent("Bs 910.00");
    expect(screen.queryByText(/Pagado con banco/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ingresado al banco/)).not.toBeInTheDocument();
  });
});

describe("Reportes con fuente de pago", () => {
  it("el resumen cuadra y el mes dice lo pagado con banco (incluido en gastos)", async () => {
    renderPantalla(<PaginaReportes />, { ruta: "/reportes", hoy: "2026-11-08" });
    expect(await screen.findByTestId("saldo-efectivo-reportes")).toHaveTextContent("Bs 800.00");
    expect(screen.getByText("Pagado con banco").nextElementSibling).toHaveTextContent("Bs 390.00");
    expect(screen.getByText("Ingresado al banco").nextElementSibling).toHaveTextContent("-Bs 500.00");
    const fila = screen.getByTestId("fila-mes");
    expect(fila).toHaveTextContent("Te queda Bs 800.00");
    expect(within(fila).getByTestId("pagado-banco-mes")).toHaveTextContent("Pagado con banco Bs 390.00 (incluido en gastos y apoyos)");
    expect(within(fila).getByTestId("ingresado-banco-mes")).toHaveTextContent("Ingresado al banco Bs 500.00");
    // la barra: gastos en efectivo (200) + apoyos en efectivo (0) + te queda (800) = ingresos en efectivo (1000)
    expect(within(fila).getByRole("img", { name: "Gastos en efectivo Bs 200.00" })).toBeInTheDocument();
    expect(within(fila).getByRole("img", { name: "Te queda Bs 800.00" })).toBeInTheDocument();
    expect(within(fila).queryByRole("img", { name: /Apoyos/ })).not.toBeInTheDocument();
  });

  it("el filtro Todos / Efectivo / Banco vuelve a pedir todo con esa fuente; con Banco no hay «Te queda»", async () => {
    const u = userEvent.setup();
    renderPantalla(<PaginaReportes />, { ruta: "/reportes", hoy: "2026-11-08" });
    const filtro = await screen.findByRole("radiogroup", { name: "Fuente de pago" });
    expect(within(filtro).getByRole("radio", { name: "Todos" })).toHaveAttribute("aria-checked", "true");
    await u.click(within(filtro).getByRole("radio", { name: "Banco" }));
    await waitFor(() => expect(A.tendencia).toHaveBeenLastCalledWith("banco"));
    expect(A.resumenPeriodo.mock.lastCall?.[2]).toBe("banco");
    expect(A.porCategoria.mock.lastCall?.[2]).toBe("banco");
    expect(A.porMiembro.mock.lastCall?.[1]).toBe("banco");
    await waitFor(() => expect(screen.queryByTestId("saldo-efectivo-reportes")).not.toBeInTheDocument());
    await u.click(within(filtro).getByRole("radio", { name: "Efectivo" }));
    await waitFor(() => expect(A.tendencia).toHaveBeenLastCalledWith("efectivo"));
  });
});
