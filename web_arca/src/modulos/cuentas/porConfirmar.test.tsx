// Bandeja "Por confirmar", mensaje de la confirmación, filas vinculadas de solo lectura y saldo que ignora lo no confirmado.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderPantalla } from "../../test/ayudas";
import { mov } from "../../test/cuentas";
import * as api from "./api";
import BandejaPorConfirmar, { mensajeConfirmar } from "./BandejaPorConfirmar";
import { accionesMovimiento, FilaMovimiento } from "./componentes";
import { puedeCambiarFecha } from "./permisos";
import { resumenMes } from "./resumen";

vi.mock("./api");
const m = vi.mocked(api);

const PENDIENTE = mov({
  id: 30, tipo: "retiro", monto: "100.00", fecha: "2026-11-15", hora: null, cuenta_nombre: "BNB", usuario_nombre: "Beto",
  efecto: "-100.00", puede_registrar: false, estado: "pendiente", vinculado: true, origen_tipo: "gasto", origen_id: 12,
  origen_clase: "movimiento", origen_detalle: "Comida", puede_confirmar: true, confirma_nombre: "Ana", version: 2,
});

beforeEach(() => {
  m.listarPorConfirmar.mockReset().mockResolvedValue([PENDIENTE]);
  m.confirmarPago.mockReset().mockResolvedValue({ ...PENDIENTE, estado: "confirmado" });
  m.rechazarPago.mockReset().mockResolvedValue({ ...PENDIENTE, estado: "rechazado" });
  m.resumenPorConfirmar.mockReset().mockResolvedValue({ cantidad: 0, rechazos: [] });
});

describe("Bandeja «Por confirmar»", () => {
  it("lista los pagos con su origen, enlace al gasto y botones; confirmar avisa el cambio de día", async () => {
    const u = userEvent.setup();
    const alCambiar = vi.fn();
    renderPantalla(<BandejaPorConfirmar alCambiar={alCambiar} />, { ruta: "/cuentas" });
    const fila = await screen.findByTestId("fila-por-confirmar");
    expect(screen.getByRole("heading", { name: /Por confirmar/ })).toBeInTheDocument();
    expect(fila).toHaveTextContent("Gasto · Comida");
    expect(fila).toHaveTextContent("de Beto");
    expect(fila).toHaveTextContent("-Bs 100.00");
    expect(within(fila).getByRole("link", { name: "Ver gasto" })).toHaveAttribute("href", "/editar/movimiento/12");
    await u.click(within(fila).getByRole("button", { name: "Confirmar" }));
    const dialogo = screen.getByRole("dialog", { name: "Confirmar pago" });
    expect(dialogo).toHaveTextContent("con la fecha y hora de ahora");
    await u.click(within(dialogo).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(m.confirmarPago).toHaveBeenCalledWith(PENDIENTE));
    await waitFor(() => expect(alCambiar).toHaveBeenCalled());
    expect(m.resumenPorConfirmar).toHaveBeenCalled(); // el contador del menu se actualiza
  });

  it("rechazar pide un motivo opcional y explica que el gasto pasa a Efectivo", async () => {
    const u = userEvent.setup();
    renderPantalla(<BandejaPorConfirmar alCambiar={vi.fn()} />, { ruta: "/cuentas" });
    await u.click(within(await screen.findByTestId("fila-por-confirmar")).getByRole("button", { name: "Rechazar" }));
    const dialogo = screen.getByRole("dialog", { name: "Rechazar pago" });
    expect(dialogo).toHaveTextContent("no se anula: pasa a Efectivo");
    await u.type(within(dialogo).getByRole("textbox"), "No es de esta cuenta");
    await u.click(within(dialogo).getByRole("button", { name: "Rechazar" }));
    await waitFor(() => expect(m.rechazarPago).toHaveBeenCalledWith(PENDIENTE, "No es de esta cuenta"));
  });

  it("sin pendientes no se dibuja", async () => {
    m.listarPorConfirmar.mockResolvedValue([]);
    renderPantalla(<BandejaPorConfirmar alCambiar={vi.fn()} />, { ruta: "/cuentas" });
    await waitFor(() => expect(m.listarPorConfirmar).toHaveBeenCalled());
    expect(screen.queryByTestId("bandeja-por-confirmar")).not.toBeInTheDocument();
  });
});

