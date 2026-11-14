// Cambiar la fecha de un movimiento de Cuentas: solo en movimientos activos que no son ajustes, y el diálogo envía la fecha.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorApi } from "../../core/api";
import { hoyISO } from "../../core/formato";
import { admin, renderPantalla } from "../../test/ayudas";
import { cuentaDe, mov } from "../../test/cuentas";
import type { Yo } from "../auth/api";
import { lineasDeCambios } from "../historial/EntradaHistorialVista";
import type { EntradaHistorial } from "../historial/api";
import * as api from "./api";
import { FilaMovimiento } from "./componentes";
import { errorDeFecha } from "./DialogoFecha";
import PaginaCuentaDetalle from "./PaginaCuentaDetalle";
import { puedeCambiarFecha } from "./permisos";

vi.mock("./api");
const sesion = vi.hoisted(() => ({ usuario: null as Yo | null, salir: vi.fn(), actualizarUsuario: vi.fn() }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => sesion, useUsuarioOpcional: () => sesion.usuario }));
vi.mock("../historial/DialogoHistorial", () => ({ default: () => <div data-testid="dialogo-historial" /> }));

const m = vi.mocked(api);
beforeEach(() => {
  sesion.usuario = admin;
  m.obtenerCuenta.mockReset().mockResolvedValue(cuentaDe());
  m.listarMovimientosCuentas.mockReset().mockResolvedValue([]);
  m.cambiarFechaMovimientoCuenta.mockReset();
});

const ESPIA = () => {};
/** Monta la fila con todas las acciones y abre su menu "…". */
async function fila(x: api.MovimientoCuenta) {
  render(<ul><FilaMovimiento m={x} cuentaRef={1} alHistorial={ESPIA} alCambiarFecha={ESPIA} alAnular={ESPIA} alReactivar={ESPIA} /></ul>);
  await userEvent.click(screen.getByRole("button", { name: /^Acciones de / }));
}
const item = (nombre: string) => screen.queryByRole("menuitem", { name: nombre });

describe("«Cambiar fecha» solo en movimientos activos que no son ajustes", () => {
  it.each([
    ["depósito", mov({ tipo: "deposito" })],
    ["retiro", mov({ tipo: "retiro", efecto: "-10.00" })],
    ["traspaso", mov({ tipo: "traspaso", cuenta_destino_id: 2, cuenta_destino_nombre: "Otra", efecto: "-10.00" })],
  ])("aparece en un %s activo", async (_n, x) => {
    await fila(x);
    expect(item("Cambiar fecha")).toBeInTheDocument();
  });

  it("no aparece en un ajuste por conteo", async () => {
    await fila(mov({ tipo: "ajuste", sentido: "entrada", saldo_declarado: "10.00", saldo_previo: "0.00" }));
    expect(item("Cambiar fecha")).not.toBeInTheDocument();
    expect(item("Anular")).toBeInTheDocument(); // anular sí
  });

  it("no aparece en un movimiento anulado (ahí está Reactivar en vez de Anular)", async () => {
    await fila(mov({ anulado: true }));
    expect(item("Cambiar fecha")).not.toBeInTheDocument();
    expect(item("Anular")).not.toBeInTheDocument();
    expect(item("Reactivar")).toBeInTheDocument();
  });

  it("no aparece si la API dice que no puedes registrar", async () => {
    await fila(mov({ puede_registrar: false }));
    expect(item("Cambiar fecha")).not.toBeInTheDocument();
    expect(item("Historial")).toBeInTheDocument();
  });

  it("regla pura", () => {
    expect(puedeCambiarFecha({ puede_registrar: true, anulado: false, tipo: "deposito" })).toBe(true);
    expect(puedeCambiarFecha({ puede_registrar: true, anulado: false, tipo: "ajuste" })).toBe(false);
    expect(puedeCambiarFecha({ puede_registrar: true, anulado: true, tipo: "retiro" })).toBe(false);
    expect(puedeCambiarFecha({ puede_registrar: false, anulado: false, tipo: "traspaso" })).toBe(false);
  });
});

