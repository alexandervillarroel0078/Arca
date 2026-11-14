// Fila de movimiento de Cuentas en una línea: columnas, segunda línea solo con datos, menu "…" con las reglas de siempre.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { admin, renderPantalla } from "../../test/ayudas";
import { cuentaDe, mov } from "../../test/cuentas";
import type { Yo } from "../auth/api";
import * as api from "./api";
import { CabeceraMovimientos, FilaMovimiento } from "./componentes";
import PaginaCuentas from "./PaginaCuentas";

vi.mock("./api");
const sesion = vi.hoisted(() => ({ usuario: null as Yo | null, salir: vi.fn(), actualizarUsuario: vi.fn() }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => sesion, useUsuarioOpcional: () => sesion.usuario }));

const m = vi.mocked(api);
beforeEach(() => {
  sesion.usuario = admin;
});

const ESPIA = () => {};
const conAcciones = (x: api.MovimientoCuenta) =>
  render(<ul><FilaMovimiento m={x} cuentaRef={1} alHistorial={ESPIA} alCambiarFecha={ESPIA} alAnular={ESPIA} alReactivar={ESPIA} /></ul>);
const sinAcciones = (x: api.MovimientoCuenta) => render(<ul><FilaMovimiento m={x} /></ul>);
const fila = () => screen.getByTestId("fila-movimiento");
const detalle = () => screen.queryByTestId("detalle-movimiento");
async function textosDelMenu() {
  await userEvent.click(screen.getByRole("button", { name: /^Acciones de / }));
  return within(screen.getByRole("menu")).getAllByRole("menuitem").map((i) => i.textContent);
}

