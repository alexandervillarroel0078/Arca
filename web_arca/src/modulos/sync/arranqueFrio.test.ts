// Fase 13: la cola sin conexion tolera el arranque en frio del servidor (no marca el error como rechazo definitivo).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reiniciarServidor, tiempos } from "../../core/servidor";
import { movServidor } from "../../test/servidorFalso";
import { cantidadEnCola, encolar, ejecutar, listarOperaciones, listarRechazos, sincronizar } from "./cola";
import { operar } from "./operaciones";

const gasto = { entidad: "movimiento" as const, accion: "crear" as const, uuid: "u1", datos: { tipo: "gasto", monto: 10, fecha: "2026-11-07", categoria_id: 2, nota: null } };
const colgado = () => vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_ok, mal) => {
  init.signal?.addEventListener("abort", () => mal(new DOMException("Aborted", "AbortError")));
}));
const json = (c: unknown, estado = 200) => new Response(JSON.stringify(c), { status: estado, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  reiniciarServidor();
  tiempos.primera = 60; // "90 s" de verdad, acortados: IndexedDB falso no funciona con el reloj simulado
});
afterEach(() => {
  reiniciarServidor();
  vi.unstubAllGlobals();
});


describe("cola y arranque en frio", () => {
  it("si el servidor tarda en despertar (90 s sin responder) la operacion QUEDA PENDIENTE: no es un rechazo", async () => {
    vi.stubGlobal("fetch", colgado());
    const { resultado } = await ejecutar(gasto); // el fetch no contesta: se rinde a los (acortados) "90 s"
    expect(resultado).toEqual({ tipo: "pendiente" });
    expect(await cantidadEnCola()).toBe(1);
    expect(await listarRechazos()).toHaveLength(0); // nada se marco como rechazo definitivo
    expect((await listarOperaciones())[0]).toMatchObject({ estado: "pendiente", uuid: "u1" });
  });

  it("al reintentar con el servidor ya despierto la misma operacion (mismo UUID) se envia y sale de la cola", async () => {
    vi.stubGlobal("fetch", colgado());
    await ejecutar(gasto);
    const [pendiente] = await listarOperaciones();
    const f = vi.fn().mockResolvedValue(json(movServidor(5, { uuid_cliente: "u1" }), 201));
    vi.stubGlobal("fetch", f);
    const r = await sincronizar();
    expect(r).toMatchObject({ enviados: 1, quedan: 0, rechazados: 0 });
    expect(JSON.parse(f.mock.calls[0][1].body).uuid_cliente).toBe("u1");
    expect(f.mock.calls[0][1].headers["X-Operacion-Id"]).toBe(pendiente.id);
  });

  it("una pasada que se queda sin tiempo conserva TODA la cola en orden y no sigue con las demas", async () => {
    await encolar(gasto);
    await encolar({ ...gasto, uuid: "u2" });
    const f = colgado();
    vi.stubGlobal("fetch", f);
    expect(await sincronizar()).toMatchObject({ enviados: 0, quedan: 2, sinConexion: true, rechazados: 0 });
    expect(f).toHaveBeenCalledTimes(1); // no insiste con la segunda mientras el servidor no responde
    expect((await listarOperaciones()).map((o) => o.uuid)).toEqual(["u1", "u2"]);
  });

  it("respuestas 502, 503 y 504 del proveedor (con HTML) mientras despierta se reintentan: no son rechazos", async () => {
    for (const estado of [502, 503, 504]) {
      await encolar({ ...gasto, uuid: `u${estado}` });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>Service Unavailable</html>", { status: estado })));
      const r = await sincronizar();
      expect(r).toMatchObject({ enviados: 0, rechazados: 0 });
    }
    expect(await cantidadEnCola()).toBe(3);
    expect(await listarRechazos()).toHaveLength(0);
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => json(movServidor(1), 201)));
    expect((await sincronizar()).quedan).toBe(0);
  });

  it("quien esta mirando (operar) ve la operacion como pendiente, no como error", async () => {
    vi.stubGlobal("fetch", colgado());
    await expect(operar(gasto)).resolves.toBeNull(); // null = quedo pendiente
  });

  it("un rechazo REAL (422) si se rechaza, para distinguirlo de un servidor dormido", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ detail: "La categoría está desactivada" }, 422)));
    await encolar(gasto);
    expect(await sincronizar()).toMatchObject({ rechazados: 1, quedan: 0 });
    expect(await listarRechazos()).toHaveLength(1);
  });
});
