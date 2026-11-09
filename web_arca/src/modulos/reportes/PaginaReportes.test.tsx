import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorRed } from "../../core/api";
import { renderPantalla } from "../../test/ayudas";
import { encolar } from "../sync/cola";
import * as api from "./api";
import PaginaReportes from "./PaginaReportes";

vi.mock("./api", () => ({ resumenPeriodo: vi.fn(), porCategoria: vi.fn(), porMiembro: vi.fn(), tendencia: vi.fn() }));
const A = vi.mocked(api);

const NOV = { desde: "2026-11-01", hasta: "2026-11-30" };
const OCT = { desde: "2026-10-01", hasta: "2026-10-31" };
const SIN_BASE: api.Comparacion = { anterior: 0, diferencia: 0, porcentaje: null };

const resumen = (r: { desde: string; hasta: string }, c: Partial<api.Resumen> = {}): api.Resumen => ({
  mes: r.desde.slice(0, 7), ...r,
  comparacion: {
    desde: "2026-10-01", hasta: "2026-10-31", etiqueta: "vs octubre 2026",
    ingresos: { anterior: 1000, diferencia: 500, porcentaje: 50 },
    gastos: { anterior: 250, diferencia: -50, porcentaje: -20 },
    saldo: SIN_BASE,
  },
  ingresos: 1500, gastos: 200, apoyos_entregados: 200, devoluciones: 50, saldo: 1150, consumido: 150,
  gasto_familiar_total: 350, apoyos_pendientes_total: 0, apoyos_pendientes_cantidad: 0, ...c,
});
const meses = (): api.MesTotal[] =>
  Array.from({ length: 6 }, (_, i) => {
    const mes = `2026-${String(6 + i).padStart(2, "0")}`;
    return { mes, ingresos: i === 5 ? 1500 : 0, gastos: i === 5 ? 200 : 0, apoyos_entregados: 0, devoluciones: 0, consumido: 0, saldo: i === 5 ? 1150 : 0 };
  });
const porCat = (r: { desde: string; hasta: string }, c: Partial<api.PorCategoria> = {}): api.PorCategoria => ({
  mes: r.desde.slice(0, 7), ...r, total_gastos: 200, apoyos_consumidos: 150,
  comparacion: { anterior: 100, diferencia: 100, porcentaje: 100 },
  periodo_anterior: { desde: "2026-10-01", hasta: "2026-10-31", etiqueta: "vs octubre 2026" },
  categorias: [
    { categoria_id: 2, categoria: "Comida", icono: "utensils", total: 150, porcentaje: 75, comparacion: { anterior: 100, diferencia: 50, porcentaje: 50 } },
    { categoria_id: 1, categoria: "Transporte", icono: "bus", total: 50, porcentaje: 25, comparacion: SIN_BASE },
  ],
  ...c,
});

beforeEach(() => {
  A.resumenPeriodo.mockImplementation(async (r) => resumen(r));
  A.porCategoria.mockImplementation(async (r) => porCat(r));
  A.porMiembro.mockImplementation(async (r) => ({
    mes: r.desde.slice(0, 7),
    miembros: [
      { usuario_id: 1, nombre: "Ana Admin", ingresos: 1000, gastos: 150, apoyos_entregados: 200 },
      { usuario_id: 2, nombre: "Beto Miembro", ingresos: 500, gastos: 50, apoyos_entregados: 0 },
    ],
  }));
  A.tendencia.mockResolvedValue({ meses: meses() });
});

const abrir = () => renderPantalla(<PaginaReportes />, { ruta: "/reportes", hoy: "2026-11-08" });
const resumenCaja = () => screen.getByRole("heading", { name: "Resumen" }).closest(".rounded-tarjeta") as HTMLElement;