describe("Una línea: fecha, tipo y monto", () => {
  it("«Sin identificar» ya no aparece y, sin nada más que mostrar, no hay segunda línea", () => {
    conAcciones(mov({ persona_tipo: "sin_identificar", fecha: "2026-11-03" }));
    expect(fila()).not.toHaveTextContent("Sin identificar");
    expect(detalle()).not.toBeInTheDocument();
    expect(fila()).toHaveTextContent("3 nov");
    expect(fila()).toHaveTextContent("Depósito");
    expect(fila()).toHaveTextContent("+Bs 10.00");
  });

  it("no hay botones de texto sueltos: solo el «…» del menu", () => {
    conAcciones(mov());
    expect(within(fila()).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Acciones de Depósito"]);
  });

  it("segunda línea solo con datos: persona identificada, comisión, nota", () => {
    conAcciones(mov({ tipo: "retiro", efecto: "-12.00", comision: "2.00", persona_tipo: "otra", persona_nombre: "Tía Rosa", nota: "Pasajes" }));
    expect(detalle()).toHaveTextContent("Tía Rosa · comisión Bs 2.00 · Pasajes");
  });

  it("ajuste: «saldo contado» en la segunda línea", () => {
    conAcciones(mov({ tipo: "ajuste", sentido: "salida", efecto: "-3.00", saldo_declarado: "7.00", saldo_previo: "10.00" }));
    expect(fila()).toHaveTextContent("Ajuste por conteo");
    expect(detalle()).toHaveTextContent("saldo contado Bs 7.00");
  });

  it("traspaso: «Traspaso a X» o «Traspaso desde X» según la cuenta que se ve", () => {
    const t = { tipo: "traspaso" as const, cuenta_id: 1, cuenta_nombre: "Caja", cuenta_destino_id: 2, cuenta_destino_nombre: "Ahorro" };
    const { unmount } = conAcciones(mov({ ...t, efecto: "-5.00" }));
    expect(fila()).toHaveTextContent("Traspaso a Ahorro");
    unmount();
    render(<ul><FilaMovimiento m={mov({ ...t, efecto: "5.00" })} cuentaRef={2} /></ul>);
    expect(fila()).toHaveTextContent("Traspaso desde Caja");
  });

  it("anulado: tachado y atenuado, con «Anulado · motivo» en la segunda línea", () => {
    conAcciones(mov({ anulado: true, motivo_anulacion: "Duplicado", nota: "Venta" }));
    expect(fila()).toHaveAttribute("data-anulado", "true");
    expect(within(fila()).getByText("Depósito")).toHaveClass("line-through");
    expect(within(fila()).getByText("+Bs 10.00")).toHaveClass("line-through");
    expect(detalle()).toHaveTextContent("Anulado · Duplicado · Venta");
  });

  it("tipo largo con monto grande: el tipo se trunca con «…» (marcado a propósito) y el monto nunca se parte", () => {
    const largo = "Cuenta de ahorros familiar para emergencias del hogar";
    conAcciones(mov({ tipo: "traspaso", cuenta_destino_id: 2, cuenta_destino_nombre: largo, monto: "1234567.89", efecto: "-1234567.89" }));
    const titulo = within(fila()).getByText(`Traspaso a ${largo}`);
    expect(titulo).toHaveClass("truncate", "min-w-0", "flex-1");
    expect(titulo).toHaveAttribute("data-truncado", "a-proposito");
    expect(titulo).toHaveAttribute("title", `Traspaso a ${largo}`); // el texto completo sigue disponible
    const monto = within(fila()).getByText("-Bs 1,234,567.89");
    expect(monto).toHaveClass("shrink-0", "whitespace-nowrap");
  });

  it("la cabecera de columnas es solo visual", () => {
    render(<CabeceraMovimientos conMenu />);
    const cabecera = screen.getByTestId("cabecera-movimientos");
    expect(cabecera).toHaveAttribute("aria-hidden", "true");
    expect(cabecera).toHaveTextContent("FechaMovimientoMonto");
  });
});

describe("Menu «…»: las mismas reglas de siempre", () => {
  it("movimiento activo con permiso: Historial, Cambiar fecha y Anular (en ese orden)", async () => {
    conAcciones(mov());
    expect(await textosDelMenu()).toEqual(["Historial", "Cambiar fecha", "Anular"]);
  });

  it("anulado: Historial y Reactivar", async () => {
    conAcciones(mov({ anulado: true }));
    expect(await textosDelMenu()).toEqual(["Historial", "Reactivar"]);
  });

  it("ajuste: sin Cambiar fecha", async () => {
    conAcciones(mov({ tipo: "ajuste", sentido: "entrada", saldo_declarado: "10.00", saldo_previo: "0.00" }));
    expect(await textosDelMenu()).toEqual(["Historial", "Anular"]);
  });

  it("traspaso sin permiso en ambas cuentas: solo Historial", async () => {
    conAcciones(mov({ tipo: "traspaso", cuenta_destino_id: 2, cuenta_destino_nombre: "Otra", puede_registrar: false }));
    expect(await textosDelMenu()).toEqual(["Historial"]);
  });

  it("cada acción llama a su manejador con el movimiento", async () => {
    const h = { alHistorial: vi.fn(), alCambiarFecha: vi.fn(), alAnular: vi.fn() };
    const x = mov({ id: 9 });
    render(<ul><FilaMovimiento m={x} cuentaRef={1} {...h} /></ul>);
    for (const [nombre, fn] of [["Historial", h.alHistorial], ["Cambiar fecha", h.alCambiarFecha], ["Anular", h.alAnular]] as const) {
      await userEvent.click(screen.getByRole("button", { name: /^Acciones de / }));
      await userEvent.click(screen.getByRole("menuitem", { name: nombre }));
      expect(fn).toHaveBeenCalledWith(x);
    }
  });
});

describe("Lista global (sin acciones)", () => {
  it("misma fila compacta, sin menu, con el nombre de la cuenta en la segunda línea", () => {
    sinAcciones(mov({ cuenta_nombre: "Caja chica", efecto: null, monto: "25.00" }));
    expect(within(fila()).queryByRole("button")).not.toBeInTheDocument();
    expect(detalle()).toHaveTextContent("Caja chica");
    expect(fila()).toHaveTextContent("Bs 25.00"); // sin efecto: el monto sin signo, como antes
  });

  it("en «Últimos movimientos» de Cuentas", async () => {
    m.listarCuentas.mockResolvedValue({ cuentas: [cuentaDe()], totales: [], privadas_propias: 0 });
    m.listarMovimientosCuentas.mockResolvedValue([mov({ cuenta_nombre: "Caja chica", efecto: null })]);
    renderPantalla(<PaginaCuentas />, { ruta: "/cuentas" });
    const lista = await screen.findByRole("list", { name: "Últimos movimientos" });
    const f = within(lista).getByTestId("fila-movimiento");
    expect(within(f).getByTestId("detalle-movimiento")).toHaveTextContent("Caja chica");
    expect(within(f).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByTestId("cabecera-movimientos")).toHaveAttribute("aria-hidden", "true");
  });
});