describe("Diálogo de fecha", () => {
  const x = mov({ id: 7, fecha: "2026-11-03", version: 3 });
  const abrir = async () => {
    m.listarMovimientosCuentas.mockResolvedValue([x]);
    renderPantalla(<PaginaCuentaDetalle />, { ruta: "/cuentas/1", patron: "/cuentas/:id" });
    await userEvent.click(await screen.findByRole("button", { name: /^Acciones de / }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Cambiar fecha" }));
    const dialogo = await screen.findByRole("dialog", { name: "Cambiar fecha" });
    return { dialogo, campo: within(dialogo).getByLabelText("Nueva fecha") as HTMLInputElement };
  };

  it("es accesible: título, campo con etiqueta, fecha actual y máximo = hoy", async () => {
    const { dialogo, campo } = await abrir();
    expect(dialogo).toHaveAttribute("aria-modal", "true");
    expect(campo).toHaveAttribute("type", "date");
    expect(campo).toHaveAttribute("max", hoyISO());
    expect(campo.value).toBe("2026-11-03");
    expect(within(dialogo).getByTestId("detalle-fecha")).toHaveTextContent("Depósito · Bs 10.00");
  });

  it("envía la nueva fecha, avisa y vuelve a pedir los datos", async () => {
    m.cambiarFechaMovimientoCuenta.mockResolvedValue({ ...x, fecha: "2026-11-01", version: 4 });
    const { dialogo, campo } = await abrir();
    const pedidas = m.obtenerCuenta.mock.calls.length;
    fireEvent.change(campo, { target: { value: "2026-11-01" } });
    await userEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));
    expect(m.cambiarFechaMovimientoCuenta).toHaveBeenCalledWith(expect.objectContaining({ id: 7, version: 3 }), "2026-11-01");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Fecha cambiada")).toBeInTheDocument();
    expect(m.obtenerCuenta.mock.calls.length).toBeGreaterThan(pedidas);
  });

  it("una fecha futura o la misma fecha no llaman al servidor", async () => {
    const { dialogo, campo } = await abrir();
    await userEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));
    expect(within(dialogo).getByRole("alert")).toHaveTextContent("Es la misma fecha");
    fireEvent.change(campo, { target: { value: "2999-01-01" } });
    expect(within(dialogo).getByRole("alert")).toHaveTextContent("posterior a hoy");
    expect(m.cambiarFechaMovimientoCuenta).not.toHaveBeenCalled();
  });

  it("409: cierra el diálogo, refresca la pantalla y avisa (useManejoError)", async () => {
    m.cambiarFechaMovimientoCuenta.mockRejectedValue(new ErrorApi(409, "El movimiento cambió mientras lo editabas"));
    const { dialogo, campo } = await abrir();
    const pedidas = m.obtenerCuenta.mock.calls.length;
    fireEvent.change(campo, { target: { value: "2026-11-01" } });
    await userEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText(/Se actualizó la pantalla con los datos del servidor/)).toBeInTheDocument();
    expect(m.obtenerCuenta.mock.calls.length).toBeGreaterThan(pedidas);
  });

  it("422 del servidor: el mensaje se ve en el diálogo, que sigue abierto", async () => {
    m.cambiarFechaMovimientoCuenta.mockRejectedValue(new ErrorApi(422, "La fecha no puede ser posterior a hoy"));
    const { dialogo, campo } = await abrir();
    fireEvent.change(campo, { target: { value: "2026-11-01" } });
    await userEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));
    expect(await within(dialogo).findByText("La fecha no puede ser posterior a hoy")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Cambiar fecha" })).toBeInTheDocument();
  });

  it("errorDeFecha", () => {
    expect(errorDeFecha("", "2026-11-03", "2026-11-14")).toBe("Elige una fecha");
    expect(errorDeFecha("2026-11-15", "2026-11-03", "2026-11-14")).toMatch(/posterior a hoy/);
    expect(errorDeFecha("2026-11-03", "2026-11-03", "2026-11-14")).toMatch(/misma fecha/);
    expect(errorDeFecha("2026-11-14", "2026-11-03", "2026-11-14")).toBeNull();
  });
});

describe("Historial: la corrección de fecha se lee bien", () => {
  it("«Fecha: 3 nov 2026 → 1 nov 2026» en una entrada editar de cuenta_mov", () => {
    const e = {
      id: 1, entidad: "cuenta_mov", entidad_id: 7, accion: "editar", usuario_nombre: "Ana", fecha: "2026-11-14T12:00:00Z",
      fecha_cliente: null, motivo: null, etiqueta: null, cambios: { fecha: { antes: "2026-11-03", despues: "2026-11-01" } },
    } as unknown as EntradaHistorial;
    expect(lineasDeCambios(e)).toEqual(["Fecha: 3 nov 2026 → 1 nov 2026"]);
  });
});