describe("Mensaje al confirmar", () => {
  const ahora = { fecha: "2026-11-21", hora: "14:30" };
  it("mismo día: solo la fecha y hora de ahora", () => {
    expect(mensajeConfirmar({ ...PENDIENTE, fecha: "2026-11-21" }, ahora)).toBe(
      "Se descontarán Bs 100.00 de BNB con la fecha y hora de ahora (hoy 14:30).",
    );
  });
  it("otro día: lo dice; otro mes: tambien el mes", () => {
    expect(mensajeConfirmar(PENDIENTE, ahora)).toMatch(/El gasto es del .*15.*: en Cuentas quedará hoy\.$/);
    expect(mensajeConfirmar({ ...PENDIENTE, fecha: "2026-10-30" }, ahora)).toMatch(/quedará hoy, en noviembre 2026\.$/i);
    expect(mensajeConfirmar({ ...PENDIENTE, tipo: "deposito", origen_tipo: "ingreso" }, ahora)).toMatch(/^Se sumarán Bs 100.00 a BNB/);
  });
});

describe("Filas vinculadas en Cuentas", () => {
  it("son de solo lectura, dicen que no suman y enlazan al registro (si lo ves)", () => {
    render(<ul><FilaMovimiento m={PENDIENTE} cuentaRef={1} alHistorial={vi.fn()} alAnular={vi.fn()} alCambiarFecha={vi.fn()} /></ul>, {
      wrapper: ({ children }) => <MemoryRouterSimple>{children}</MemoryRouterSimple>,
    });
    const fila = screen.getByTestId("fila-movimiento");
    expect(fila).toHaveAttribute("data-estado", "pendiente");
    expect(fila).toHaveTextContent("Retiro · Gasto");
    expect(screen.getByTestId("estado-pago")).toHaveTextContent("Por confirmar por Ana · no suma al saldo");
    expect(fila).toHaveTextContent("solo lectura");
    expect(within(fila).getByRole("link", { name: "Ver gasto" })).toBeInTheDocument();
    expect(accionesMovimiento(PENDIENTE, { alHistorial: vi.fn(), alAnular: vi.fn(), alCambiarFecha: vi.fn() }).map((a) => a.texto)).toEqual(["Historial"]);
    expect(puedeCambiarFecha({ ...PENDIENTE, puede_registrar: true })).toBe(false);
  });

  it("sin ver el gasto: no hay enlace ni categoría", () => {
    const oculto = { ...PENDIENTE, origen_id: null, origen_clase: null, origen_detalle: null };
    render(<ul><FilaMovimiento m={oculto} /></ul>, { wrapper: ({ children }) => <MemoryRouterSimple>{children}</MemoryRouterSimple> });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByTestId("detalle-movimiento")).not.toHaveTextContent("Comida");
  });

  it("el resumen del mes no suma lo pendiente ni lo rechazado", () => {
    const r = resumenMes([
      mov({ tipo: "retiro", efecto: "-100.00", estado: "pendiente" }),
      mov({ tipo: "retiro", efecto: "-40.00", estado: "rechazado" }),
      mov({ tipo: "retiro", efecto: "-5.00", estado: "confirmado" }),
      mov({ tipo: "retiro", efecto: "-1.00" }), // sin dato = confirmado
    ]);
    expect(r.salio).toBe(600000000n); // 6.00 con 8 decimales
  });
});

function MemoryRouterSimple({ children }: { children: ReactNode }) {
  return <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{children}</MemoryRouter>;
}
