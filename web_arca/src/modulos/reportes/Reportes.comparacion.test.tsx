import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderPantalla } from "../../test/ayudas";
import * as api from "./api";
import PaginaReportes from "./PaginaReportes";

vi.mock("./api", () => ({ resumenPeriodo: vi.fn(), porCategoria: vi.fn(), porMiembro: vi.fn(), tendencia: vi.fn() }));
const A = vi.mocked(api);

const SIN_BASE = (diferencia = 0): api.Comparacion => ({ anterior: 0, diferencia, porcentaje: null });
const CON_BASE = (anterior: number, diferencia: number, porcentaje: number): api.Comparacion => ({ anterior, diferencia, porcentaje });

function montar(c: { ingresos: api.Comparacion; gastos: api.Comparacion; saldo: api.Comparacion }, categorias: api.PorCategoria["categorias"]) {
  A.resumenPeriodo.mockImplementation(async (r) => ({
    mes: r.desde.slice(0, 7), ...r,
    comparacion: { desde: "2026-10-01", hasta: "2026-10-31", etiqueta: "vs octubre 2026", ...c },
    ingresos: 1500, gastos: 200, apoyos_entregados: 0, devoluciones: 0, saldo: 1300, consumido: 0,
    gasto_familiar_total: 200, apoyos_pendientes_total: 0, apoyos_pendientes_cantidad: 0,
  }));
  A.porCategoria.mockImplementation(async (r) => ({
    mes: r.desde.slice(0, 7), ...r, total_gastos: 200, apoyos_consumidos: 0, comparacion: c.gastos,
    periodo_anterior: { desde: "2026-10-01", hasta: "2026-10-31", etiqueta: "vs octubre 2026" }, categorias,
  }));
}
const CATEGORIAS = (cA: api.Comparacion, cB: api.Comparacion): api.PorCategoria["categorias"] => [
  { categoria_id: 2, categoria: "Comida", icono: "utensils", total: 150, porcentaje: 75, comparacion: cA },
  { categoria_id: 1, categoria: "Transporte", icono: "bus", total: 50, porcentaje: 25, comparacion: cB },
];
const abrir = () => renderPantalla(<PaginaReportes />, { ruta: "/reportes", hoy: "2026-11-08" });
const todasLasComparaciones = () => screen.queryAllByTestId(/^comparacion-/);

beforeEach(() => {
  A.porMiembro.mockResolvedValue({ mes: "2026-11", miembros: [] });
  A.tendencia.mockResolvedValue({ meses: [] });
});

