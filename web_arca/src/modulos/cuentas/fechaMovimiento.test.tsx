// Cambiar la fecha de un movimiento de Cuentas: solo en movimientos activos que no son ajustes, y el diálogo envía la fecha.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorApi } from "../../core/api";
import { hoyLaPazISO } from "../../core/formato";
import { admin, renderPantalla } from "../../test/ayudas";
import { cuentaDe, mov } from "../../test/cuentas";
import type { Yo } from "../auth/api";
import { lineasDeCambios } from "../historial/EntradaHistorialVista";
import type { EntradaHistorial } from "../historial/api";
import * as api from "./api";
import { FilaMovimiento } from "./componentes";
import { errorDeFecha, erroresCambio } from "./DialogoFecha";
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

describe("«Cambiar fecha y hora» solo en movimientos activos que no son ajustes", () => {
  it.each([
    ["depósito", mov({ tipo: "deposito" })],
    ["retiro", mov({ tipo: "retiro", efecto: "-10.00" })],
    ["traspaso", mov({ tipo: "traspaso", cuenta_destino_id: 2, cuenta_destino_nombre: "Otra", efecto: "-10.00" })],
  ])("aparece en un %s activo", async (_n, x) => {
    await fila(x);
    expect(item("Cambiar fecha y hora")).toBeInTheDocument();
  });

  it("no aparece en un ajuste por conteo", async () => {
    await fila(mov({ tipo: "ajuste", sentido: "entrada", saldo_declarado: "10.00", saldo_previo: "0.00" }));
    expect(item("Cambiar fecha y hora")).not.toBeInTheDocument();
    expect(item("Anular")).toBeInTheDocument(); // anular sí
  });

  it("no aparece en un movimiento anulado (ahí está Reactivar en vez de Anular)", async () => {
    await fila(mov({ anulado: true }));
    expect(item("Cambiar fecha y hora")).not.toBeInTheDocument();
    expect(item("Anular")).not.toBeInTheDocument();
    expect(item("Reactivar")).toBeInTheDocument();
  });

  it("no aparece si la API dice que no puedes registrar", async () => {
    await fila(mov({ puede_registrar: false }));
    expect(item("Cambiar fecha y hora")).not.toBeInTheDocument();
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
    await userEvent.click(screen.getByRole("menuitem", { name: "Cambiar fecha y hora" }));
    const dialogo = await screen.findByRole("dialog", { name: "Cambiar fecha y hora" });
    return { dialogo, campo: within(dialogo).getByLabelText("Nueva fecha") as HTMLInputElement };
  };

  it("es accesible: título, campo con etiqueta, fecha actual y máximo = hoy", async () => {
    const { dialogo, campo } = await abrir();
    expect(dialogo).toHaveAttribute("aria-modal", "true");
    expect(campo).toHaveAttribute("type", "date");
    expect(campo).toHaveAttribute("max", hoyLaPazISO());
    expect(campo.value).toBe("2026-11-03");
    expect(within(dialogo).getByTestId("detalle-fecha")).toHaveTextContent("Depósito · Bs 10.00");
  });

  it("envía la nueva fecha, avisa y vuelve a pedir los datos", async () => {
    m.cambiarFechaMovimientoCuenta.mockResolvedValue({ ...x, fecha: "2026-11-01", version: 4 });
    const { dialogo, campo } = await abrir();
    const pedidas = m.obtenerCuenta.mock.calls.length;
    fireEvent.change(campo, { target: { value: "2026-11-01" } });
    await userEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));
    expect(m.cambiarFechaMovimientoCuenta).toHaveBeenCalledWith(expect.objectContaining({ id: 7, version: 3 }), "2026-11-01", null);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Fecha y hora cambiadas")).toBeInTheDocument();
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
    expect(screen.getByRole("dialog", { name: "Cambiar fecha y hora" })).toBeInTheDocument();
  });

  it("muestra la hora actual en su campo y envía fecha y hora", async () => {
    const conHora = mov({ id: 7, fecha: "2026-11-03", hora: "09:05", version: 3 });
    m.listarMovimientosCuentas.mockResolvedValue([conHora]);
    m.cambiarFechaMovimientoCuenta.mockResolvedValue({ ...conHora, hora: "10:40", version: 4 });
    renderPantalla(<PaginaCuentaDetalle />, { ruta: "/cuentas/1", patron: "/cuentas/:id" });
    await userEvent.click(await screen.findByRole("button", { name: /^Acciones de / }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Cambiar fecha y hora" }));
    const dialogo = await screen.findByRole("dialog", { name: "Cambiar fecha y hora" });
    const hora = within(dialogo).getByLabelText("Hora (opcional)") as HTMLInputElement;
    expect(hora).toHaveAttribute("type", "time");
    expect(hora.value).toBe("09:05");
    expect(dialogo).toHaveTextContent("Fecha actual: 3 nov 09:05");
    fireEvent.change(hora, { target: { value: "10:40" } });
    await userEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));
    expect(m.cambiarFechaMovimientoCuenta).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), "2026-11-03", "10:40");
  });

  it("vaciar la hora la quita (envía null); un movimiento viejo dice «sin hora»", async () => {
    const conHora = mov({ id: 7, fecha: "2026-11-03", hora: "09:05", version: 3 });
    m.listarMovimientosCuentas.mockResolvedValue([conHora]);
    m.cambiarFechaMovimientoCuenta.mockResolvedValue({ ...conHora, hora: null, version: 4 });
    renderPantalla(<PaginaCuentaDetalle />, { ruta: "/cuentas/1", patron: "/cuentas/:id" });
    await userEvent.click(await screen.findByRole("button", { name: /^Acciones de / }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Cambiar fecha y hora" }));
    const dialogo = await screen.findByRole("dialog", { name: "Cambiar fecha y hora" });
    fireEvent.change(within(dialogo).getByLabelText("Hora (opcional)"), { target: { value: "" } });
    await userEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));
    expect(m.cambiarFechaMovimientoCuenta).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), "2026-11-03", null);
  });

  it("un movimiento sin hora: el campo de hora empieza vacío y la ayuda dice «sin hora»", async () => {
    const { dialogo } = await abrir();
    expect((within(dialogo).getByLabelText("Hora (opcional)") as HTMLInputElement).value).toBe("");
    expect(dialogo).toHaveTextContent("Fecha actual: 3 nov (sin hora)");
  });

  it("erroresCambio: misma fecha y hora, hora futura de hoy en La Paz, hora inválida", () => {
    const ahora = { fecha: "2026-11-14", hora: "14:37" };
    const actual = { fecha: "2026-11-03", hora: "09:05" };
    expect(erroresCambio("2026-11-03", "09:05", actual, ahora).fecha).toMatch(/misma fecha y hora/);
    expect(erroresCambio("2026-11-03", "09:05:00", actual, ahora).fecha).toMatch(/misma fecha y hora/);
    expect(erroresCambio("2026-11-03", "", actual, ahora)).toEqual({ fecha: null, hora: null }); // quitar la hora es un cambio
    expect(erroresCambio("2026-11-03", "", { fecha: "2026-11-03", hora: null }, ahora).fecha).toMatch(/misma/);
    expect(erroresCambio("2026-11-14", "14:38", actual, ahora).hora).toMatch(/posterior a la hora actual/);
    expect(erroresCambio("2026-11-14", "14:37", actual, ahora)).toEqual({ fecha: null, hora: null });
    expect(erroresCambio("2026-11-13", "23:59", actual, ahora)).toEqual({ fecha: null, hora: null });
    expect(erroresCambio("2026-11-15", "", actual, ahora).fecha).toMatch(/posterior a hoy/);
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

  it("«Hora: sin hora → 07:45» y «Hora: 10:00 → sin hora»", () => {
    const e = (cambios: Record<string, unknown>) => ({
      id: 1, entidad: "cuenta_mov", entidad_id: 7, accion: "editar", usuario_nombre: "Ana", fecha: "2026-11-14T12:00:00Z",
      fecha_cliente: null, motivo: null, etiqueta: null, cambios,
    }) as unknown as EntradaHistorial;
    expect(lineasDeCambios(e({ hora: { antes: null, despues: "07:45" } }))).toEqual(["Hora: sin hora → 07:45"]);
    expect(lineasDeCambios(e({ hora: { antes: "10:00", despues: null } }))).toEqual(["Hora: 10:00 → sin hora"]);
  });
});
