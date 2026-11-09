import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AvisoProvider } from "../../core/Aviso";
import { conflictoServidor, instalarServidorFalso, movServidor } from "../../test/servidorFalso";
import BarraSync, { TIEMPOS_TODO_SINCRONIZADO } from "./BarraSync";
import { cantidadEnCola, encolar, sincronizar } from "./cola";

let sv: ReturnType<typeof instalarServidorFalso>;
const TIEMPOS_REALES = { ...TIEMPOS_TODO_SINCRONIZADO };
beforeEach(() => {
  sv = instalarServidorFalso();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  Object.assign(TIEMPOS_TODO_SINCRONIZADO, { demora: 60, duracion: 400 }); // tiempos cortos para no esperar 7 s por prueba
});
afterEach(() => Object.assign(TIEMPOS_TODO_SINCRONIZADO, TIEMPOS_REALES));

const Pantalla = () => <AvisoProvider><BarraSync /></AvisoProvider>;
const pantalla = () => render(<Pantalla />);
const gasto = (monto: number) =>
  encolar({ entidad: "movimiento", accion: "crear", uuid: `u-${monto}`, datos: { tipo: "gasto", monto, fecha: "2026-11-07", categoria_id: 2, nota: null } });
const sincronizarAhora = async (u: ReturnType<typeof userEvent.setup>) => u.click(await screen.findByRole("button", { name: "Sincronizar ahora" }));

describe("BarraSync compacta", () => {
  it("es una sola fila: contador y estado a la izquierda, boton de sincronizar (icono) y 'Ver detalle' a la derecha", async () => {
    await gasto(10);
    pantalla();
    const barra = await screen.findByTestId("barra-sync");
    expect(barra.className).toMatch(/\bflex\b/);
    expect(barra.className).toMatch(/items-center/);
    expect(screen.getByTestId("cambios-pendientes")).toHaveTextContent("1 cambio pendiente");
    expect(screen.getByTestId("estado-sync")).toHaveTextContent("Se reintentará solo en unos segundos");
    const sync = screen.getByRole("button", { name: "Sincronizar ahora" });
    expect(sync.className).toMatch(/min-h-\[44px\]/);
    expect(sync.className).toMatch(/min-w-\[44px\]/);
    expect(sync.textContent).toBe("↻"); // solo el icono se ve; el nombre accesible es "Sincronizar ahora"
    expect(screen.getByRole("button", { name: "Ver detalle" }).className).toMatch(/min-h-\[44px\]/);
    // ya no hay botones grandes de ancho completo (56 px) dentro de la barra
    expect(barra.querySelectorAll("button")).toHaveLength(2);
    expect(barra.className).toMatch(/min-h-\[52px\]/);
  });

  it("'Ver detalle' abre la lista de cambios; el boton de sincronizar sigue enviando la cola", async () => {
    const u = userEvent.setup();
    await gasto(10);
    sv.responder = () => ({ estado: 201, cuerpo: movServidor(1) });
    pantalla();
    await u.click(await screen.findByRole("button", { name: "Ver detalle" }));
    expect(await screen.findByRole("dialog", { name: "Cambios pendientes" })).toBeInTheDocument();
    await u.keyboard("{Escape}");
    await sincronizarAhora(u);
    await waitFor(async () => expect(await cantidadEnCola()).toBe(0));
  });

  it("con un conflicto la fila se ve roja de inmediato y dice 'en conflicto' y 'Esperando tu decision'", async () => {
    await ensureConflict();
    pantalla();
    const barra = await screen.findByTestId("barra-sync");
    expect(barra.className).toMatch(/bg-red-50/);
    expect(barra.className).toMatch(/border-red-300/);
    expect(screen.getByTestId("cambios-pendientes")).toHaveTextContent("1 cambio pendiente · 1 en conflicto");
    expect(screen.getByTestId("estado-sync")).toHaveTextContent("Esperando tu decisión");
  });

  it("con rechazos el aviso rojo se ve de inmediato (sin abrir nada) y abre la lista", async () => {
    const u = userEvent.setup();
    await gasto(10);
    sv.responder = () => ({ estado: 403, cuerpo: { detail: "Solo puedes modificar lo que registraste tu" } });
    await sincronizar();
    pantalla();
    const aviso = await screen.findByTestId("aviso-rechazos");
    expect(aviso).toHaveTextContent("No se pudo sincronizar 1 cambio");
    await u.click(aviso);
    expect(await screen.findByTestId("rechazo")).toHaveTextContent("Solo puedes modificar lo que registraste tu");
  });

  it("sin nada pendiente y con conexion no ocupa nada", async () => {
    pantalla();
    await act(async () => {});
    expect(screen.queryByRole("region", { name: "Estado de sincronización" })).not.toBeInTheDocument();
  });
});