describe("Reportes", () => {
  it("resumen: muestra el calculo del saldo y los consumidos aparte", async () => {
    abrir();
    await screen.findByRole("heading", { name: "Resumen" });
    const r = within(resumenCaja());
    expect(r.getByText("Ingresos").nextElementSibling).toHaveTextContent("Bs 1,500.00");
    expect(r.getByText("Gastos").nextElementSibling).toHaveTextContent("-Bs 200.00");
    expect(r.getByText("Apoyos entregados").nextElementSibling).toHaveTextContent("-Bs 200.00");
    expect(r.getByText("Devoluciones").nextElementSibling).toHaveTextContent("Bs 50.00");
    expect(r.getByText("Saldo de efectivo").nextElementSibling).toHaveTextContent("Bs 1,150.00");
    expect(r.getByText("Apoyos consumidos (gasto familiar)").nextElementSibling).toHaveTextContent("Bs 150.00");
  });

  it("pide la comparacion segun el tipo de periodo elegido (mes, semana, anio, rango)", async () => {
    const u = userEvent.setup();
    abrir();
    await screen.findByRole("heading", { name: "Resumen" });
    expect(A.resumenPeriodo).toHaveBeenLastCalledWith(NOV, "mes");
    expect(A.porCategoria).toHaveBeenLastCalledWith(NOV, "mes");
    await u.click(screen.getByRole("button", { name: "Semana" }));
    await waitFor(() => expect(A.resumenPeriodo).toHaveBeenLastCalledWith({ desde: "2026-11-02", hasta: "2026-11-08" }, "semana"));
    await u.click(screen.getByRole("button", { name: "Año" }));
    await waitFor(() => expect(A.resumenPeriodo).toHaveBeenLastCalledWith({ desde: "2026-01-01", hasta: "2026-12-31" }, "anio"));
  });

  it("usa el mes actual al abrir y lo muestra con su nombre; pide desde y hasta del periodo", async () => {
    abrir();
    expect(await screen.findByTestId("etiqueta-periodo")).toHaveTextContent("Noviembre 2026");
    expect(A.resumenPeriodo).toHaveBeenCalledWith(NOV, "mes");
    expect(A.porCategoria).toHaveBeenCalledWith(NOV, "mes");
    expect(A.porMiembro).toHaveBeenCalledWith(NOV);
  });

  it("gastos por categoria: porcentaje, monto y el consumido en linea aparte", async () => {
    abrir();
    const caja = (await screen.findByRole("heading", { name: "Gastos por categoría" })).closest(".rounded-tarjeta") as HTMLElement;
    await within(caja).findByText(/Comida/);
    expect(within(caja).getByText(/Comida/).parentElement).toHaveTextContent("(75%)");
    expect(within(caja).getByText(/Comida/).parentElement).toHaveTextContent("Bs 150.00");
    expect(within(caja).getByText(/Transporte/).parentElement).toHaveTextContent("(25%)");
    const aparte = within(caja).getByText("🤝 Apoyos consumidos (aparte)").parentElement!;
    expect(aparte).toHaveTextContent("Bs 150.00");
  });

  it("sin gastos ni consumido muestra el mensaje vacio", async () => {
    A.porCategoria.mockResolvedValue(porCat(NOV, { categorias: [], total_gastos: 0, apoyos_consumidos: 0 }));
    abrir();
    expect(await screen.findByText("Sin gastos en este periodo.")).toBeInTheDocument();
  });

  it("solo consumido (sin gastos) igual muestra la linea aparte", async () => {
    A.porCategoria.mockResolvedValue(porCat(NOV, { categorias: [], total_gastos: 0, apoyos_consumidos: 90 }));
    abrir();
    expect(await screen.findByText("🤝 Apoyos consumidos (aparte)")).toBeInTheDocument();
    expect(screen.queryByText("Sin gastos en este periodo.")).not.toBeInTheDocument();
  });

  it("por persona: ingresos, gastos y apoyos de cada una", async () => {
    abrir();
    const caja = (await screen.findByRole("heading", { name: "Por persona" })).closest(".rounded-tarjeta") as HTMLElement;
    const ana = within(caja).getByText("Ana Admin").parentElement!;
    expect(ana).toHaveTextContent("Ingresos Bs 1,000.00 · Gastos Bs 150.00 · Apoyos Bs 200.00");
    expect(within(caja).getByText("Beto Miembro").parentElement).toHaveTextContent("Ingresos Bs 500.00 · Gastos Bs 50.00 · Apoyos Bs 0.00");
  });

  it("ultimos 6 meses: una fila por mes con saldo; el saldo negativo se marca en rojo", async () => {
    const lista = meses();
    lista[2] = { ...lista[2], saldo: -70, ingresos: 0, gastos: 70 };
    A.tendencia.mockResolvedValue({ meses: lista });
    abrir();
    await waitFor(() => expect(screen.getAllByTestId("fila-mes")).toHaveLength(6));
    const filas = screen.getAllByTestId("fila-mes");
    expect(filas[5]).toHaveTextContent("Saldo Bs 1,150.00");
    expect(filas[2]).toHaveTextContent("Saldo -Bs 70.00");
    expect(within(filas[2]).getByText("Saldo -Bs 70.00").className).toMatch(/text-red-700/);
    expect(filas[5]).toHaveTextContent("Ingresos Bs 1,500.00 · Gastos Bs 200.00");
  });
});

