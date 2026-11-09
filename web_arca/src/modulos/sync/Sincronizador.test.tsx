import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AvisoProvider } from "../../core/Aviso";
import { instalarServidorFalso, movServidor, conflictoServidor } from "../../test/servidorFalso";
import { cantidadEnCola, encolar, listarOperaciones } from "./cola";
import * as ent from "./entidades";
import Sincronizador, { INTERVALO_REINTENTO_MS } from "./Sincronizador";
import { useEnCola } from "./useSync";

let sv: ReturnType<typeof instalarServidorFalso>;
beforeEach(() => {
  sv = instalarServidorFalso();
});
afterEach(() => vi.useRealTimers());

const gasto = (monto: number) => encolar({ entidad: "movimiento", accion: "crear", uuid: `u-${monto}`, datos: { tipo: "gasto", monto, fecha: "2026-11-07", categoria_id: 2, nota: null } });
const pantalla = () => render(<AvisoProvider><Sincronizador /><Contador /></AvisoProvider>);
function Contador() {
  return <p data-testid="n">{useEnCola()}</p>;
}

describe("Sincronizador", () => {
  it("al abrir la app envia lo pendiente, avisa y pide recargar los datos", async () => {
    await gasto(10);
    await gasto(20);
    sv.responder = () => ({ estado: 201, cuerpo: movServidor(1) });
    const recarga = vi.fn();
    window.addEventListener("arca-datos-nuevos", recarga);
    pantalla();
    expect(await screen.findByText("Se sincronizaron 2 registros")).toBeInTheDocument();
    expect(sv.llamadas).toHaveLength(2);
    await waitFor(() => expect(screen.getByTestId("n")).toHaveTextContent("0"));
    expect(recarga).toHaveBeenCalled();
    window.removeEventListener("arca-datos-nuevos", recarga);
  });

  it("usa singular con un solo registro", async () => {
    await gasto(10);
    sv.responder = () => ({ estado: 201, cuerpo: movServidor(1) });
    pantalla();
    expect(await screen.findByText("Se sincronizaron 1 registro")).toBeInTheDocument();
  });

  it("sin pendientes no llama al servidor", async () => {
    pantalla();
    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(sv.llamadas).toHaveLength(0);
  });

  it("al volver la conexion (evento online) reintenta lo que quedo en cola", async () => {
    await gasto(10);
    sv.responder = () => "red"; // al abrir no hay red
    pantalla();
    await waitFor(() => expect(sv.llamadas).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId("n")).toHaveTextContent("1"));
    sv.responder = () => ({ estado: 201, cuerpo: movServidor(1) }); // vuelve la red
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => expect(screen.getByTestId("n")).toHaveTextContent("0"));
    expect(sv.llamadas).toHaveLength(2);
  });

  it("REINTENTO AUTOMATICO: aunque no llegue ningun evento, reintenta cada 30 s mientras haya pendientes", async () => {
    await gasto(10);
    sv.responder = () => "red";
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] }); // solo el reloj de reintentos: IndexedDB sigue real
    pantalla();
    await vi.waitFor(() => expect(sv.llamadas).toHaveLength(1)); // intento al abrir: sin red
    expect(INTERVALO_REINTENTO_MS).toBe(30_000);

    await act(async () => { await vi.advanceTimersByTimeAsync(29_000); });
    expect(sv.llamadas).toHaveLength(1); // todavia no se cumplieron los 30 s

    await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
    await vi.waitFor(() => expect(sv.llamadas).toHaveLength(2)); // segundo intento, solo
    sv.responder = () => ({ estado: 201, cuerpo: movServidor(1) });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    await vi.waitFor(() => expect(sv.llamadas).toHaveLength(3));
    await vi.waitFor(async () => expect(await cantidadEnCola()).toBe(0)); // el tercero llego: la cola quedo vacia
    expect(await screen.findByText("Se sincronizaron 1 registro")).toBeInTheDocument();

    const antes = sv.llamadas.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
    expect(sv.llamadas).toHaveLength(antes); // sin pendientes ya no llama
  });

  it("deja de reintentar al cerrar la app (desmontar)", async () => {
    await gasto(10);
    sv.responder = () => "red";
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { unmount } = pantalla();
    await vi.waitFor(() => expect(sv.llamadas).toHaveLength(1));
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(sv.llamadas).toHaveLength(1);
  });

  it("una operacion en conflicto NO se reintenta sola (espera la decision del usuario) y se avisa una vez", async () => {
    await ent.guardarMovimientos([movServidor(7) as never]);
    await encolar({ entidad: "movimiento", accion: "editar", entidadId: 7, datos: { monto: 9 }, versionBase: 1 });
    sv.responder = () => conflictoServidor(movServidor(7, { version: 2 }));
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    pantalla();
    expect(await screen.findByText("1 cambio(s) en conflicto: elige cuál conservar")).toBeInTheDocument();
    expect(sv.llamadas).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(sv.llamadas).toHaveLength(1);
    expect((await listarOperaciones())[0].estado).toBe("conflicto");
  });

  it("avisa cuando el servidor rechaza", async () => {
    await gasto(10);
    sv.responder = () => ({ estado: 422, cuerpo: { detail: "La categoría está desactivada" } });
    pantalla();
    expect(await screen.findByText("1 registro(s) fueron rechazados por el servidor")).toBeInTheDocument();
  });
});

describe("useEnCola", () => {
  it("sigue el tamano de la cola en vivo", async () => {
    render(<Contador />);
    await waitFor(() => expect(screen.getByTestId("n")).toHaveTextContent("0"));
    await act(async () => { await gasto(1); });
    await waitFor(() => expect(screen.getByTestId("n")).toHaveTextContent("1"));
    await act(async () => { await gasto(2); });
    await waitFor(() => expect(screen.getByTestId("n")).toHaveTextContent("2"));
  });
});