describe("BarraSync: 'Todo sincronizado'", () => {
  it("al pasar de pendientes a 0 sale UNA vez, como status, y no es la barra de pendientes", async () => {
    const u = userEvent.setup();
    await gasto(10);
    await gasto(20);
    sv.responder = () => ({ estado: 201, cuerpo: movServidor(1) });
    pantalla();
    await sincronizarAhora(u);
    const ok = await screen.findByTestId("todo-sincronizado");
    expect(ok).toHaveAttribute("role", "status");
    expect(ok).toHaveTextContent("Todo sincronizado");
    expect(screen.getAllByTestId("todo-sincronizado")).toHaveLength(1);
    expect(screen.queryByTestId("barra-sync")).not.toBeInTheDocument();
    expect(screen.queryByTestId("cambios-pendientes")).not.toBeInTheDocument();
  });

  it("no sale al abrir la app (cola vacia) ni al abrirla con pendientes", async () => {
    const vacia = pantalla();
    await act(async () => {});
    expect(screen.queryByTestId("todo-sincronizado")).not.toBeInTheDocument();
    vacia.unmount();
    await gasto(10);
    pantalla();
    await screen.findByTestId("barra-sync");
    expect(screen.queryByTestId("todo-sincronizado")).not.toBeInTheDocument();
  });

  it("no se repite al volver a montar la pantalla despues (cargas posteriores) pero si en una nueva transicion", async () => {
    const u = userEvent.setup();
    await gasto(10);
    sv.responder = () => ({ estado: 201, cuerpo: movServidor(1) });
    const p = pantalla();
    await sincronizarAhora(u);
    await screen.findByTestId("todo-sincronizado");
    p.unmount();
    pantalla(); // otra carga de la pantalla: cola vacia, no hay transicion
    await act(async () => {});
    expect(screen.queryByTestId("todo-sincronizado")).not.toBeInTheDocument();
  });

  it("desaparece solo a los 3,5 s", async () => {
    const u = userEvent.setup();
    await gasto(10);
    sv.responder = () => ({ estado: 201, cuerpo: movServidor(1) });
    pantalla();
    await sincronizarAhora(u);
    await screen.findByTestId("todo-sincronizado");
    await waitFor(() => expect(screen.queryByTestId("todo-sincronizado")).not.toBeInTheDocument(), { timeout: 6000 });
  });

  it("si el servidor rechazo el cambio NO dice 'Todo sincronizado' (hay algo que ver)", async () => {
    const u = userEvent.setup();
    await gasto(10);
    sv.responder = () => ({ estado: 403, cuerpo: { detail: "No permitido" } });
    pantalla();
    await sincronizarAhora(u);
    await screen.findByTestId("aviso-rechazos");
    await act(async () => { await new Promise((r) => setTimeout(r, 250)); }); // mas que la demora: si fuera a salir, ya habria salido
    expect(screen.queryByTestId("todo-sincronizado")).not.toBeInTheDocument();
  });

  it("los tiempos reales dejan pasar el aviso de arriba (3,5 s) antes de mostrarse, para no taparse entre si", () => {
    expect(TIEMPOS_REALES.demora).toBeGreaterThanOrEqual(3500);
    expect(TIEMPOS_REALES.duracion).toBeGreaterThanOrEqual(3000);
  });

  it("no sale de inmediato: primero pasa la demora", async () => {
    const u = userEvent.setup();
    Object.assign(TIEMPOS_TODO_SINCRONIZADO, { demora: 300, duracion: 2000 });
    await gasto(10);
    sv.responder = () => ({ estado: 201, cuerpo: movServidor(1) });
    pantalla();
    await sincronizarAhora(u);
    await waitFor(async () => expect(await cantidadEnCola()).toBe(0));
    expect(screen.queryByTestId("todo-sincronizado")).not.toBeInTheDocument(); // aun dentro de la demora
    expect(await screen.findByTestId("todo-sincronizado")).toBeInTheDocument(); // y despues si
  });

  it("si llegan cambios nuevos mientras se muestra, se quita (vuelve la barra de pendientes)", async () => {
    const u = userEvent.setup();
    await gasto(10);
    sv.responder = () => ({ estado: 201, cuerpo: movServidor(1) });
    pantalla();
    await sincronizarAhora(u);
    await screen.findByTestId("todo-sincronizado");
    await act(async () => { await gasto(77); });
    await screen.findByTestId("barra-sync");
    expect(screen.queryByTestId("todo-sincronizado")).not.toBeInTheDocument();
  });
});

/** Una operacion de edicion en conflicto con el servidor. */
async function ensureConflict() {
  const ent = await import("./entidades");
  await ent.guardarMovimientos([movServidor(7) as never]);
  await encolar({ entidad: "movimiento", accion: "editar", entidadId: 7, datos: { monto: 99 }, versionBase: 1 });
  sv.responder = () => conflictoServidor(movServidor(7, { monto: 55, version: 2 }));
  await sincronizar();
}
