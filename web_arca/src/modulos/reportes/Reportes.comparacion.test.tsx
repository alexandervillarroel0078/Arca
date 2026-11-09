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

  it("explica que la barra verde es de ingresos y la gris de gastos", async () => {
    abrir();
    const leyenda = await screen.findByTestId("leyenda-meses");
    expect(leyenda).toHaveAccessibleName("Leyenda de las barras");
    const items = within(leyenda).getAllByRole("listitem");
    expect(items.map((i) => i.textContent?.trim())).toEqual(["Ingresos", "Gastos"]);
    expect(items[0].querySelector("span")!.className).toMatch(/bg-arca/);
    expect(items[1].querySelector("span")!.className).toMatch(/bg-stone-500/);
    expect(items[0].querySelector("span")).toHaveAttribute("aria-hidden", "true"); // el muestrario es decorativo: el texto lo dice
  });

  it("los colores de la leyenda son los mismos de las barras (ingresos primero, verde; gastos despues, gris)", async () => {
    abrir();
    const leyenda = await screen.findByTestId("leyenda-meses");
    const [verde, gris] = within(leyenda).getAllByRole("listitem").map((i) => i.querySelector("span")!.className);
    const fila = screen.getAllByTestId("fila-mes")[0];
    const barras = Array.from(fila.querySelectorAll(".h-2\\.5 > div")).map((b) => b.className);
    expect(barras[0]).toContain("bg-arca");
    expect(barras[1]).toContain("bg-stone-500");
    expect(verde).toContain("bg-arca");
    expect(gris).toContain("bg-stone-500");
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
    expect(saldo).toHaveTextContent("Saldo -Bs 123,456.78");
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
