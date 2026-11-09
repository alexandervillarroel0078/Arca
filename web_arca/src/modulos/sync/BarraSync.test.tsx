import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as almacen from "../../core/almacen";
import { AvisoProvider } from "../../core/Aviso";
import { ErrorRed } from "../../core/api";
import { conflictoServidor, instalarServidorFalso, movServidor } from "../../test/servidorFalso";
import BarraSync from "./BarraSync";
import { conCache } from "./cache";
import { cantidadEnCola, encolar, listarRechazos, sincronizar } from "./cola";
import * as ent from "./entidades";

let sv: ReturnType<typeof instalarServidorFalso>;
beforeEach(() => {
  sv = instalarServidorFalso();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});

const pantalla = () => render(<AvisoProvider><BarraSync /></AvisoProvider>);
const gasto = (monto: number, nota: string | null = null) =>
  encolar({ entidad: "movimiento", accion: "crear", uuid: `u-${monto}`, datos: { tipo: "gasto", monto, fecha: "2026-11-07", categoria_id: 2, nota } });

describe("indicador de cambios pendientes", () => {
  it("sin nada pendiente y con conexion no muestra nada", async () => {
    pantalla();
    await act(async () => {});
    expect(screen.queryByRole("region", { name: "Estado de sincronización" })).not.toBeInTheDocument();
  });

  it("muestra 'N cambios pendientes' (singular/plural), el estado y el boton 'Sincronizar ahora'", async () => {
    await gasto(10);
    pantalla();
    expect(await screen.findByTestId("cambios-pendientes")).toHaveTextContent("1 cambio pendiente");
    expect(screen.getByTestId("estado-sync")).toHaveTextContent("Se reintentará solo");
    expect(screen.getByRole("button", { name: "Sincronizar ahora" })).toBeEnabled();
    await act(async () => { await gasto(20); });
    await waitFor(() => expect(screen.getByTestId("cambios-pendientes")).toHaveTextContent("2 cambios pendientes"));
  });

  it("sin conexion el estado lo dice", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await gasto(10);
    pantalla();
    expect(await screen.findByTestId("estado-sync")).toHaveTextContent("Sin conexión: se enviarán al volver la conexión");
  });

  it("solo sin conexion y nada pendiente: avisa 'Sin conexión'", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    pantalla();
    expect(await screen.findByText("📴 Sin conexión")).toBeInTheDocument();
  });

  it("'Sincronizar ahora' envia la cola, avisa y la barra desaparece", async () => {
    const u = userEvent.setup();
    await gasto(10);
    await gasto(20);
    sv.responder = () => ({ estado: 201, cuerpo: movServidor(1) });
    pantalla();
    await u.click(await screen.findByRole("button", { name: "Sincronizar ahora" }));
    expect(await screen.findByText("Se sincronizaron 2 registros")).toBeInTheDocument();
    expect(sv.llamadas).toHaveLength(2);
    await waitFor(() => expect(screen.queryByTestId("barra-sync")).not.toBeInTheDocument());
  });

  it("'Sincronizar ahora' sin conexion lo explica y conserva todo", async () => {
    const u = userEvent.setup();
    await gasto(10);
    sv.responder = () => "red";
    pantalla();
    await u.click(await screen.findByRole("button", { name: "Sincronizar ahora" }));
    expect(await screen.findByText(/Sin conexión: no se pudo enviar/)).toBeInTheDocument();
    expect(await cantidadEnCola()).toBe(1);
  });

  it("'Ver detalle' lista cada cambio con la fecha en que se hizo", async () => {
    const u = userEvent.setup();
    await gasto(10, "Almuerzo");
    pantalla();
    await u.click(await screen.findByRole("button", { name: "Ver detalle" }));
    const dialogo = await screen.findByRole("dialog", { name: "Cambios pendientes" });
    const fila = await within(dialogo).findByTestId("operacion-pendiente");
    expect(fila).toHaveTextContent("Gasto nuevo de Bs 10.00 · Almuerzo");
    expect(fila).toHaveTextContent(/Hecho el \d/);
    await u.click(within(dialogo).getAllByRole("button", { name: "Cerrar" })[0]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("conflictos", () => {
  async function enConflicto() {
    await ent.guardarMovimientos([movServidor(7, { monto: 10, nota: "Almuerzo" }) as never]);
    await encolar({ entidad: "movimiento", accion: "editar", entidadId: 7, datos: { monto: 99, nota: "Mi nota" }, versionBase: 1 });
    sv.responder = () => conflictoServidor(movServidor(7, { monto: 55, nota: "Nota del otro", version: 2, editado_por_nombre: "Beto" }));
    await sincronizar();
    sv.llamadas.length = 0;
  }

  it("la barra cuenta el conflicto y el panel muestra AMBAS versiones campo por campo", async () => {
    const u = userEvent.setup();
    await enConflicto();
    pantalla();
    expect(await screen.findByTestId("cambios-pendientes")).toHaveTextContent("1 cambio pendiente · 1 en conflicto");
    expect(screen.getByTestId("estado-sync")).toHaveTextContent("Esperando tu decisión");
    await u.click(screen.getByRole("button", { name: "Ver detalle" }));
    const c = await screen.findByTestId("conflicto");
    expect(c).toHaveTextContent("Editar gasto"); // describe el registro tal como esta ahora en el servidor
    expect(c).toHaveTextContent("La mía");
    expect(c).toHaveTextContent("La del servidor");
    expect(c).toHaveTextContent("Bs 99.00"); // lo mio
    expect(c).toHaveTextContent("Bs 55.00"); // lo del servidor
    expect(c).toHaveTextContent("Mi nota");
    expect(c).toHaveTextContent("Nota del otro");
  });

  it("'Usar la mia' reenvia mi cambio sobre la version actual y el conflicto desaparece", async () => {
    const u = userEvent.setup();
    await enConflicto();
    pantalla();
    await u.click(await screen.findByRole("button", { name: "Ver detalle" }));
    sv.responder = () => ({ estado: 200, cuerpo: movServidor(7, { monto: 99, version: 3 }) });
    await u.click(await screen.findByRole("button", { name: "Usar la mía" }));
    await waitFor(() => expect(sv.llamadas).toHaveLength(1));
    expect(sv.llamadas[0].cuerpo).toMatchObject({ monto: 99, nota: "Mi nota", version_base: 2 });
    await waitFor(async () => expect(await cantidadEnCola()).toBe(0));
    await waitFor(() => expect(screen.queryByTestId("conflicto")).not.toBeInTheDocument());
  });

  it("'Usar la del servidor' descarta mi cambio y no manda nada", async () => {
    const u = userEvent.setup();
    await enConflicto();
    pantalla();
    await u.click(await screen.findByRole("button", { name: "Ver detalle" }));
    await u.click(await screen.findByRole("button", { name: "Usar la del servidor" }));
    await waitFor(async () => expect(await cantidadEnCola()).toBe(0));
    expect(sv.llamadas).toHaveLength(0);
    expect((await ent.leerMovimiento(7))?.monto).toBe(55); // se queda con lo del servidor
  });

  it("anular en conflicto muestra el estado actual del servidor", async () => {
    const u = userEvent.setup();
    await ent.guardarMovimientos([movServidor(7) as never]);
    await encolar({ entidad: "movimiento", accion: "anular", entidadId: 7, datos: { motivo: null }, versionBase: 1 });
    sv.responder = () => conflictoServidor(movServidor(7, { version: 2, editado_por_nombre: "Beto" }));
    await sincronizar();
    pantalla();
    await u.click(await screen.findByRole("button", { name: "Ver detalle" }));
    const c = await screen.findByTestId("conflicto");
    expect(c).toHaveTextContent("Estado");
    expect(c).toHaveTextContent("Anulado"); // lo mio
    expect(c).toHaveTextContent("Activo (editado por Beto)"); // lo del servidor
  });
});

describe("No se pudo sincronizar", () => {
  it("un rechazo del servidor aparece en la lista con su motivo hasta que el usuario lo marca como visto", async () => {
    const u = userEvent.setup();
    await gasto(10, "Mi gasto");
    sv.responder = () => ({ estado: 403, cuerpo: { detail: "Solo puedes modificar lo que registraste tú" } });
    await sincronizar();
    pantalla();
    const aviso = await screen.findByTestId("aviso-rechazos");
    expect(aviso).toHaveTextContent("No se pudo sincronizar 1 cambio");
    await u.click(aviso);
    const r = await screen.findByTestId("rechazo");
    expect(r).toHaveTextContent("Gasto nuevo de Bs 10.00 · Mi gasto");
    expect(r).toHaveTextContent("Solo puedes modificar lo que registraste tú");
    expect(await listarRechazos()).toHaveLength(1); // sigue guardado hasta que lo confirme
    await u.click(within(r).getByRole("button", { name: "Entendido" }));
    await waitFor(async () => expect(await listarRechazos()).toHaveLength(0));
    await waitFor(() => expect(screen.queryByTestId("aviso-rechazos")).not.toBeInTheDocument());
  });
});

describe("datos de cache", () => {
  it("sin conexion muestra 'Datos de hace X min, sin conexión' con la edad real de la copia", async () => {
    await almacen.poner("cache", { clave: "resumen:2026-11", datos: { saldo: 5 }, guardado: Date.now() - 5 * 60_000 });
    pantalla();
    const { datos, deCache } = await conCache("resumen:2026-11", async () => { throw new ErrorRed(); });
    expect(deCache).toBe(true);
    expect(datos).toEqual({ saldo: 5 });
    expect(await screen.findByTestId("datos-viejos")).toHaveTextContent("Datos de hace 5 min, sin conexión");
  });

  it("al volver la conexion y leer de nuevo, el aviso desaparece", async () => {
    await almacen.poner("cache", { clave: "k", datos: 1, guardado: Date.now() - 60_000 });
    pantalla();
    await conCache("k", async () => { throw new ErrorRed(); });
    expect(await screen.findByTestId("datos-viejos")).toBeInTheDocument();
    await conCache("k", async () => 2);
    await waitFor(() => expect(screen.queryByTestId("datos-viejos")).not.toBeInTheDocument());
  });

  it("dias y horas se dicen en palabras", async () => {
    await almacen.poner("cache", { clave: "a", datos: 1, guardado: Date.now() - 3 * 3_600_000 });
    pantalla();
    await conCache("a", async () => { throw new ErrorRed(); });
    expect(await screen.findByTestId("datos-viejos")).toHaveTextContent("Datos de hace 3 h, sin conexión");
  });

  it("sin copia guardada el error se muestra (no hay nada que enseñar)", async () => {
    await expect(conCache("nunca-visto", async () => { throw new ErrorRed(); })).rejects.toBeInstanceOf(ErrorRed);
  });

  it("los errores que no son de red (sesion vencida, servidor) NO se esconden con datos viejos", async () => {
    await almacen.poner("cache", { clave: "k", datos: 1, guardado: Date.now() });
    await expect(conCache("k", async () => { throw new Error("Error del servidor"); })).rejects.toThrow("Error del servidor");
  });
});