describe("Reportes: comparacion con el periodo anterior (siempre flecha y texto, nunca solo color)", () => {
  it("ingresos que subieron: flecha hacia arriba y '50 % mas que el periodo anterior'", async () => {
    abrir();
    const c = await screen.findByTestId("comparacion-ingresos");
    expect(c).toHaveTextContent("▲ 50 % más que el periodo anterior");
    expect(c).toHaveTextContent("+Bs 500.00");
  });

  it("gastos que bajaron: flecha hacia abajo y '20 % menos que el periodo anterior'", async () => {
    abrir();
    const c = await screen.findByTestId("comparacion-gastos");
    expect(c).toHaveTextContent("▼ 20 % menos que el periodo anterior");
    expect(c).toHaveTextContent("-Bs 50.00");
  });

  it("si el periodo anterior estaba en cero NO se inventa un porcentaje: se dice que no hay con que comparar", async () => {
    A.resumenPeriodo.mockResolvedValue(
      resumen(NOV, { comparacion: { ...resumen(NOV).comparacion, ingresos: { anterior: 0, diferencia: 1500, porcentaje: null } } }),
    );
    abrir();
    const c = await screen.findByTestId("comparacion-ingresos");
    expect(c).toHaveTextContent("Sin datos en el periodo anterior para comparar");
    expect(c.textContent).not.toMatch(/▲|▼|＝|\+Bs/); // sin base no hay flecha ni diferencia en Bs (no compararian con nada)
    expect(c.textContent).not.toMatch(/%|Infinity|NaN/);
  });

  it("igual que antes: '＝ Igual que el periodo anterior'", async () => {
    A.resumenPeriodo.mockResolvedValue(
      resumen(NOV, { comparacion: { ...resumen(NOV).comparacion, gastos: { anterior: 200, diferencia: 0, porcentaje: 0 } } }),
    );
    abrir();
    expect(await screen.findByTestId("comparacion-gastos")).toHaveTextContent("＝ Igual que el periodo anterior");
  });

  it("dice cual es el periodo anterior con el que se compara", async () => {
    abrir();
    expect(await screen.findByTestId("periodo-anterior")).toHaveTextContent("Comparado vs octubre 2026");
  });

  it("cada categoria lleva su propia comparacion", async () => {
    abrir();
    expect(await screen.findByTestId("comparacion-categoria-2")).toHaveTextContent("▲ 50 % más que el periodo anterior");
    expect(screen.getByTestId("comparacion-categoria-1")).toHaveTextContent("Sin datos en el periodo anterior");
  });
});