describe("Reportes: periodo anterior vacio (sin base para comparar en ninguna parte)", () => {
  beforeEach(() => montar({ ingresos: SIN_BASE(1500), gastos: SIN_BASE(200), saldo: SIN_BASE(1300) }, CATEGORIAS(SIN_BASE(150), SIN_BASE(50))));

  it("sale UN solo mensaje, arriba del Resumen, y no se repite en cada tarjeta ni en cada categoria", async () => {
    abrir();
    const msg = await screen.findByTestId("sin-periodo-anterior");
    expect(msg).toHaveTextContent("Sin datos en el periodo anterior (octubre 2026) para comparar.");
    expect(document.body.textContent!.match(/Sin datos en el periodo anterior/g)).toHaveLength(1);
    // esta dentro de la tarjeta del Resumen, justo debajo de su titulo
    const resumen = screen.getByRole("heading", { name: "Resumen" }).closest(".rounded-tarjeta") as HTMLElement;
    expect(resumen).toContainElement(msg);
    expect(resumen.firstElementChild!.tagName).toBe("H2");
    expect(resumen.children[1]).toBe(msg);
  });

  it("no hay flecha ni '+Bs …' ni porcentajes, ni la seccion 'Comparado con el periodo anterior'", async () => {
    abrir();
    await screen.findByTestId("sin-periodo-anterior");
    expect(document.body.textContent).not.toMatch(/▲|▼|＝/);
    expect(document.body.textContent).not.toMatch(/\+Bs|Infinity|NaN/);
    expect(screen.queryByRole("heading", { name: "Comparado con el periodo anterior" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("periodo-anterior")).not.toBeInTheDocument();
    expect(todasLasComparaciones()).toHaveLength(0);
  });

  it("el resto del reporte sigue ahi: resumen con sus totales, categorias con su barra y porcentaje", async () => {
    abrir();
    await screen.findByTestId("sin-periodo-anterior");
    const resumen = screen.getByRole("heading", { name: "Resumen" }).closest(".rounded-tarjeta") as HTMLElement;
    expect(within(resumen).getByText("Ingresos").nextElementSibling).toHaveTextContent("Bs 1,500.00");
    expect(within(resumen).getByText("Gastos").nextElementSibling).toHaveTextContent("-Bs 200.00");
    expect(screen.getByText("Comida", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("(75%)")).toBeInTheDocument();
  });
});

describe("Reportes: con periodo anterior (las comparaciones quedan como estaban)", () => {
  beforeEach(() =>
    montar({ ingresos: CON_BASE(1000, 500, 50), gastos: CON_BASE(250, -50, -20), saldo: CON_BASE(750, 550, 73.3) }, CATEGORIAS(CON_BASE(100, 50, 50), CON_BASE(80, -30, -37.5))),
  );

  it("sin mensaje unico; seccion, flechas, porcentajes y diferencias en Bs como siempre", async () => {
    abrir();
    expect(await screen.findByTestId("comparacion-ingresos")).toHaveTextContent("▲ 50 % más que el periodo anterior");
    expect(screen.getByTestId("comparacion-ingresos")).toHaveTextContent("+Bs 500.00");
    expect(screen.getByTestId("comparacion-gastos")).toHaveTextContent("▼ 20 % menos que el periodo anterior");
    expect(screen.getByTestId("comparacion-gastos")).toHaveTextContent("-Bs 50.00");
    expect(screen.getByTestId("comparacion-saldo")).toHaveTextContent("▲");
    expect(screen.getByTestId("periodo-anterior")).toHaveTextContent("Comparado vs octubre 2026");
    expect(screen.getByRole("heading", { name: "Comparado con el periodo anterior" })).toBeInTheDocument();
    expect(screen.queryByTestId("sin-periodo-anterior")).not.toBeInTheDocument();
    expect(screen.getByTestId("comparacion-categoria-2")).toHaveTextContent("▲ 50 % más que el periodo anterior");
    expect(screen.getByTestId("comparacion-categoria-1")).toHaveTextContent("▼ 37.5 % menos que el periodo anterior");
  });
});

describe("Reportes: mezcla (algunas comparaciones con base y otras sin base)", () => {
  beforeEach(() => montar({ ingresos: CON_BASE(1000, 500, 50), gastos: SIN_BASE(200), saldo: CON_BASE(1000, 300, 30) }, CATEGORIAS(CON_BASE(100, 50, 50), SIN_BASE(50))));

  it("la que tiene base queda igual; la que no, dice 'Sin datos…' SIN flecha ni '+Bs' (el testid y el texto de siempre)", async () => {
    abrir();
    const gastos = await screen.findByTestId("comparacion-gastos");
    expect(gastos).toHaveTextContent("Sin datos en el periodo anterior para comparar");
    expect(gastos.textContent).not.toMatch(/▲|▼|＝|\+Bs|%/);
    expect(screen.getByTestId("comparacion-ingresos")).toHaveTextContent("▲ 50 % más que el periodo anterior");
    expect(screen.getByTestId("comparacion-ingresos")).toHaveTextContent("+Bs 500.00");
    // hay base en algun lado: no hay mensaje unico
    expect(screen.queryByTestId("sin-periodo-anterior")).not.toBeInTheDocument();
    // una categoria nueva (sin base) lo dice sin flecha; la otra mantiene su comparacion
    expect(screen.getByTestId("comparacion-categoria-1")).toHaveTextContent("Sin datos en el periodo anterior");
    expect(screen.getByTestId("comparacion-categoria-1").textContent).not.toMatch(/▲|▼|＝|\+Bs/);
    expect(screen.getByTestId("comparacion-categoria-2")).toHaveTextContent("▲ 50 % más que el periodo anterior");
  });

  it("el estilo es neutro (sin color de bueno/malo) cuando no hay base", async () => {
    abrir();
    const gastos = await screen.findByTestId("comparacion-gastos");
    expect(gastos.className).toMatch(/text-stone-600/);
    expect(gastos.className).not.toMatch(/text-arca|text-apoyo-texto/);
  });
});

describe("Reportes: leyenda de las barras de 'Ultimos 6 meses'", () => {
  const meses: api.MesTotal[] = [
    { mes: "2026-10", ingresos: 1000, gastos: 400, apoyos_entregados: 0, devoluciones: 0, consumido: 0, saldo: 600 },
    { mes: "2026-11", ingresos: 1500, gastos: 200, apoyos_entregados: 0, devoluciones: 0, consumido: 0, saldo: -123456.78 },
  ];
  beforeEach(() => {
    montar({ ingresos: CON_BASE(1000, 500, 50), gastos: CON_BASE(250, -50, -20), saldo: CON_BASE(750, 550, 73.3) }, CATEGORIAS(CON_BASE(100, 50, 50), CON_BASE(80, -30, -37.5)));
    A.tendencia.mockResolvedValue({ meses });
  });

  it("explica los tramos: gris gastos, naranja apoyos, verde lo que queda", async () => {
    abrir();
    const leyenda = await screen.findByTestId("leyenda-meses");
    expect(leyenda).toHaveAccessibleName("Leyenda de las barras");
    const items = within(leyenda).getAllByRole("listitem");
    expect(items.map((i) => i.textContent?.trim())).toEqual(["Gastos en efectivo", "Apoyos", "Te queda"]);
    expect(items[0].querySelector("span")!.className).toMatch(/bg-stone-500/);
    expect(items[1].querySelector("span")!.className).toMatch(/bg-apoyo/);
    expect(items[2].querySelector("span")!.className).toMatch(/bg-arca/);
    items.forEach((i) => expect(i.querySelector("span")).toHaveAttribute("aria-hidden", "true")); // el muestrario es decorativo
  });

  it("los colores de la leyenda son los mismos de los tramos, y hay una sola barra por mes", async () => {
    abrir();
    const leyenda = await screen.findByTestId("leyenda-meses");
    const [gris, naranja, verde] = within(leyenda).getAllByRole("listitem").map((i) => i.querySelector("span")!.className);
    const fila = screen.getAllByTestId("fila-mes")[0];
    expect(fila.querySelectorAll(".h-2\\.5")).toHaveLength(1);
    expect(within(fila).getByRole("img", { name: "Gastos en efectivo Bs 400.00" }).className).toContain(gris.match(/bg-\S+/)![0]);
    expect(within(fila).getByRole("img", { name: "Te queda Bs 600.00" }).className).toContain(verde.match(/bg-\S+/)![0]);
    expect(naranja).toContain("bg-apoyo");
  });

  const tramos = (f: HTMLElement) => within(f).getAllByRole("img").map((t) => [t.getAttribute("aria-label"), t.style.width]);

  it("saldo positivo: gris + naranja + verde suman ingresos + devoluciones, en una escala comun", async () => {
    A.tendencia.mockResolvedValue({ meses: [
      { mes: "2026-08", ingresos: 1000, gastos: 300, apoyos_entregados: 200, devoluciones: 0, consumido: 0, saldo: 500 },
      { mes: "2026-09", ingresos: 1600, gastos: 800, apoyos_entregados: 200, devoluciones: 400, consumido: 0, saldo: 1000 },
    ] });
    abrir();
    await screen.findByTestId("leyenda-meses");
    const [ago, sep] = screen.getAllByTestId("fila-mes");
    // max = 1600 + 400 = 2000 (si no sumara devoluciones seria 1600)
    expect(tramos(ago)).toEqual([["Gastos en efectivo Bs 300.00", "15%"], ["Apoyos Bs 200.00", "10%"], ["Te queda Bs 500.00", "25%"]]);
    expect(tramos(sep)).toEqual([["Gastos en efectivo Bs 800.00", "40%"], ["Apoyos Bs 200.00", "10%"], ["Te queda Bs 1,000.00", "50%"]]);
    const pista = within(ago).getByRole("img", { name: "Gastos en efectivo Bs 300.00" }).parentElement!;
    expect(within(pista).getAllByRole("img")).toHaveLength(3); // una sola pista
    expect(within(ago).getByRole("img", { name: "Te queda Bs 500.00" })).toHaveAttribute("title", "Te queda Bs 500.00");
  });

  const NEGATIVO_Y_CERO: api.MesTotal[] = [
    { mes: "2026-10", ingresos: 500, gastos: 600, apoyos_entregados: 400, devoluciones: 0, consumido: 0, saldo: -500 },
    { mes: "2026-11", ingresos: 0, gastos: 0, apoyos_entregados: 0, devoluciones: 0, consumido: 0, saldo: 0 },
  ];

  it("saldo negativo: solo gris + naranja (sin verde), largo = gastos + apoyos, y el saldo en rojo", async () => {
    A.tendencia.mockResolvedValue({ meses: NEGATIVO_Y_CERO });
    abrir();
    await screen.findByTestId("leyenda-meses");
    const [oct] = screen.getAllByTestId("fila-mes");
    expect(tramos(oct)).toEqual([["Gastos en efectivo Bs 600.00", "60%"], ["Apoyos Bs 400.00", "40%"]]);
    expect(within(oct).queryByRole("img", { name: /^Te queda/ })).not.toBeInTheDocument();
    expect(within(oct).getByText("Te queda -Bs 500.00").className).toMatch(/text-red-700/);
  });

  it("mes en 0: tira minima gris de 2 %, sin naranja ni verde", async () => {
    A.tendencia.mockResolvedValue({ meses: NEGATIVO_Y_CERO });
    abrir();
    await screen.findByTestId("leyenda-meses");
    const [, nov] = screen.getAllByTestId("fila-mes");
    expect(tramos(nov)).toEqual([["Gastos en efectivo Bs 0.00", "2%"]]);
    expect(nov.querySelector(".bg-apoyo, .bg-arca")).toBeNull();
  });

  it("la leyenda esta dentro de la tarjeta de los 6 meses, antes de las barras", async () => {
    abrir();
    const leyenda = await screen.findByTestId("leyenda-meses");
    const tarjeta = screen.getByRole("heading", { name: "Últimos 6 meses" }).closest(".rounded-tarjeta") as HTMLElement;
    expect(tarjeta).toContainElement(leyenda);
    expect(leyenda.compareDocumentPosition(screen.getAllByTestId("fila-mes")[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("la etiqueta del mes y el saldo no se solapan ni se parten aunque el saldo sea largo (gap y nowrap)", async () => {
    abrir();
    await screen.findByTestId("leyenda-meses");
    const fila = screen.getAllByTestId("fila-mes")[1];
    const cabecera = fila.firstElementChild as HTMLElement;
    expect(cabecera.className).toMatch(/justify-between/);
    expect(cabecera.className).toMatch(/gap-3/);
    const [mes, saldo] = Array.from(cabecera.children) as HTMLElement[];
    expect(mes).toHaveTextContent("nov 2026"); // (la mayuscula es del estilo `capitalize`)
    expect(mes.className).toMatch(/whitespace-nowrap/);
    expect(saldo).toHaveTextContent("Te queda -Bs 123,456.78");
    expect(saldo.className).toMatch(/whitespace-nowrap/);
  });

  it("el texto y los demas datos de cada mes no cambian", async () => {
    abrir();
    await screen.findByTestId("leyenda-meses");
    const filas = screen.getAllByTestId("fila-mes");
    expect(filas).toHaveLength(2);
    expect(filas[0]).toHaveTextContent("Ingresos Bs 1,000.00 · Gastos Bs 400.00");
  });
});
