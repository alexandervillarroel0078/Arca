import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { admin, apoyoDe, renderPantalla } from "../../test/ayudas";
import type { Yo } from "../auth/api";
import * as hist from "../historial/api";
import * as api from "./api";
import PaginaApoyos from "./PaginaApoyos";

const sesion = vi.hoisted(() => ({ usuario: null as Yo | null }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => sesion }));
vi.mock("../historial/api", () => ({ cadenaHistorial: vi.fn() }));
vi.mock("./api", () => ({
  resumenApoyos: vi.fn(), listarApoyos: vi.fn(), devolverApoyo: vi.fn(), consumirApoyo: vi.fn(), reabrirApoyo: vi.fn(),
  anularApoyo: vi.fn(), reactivarApoyo: vi.fn(), editarDevolucion: vi.fn(), anularDevolucion: vi.fn(), reactivarDevolucion: vi.fn(),
}));
const A = vi.mocked(api);

function abrir(b: Partial<api.Beneficiario> = {}) {
  const ben = {
    beneficiario: "Hermano Luis", entregado: 150, devuelto: 0, consumido: 0, pendiente: 150, estado: "Pendiente" as const,
    cantidad_apoyos: 1, entregado_periodo: 150, devuelto_periodo: 0, ...b,
  };
  A.resumenApoyos.mockResolvedValue({
    total_entregado: 150, total_devuelto: 0, total_consumido: 0, total_pendiente: 150, total_entregado_periodo: 150, total_devuelto_periodo: 0,
    beneficiarios: [ben],
  });
  A.listarApoyos.mockResolvedValue([apoyoDe({ id: 1, beneficiario: "Hermano Luis", monto: 150, fecha: "2026-11-02", pendiente: 150 })]);
  sesion.usuario = admin;
  return renderPantalla(<PaginaApoyos />, { ruta: "/apoyos", hoy: "2026-11-08" });
}
beforeEach(() => vi.mocked(hist.cadenaHistorial).mockResolvedValue({ items: [], total: 0, hay_mas: false }));

describe("Apoyos: los montos de la tarjeta no se parten en dos lineas", () => {
  it("'entregado Bs 150.00' y 'devuelto Bs 0.00' van juntos (whitespace-nowrap) y el texto es el de siempre", async () => {
    abrir();
    const linea = await screen.findByTestId("en-el-periodo");
    expect(linea).toHaveTextContent("En el periodo: entregado Bs 150.00 · devuelto Bs 0.00");
    const juntos = Array.from(linea.querySelectorAll("span.whitespace-nowrap")).map((e) => e.textContent);
    expect(juntos).toEqual(["entregado Bs 150.00", "devuelto Bs 0.00"]);
  });

  it("tambien 'entregado Bs …' de la linea de arriba", async () => {
    abrir({ cantidad_apoyos: 2, entregado: 1245.5 });
    const t = (await screen.findByRole("heading", { name: "Hermano Luis" })).closest(".rounded-tarjeta") as HTMLElement;
    expect(within(t).getByText("entregado Bs 1,245.50").className).toMatch(/whitespace-nowrap/);
    expect(t).toHaveTextContent("2 apoyos · entregado Bs 1,245.50");
  });

  it("la informacion del periodo va a TODO el ancho de la tarjeta, debajo del nombre y el estado (no en la columna angosta)", async () => {
    abrir();
    const linea = await screen.findByTestId("en-el-periodo");
    const encabezado = screen.getByRole("heading", { name: "Hermano Luis" }).parentElement!;
    expect(encabezado.className).toMatch(/flex/);
    expect(encabezado).not.toContainElement(linea); // ya no comparte fila con el estado
    expect(within(encabezado).getByText("Pendiente")).toBeInTheDocument();
  });

  it("sin movimientos en el periodo el texto es el de siempre", async () => {
    abrir({ entregado_periodo: 0, devuelto_periodo: 0 });
    expect(await screen.findByTestId("en-el-periodo")).toHaveTextContent("Sin entregas ni devoluciones en este periodo");
  });
});

describe("Apoyos: barra inferior de la tarjeta con la etiqueta arriba y el monto abajo", () => {
  it("cada columna apila 'Devuelto', 'Consumido' y 'Pendiente' sobre su monto, sin partir el monto", async () => {
    abrir({ entregado: 1245.5, devuelto: 200, consumido: 0, pendiente: 1045.5, devuelto_periodo: 200 });
    const barra = (await screen.findByRole("progressbar")).nextElementSibling as HTMLElement;
    expect(barra.className).toMatch(/grid-cols-3/);
    const columnas = Array.from(barra.children) as HTMLElement[];
    expect(columnas).toHaveLength(3);
    for (const col of columnas) {
      const monto = col.querySelector("span.block") as HTMLElement;
      expect(monto.className).toMatch(/whitespace-nowrap/); // el monto es un bloque propio: queda debajo de la etiqueta y no se parte
      expect(monto.textContent).toMatch(/^Bs [\d,]+\.\d{2}$/);
    }
    expect(columnas.map((c) => c.firstChild!.textContent)).toEqual(["Devuelto", "Consumido", "Pendiente"]);
    expect(columnas.map((c) => c.querySelector("span.block")!.textContent)).toEqual(["Bs 200.00", "Bs 0.00", "Bs 1,045.50"]);
  });

  it("el texto de cada columna sigue siendo 'Devuelto Bs 200.00', 'Consumido Bs 0.00' y 'Pendiente Bs 1,045.50' (mismos textos)", async () => {
    abrir({ entregado: 1245.5, devuelto: 200, consumido: 0, pendiente: 1045.5 });
    const barra = (await screen.findByRole("progressbar")).nextElementSibling as HTMLElement;
    expect(barra).toHaveTextContent("Devuelto Bs 200.00");
    expect(barra).toHaveTextContent("Consumido Bs 0.00");
    expect(barra).toHaveTextContent("Pendiente Bs 1,045.50");
    expect(barra.textContent).toBe("Devuelto Bs 200.00Consumido Bs 0.00Pendiente Bs 1,045.50");
  });

  it("alineadas como antes: izquierda, centro y derecha; la de pendiente en destacado", async () => {
    abrir();
    const barra = (await screen.findByRole("progressbar")).nextElementSibling as HTMLElement;
    const [a, b, c] = Array.from(barra.children) as HTMLElement[];
    expect(a.className).not.toMatch(/text-center|text-right/);
    expect(b.className).toMatch(/text-center/);
    expect(c.className).toMatch(/text-right/);
    expect(c.className).toMatch(/font-semibold/);
  });

  it("un monto grande va igual en su propio bloque sin partir (el ancho real se comprueba en las capturas a 390 px)", async () => {
    abrir({ entregado: 123456.78, devuelto: 0, consumido: 0, pendiente: 123456.78 });
    const barra = (await screen.findByRole("progressbar")).nextElementSibling as HTMLElement;
    const monto = barra.lastElementChild!.querySelector("span.block") as HTMLElement;
    expect(monto).toHaveTextContent("Bs 123,456.78");
    expect(monto.className).toMatch(/whitespace-nowrap/);
  });
});