describe("Reportes: periodo (selector comun)", () => {
  it("la flecha siguiente esta deshabilitada en el periodo actual", async () => {
    abrir();
    await screen.findByTestId("etiqueta-periodo");
    expect(screen.getByLabelText("Periodo siguiente")).toBeDisabled();
  });

  it("'Periodo anterior' vuelve a pedir todo con ese periodo y habilita 'Periodo siguiente'", async () => {
    const u = userEvent.setup();
    abrir();
    await screen.findByTestId("etiqueta-periodo");
    await u.click(screen.getByLabelText("Periodo anterior"));
    await waitFor(() => expect(screen.getByTestId("etiqueta-periodo")).toHaveTextContent("Octubre 2026"));
    expect(A.resumenPeriodo).toHaveBeenLastCalledWith(OCT, "mes");
    expect(A.porCategoria).toHaveBeenLastCalledWith(OCT, "mes");
    expect(A.porMiembro).toHaveBeenLastCalledWith(OCT);
    expect(screen.getByLabelText("Periodo siguiente")).toBeEnabled();
    await u.click(screen.getByLabelText("Periodo siguiente"));
    await waitFor(() => expect(screen.getByTestId("etiqueta-periodo")).toHaveTextContent("Noviembre 2026"));
  });

  it("con el dia de inicio 15 el mes va del 15 al 14 y se pide asi", async () => {
    renderPantalla(<PaginaReportes />, { ruta: "/reportes", hoy: "2026-11-08", diaInicioMes: 15 });
    expect(await screen.findByTestId("etiqueta-periodo")).toHaveTextContent("15 oct - 14 nov");
    expect(A.resumenPeriodo).toHaveBeenCalledWith({ desde: "2026-10-15", hasta: "2026-11-14" }, "mes");
  });

  it("si falla la carga muestra el error", async () => {
    A.resumenPeriodo.mockRejectedValue(new Error("Error del servidor"));
    abrir();
    expect(await screen.findByRole("alert")).toHaveTextContent("Error del servidor");
  });

  it("sin conexion y sin copia de ese periodo: 'Sin datos guardados para este periodo' (y se puede volver a otro)", async () => {
    A.resumenPeriodo.mockRejectedValue(new ErrorRed());
    abrir();
    expect(await screen.findByTestId("sin-datos-periodo")).toHaveTextContent("Sin datos guardados para este periodo");
    expect(screen.getByTestId("selector-periodo")).toBeInTheDocument();
  });

  it("sin conexion al ir a un periodo nunca abierto: avisa y NO deja los numeros del periodo anterior; al volver, reaparecen", async () => {
    const u = userEvent.setup();
    abrir();
    await screen.findByRole("heading", { name: "Resumen" });
    A.resumenPeriodo.mockRejectedValue(new ErrorRed());
    await u.click(screen.getByLabelText("Periodo anterior"));
    expect(await screen.findByTestId("sin-datos-periodo")).toHaveTextContent("Sin datos guardados para este periodo");
    expect(screen.queryByRole("heading", { name: "Resumen" })).not.toBeInTheDocument();
    expect(screen.getByTestId("etiqueta-periodo")).toHaveTextContent("Octubre 2026");
    A.resumenPeriodo.mockImplementation(async (r) => resumen(r));
    await u.click(screen.getByLabelText("Periodo siguiente"));
    expect(await screen.findByRole("heading", { name: "Resumen" })).toBeInTheDocument();
    expect(screen.queryByTestId("sin-datos-periodo")).not.toBeInTheDocument();
  });

  it("al cambiar de periodo no se muestran los numeros del anterior mientras llegan los nuevos", async () => {
    const u = userEvent.setup();
    abrir();
    await screen.findByRole("heading", { name: "Resumen" });
    A.resumenPeriodo.mockReturnValue(new Promise(() => {})); // el periodo nuevo nunca llega
    await u.click(screen.getByLabelText("Periodo anterior"));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Resumen" })).not.toBeInTheDocument());
    expect(screen.getByText("Cargando...")).toBeInTheDocument();
  });
});

describe("Reportes: cambios sin enviar (Fase 12)", () => {
  it("avisa que el resumen incluye lo pendiente y que lo demas se actualiza al sincronizar", async () => {
    await encolar({ entidad: "movimiento", accion: "crear", uuid: "u1", datos: { tipo: "gasto", monto: 5, fecha: "2026-11-07", categoria_id: 2, nota: null } });
    abrir();
    expect(await screen.findByTestId("aviso-pendientes-reportes")).toHaveTextContent("Hay 1 cambio sin enviar: el resumen los incluye");
  });

  it("sin pendientes no hay aviso", async () => {
    abrir();
    await screen.findByRole("heading", { name: "Resumen" });
    expect(screen.queryByTestId("aviso-pendientes-reportes")).not.toBeInTheDocument();
  });
});
