// Cola de operaciones sin internet (Fase 12): fusion, orden, conflicto, rechazo y reintento.
// Se usa IndexedDB real (fake-indexeddb) y se simula el servidor con un `fetch` falso.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorApi } from "../../core/api";
import { alCambiarCola, cantidadEnCola, descartarRechazo, ejecutar, encolar, listarOperaciones, listarRechazos, resolverConflicto, resolverReferencia, sincronizar } from "./cola";
import * as ent from "./entidades";
import type { NuevaOperacion } from "./tipos";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface Llamada {
  metodo: string;
  ruta: string;
  cuerpo: any;
  cabeceras: Record<string, string>;
}
let llamadas: Llamada[] = [];
/** Respuesta del servidor falso para cada peticion: se cambia en cada prueba. */
let servidor: (l: Llamada) => { estado: number; cuerpo: unknown } | "red" = () => ({ estado: 200, cuerpo: {} });

beforeEach(() => {
  llamadas = [];
  servidor = () => ({ estado: 200, cuerpo: {} });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const l: Llamada = {
        metodo: init.method ?? "GET",
        ruta: String(url).replace(/^.*\/api/, ""),
        cuerpo: init.body ? JSON.parse(String(init.body)) : undefined,
        cabeceras: (init.headers ?? {}) as Record<string, string>,
      };
      llamadas.push(l);
      const r = servidor(l);
      if (r === "red") throw new TypeError("Failed to fetch");
      return { ok: r.estado < 400, status: r.estado, json: async () => r.cuerpo } as Response;
    }),
  );
});

const gasto = (monto: number, uuid = `g-${monto}`): NuevaOperacion => ({
  entidad: "movimiento", accion: "crear", uuid, datos: { tipo: "gasto", monto, fecha: "2026-11-07", categoria_id: 2, nota: null },
});
const apoyo = (monto: number, uuid = `a-${monto}`): NuevaOperacion => ({
  entidad: "apoyo", accion: "crear", uuid, datos: { beneficiario: "Tia Rosa", monto, fecha: "2026-11-07", nota: null },
});
const movServidor = (id: number, c: Record<string, unknown> = {}) => ({
  id, tipo: "gasto", monto: 10, fecha: "2026-11-07", categoria_id: 2, categoria_nombre: "Comida", categoria_icono: "utensils", nota: null,
  usuario_id: 1, usuario_nombre: "Ana", version: 1, uuid_cliente: null, anulado: false, anulado_por_nombre: null, anulado_en: null,
  motivo_anulacion: null, editado_por_nombre: null, editado_en: null, ...c,
});
const apoyoServidor = (id: number, c: Record<string, unknown> = {}) => ({
  id, beneficiario: "Tia Rosa", monto: 300, fecha: "2026-11-07", nota: null, usuario_id: 1, usuario_nombre: "Ana", devuelto: 0, consumido: 0,
  pendiente: 300, estado: "Pendiente", devoluciones: [], devoluciones_activas: 0, version: 1, uuid_cliente: null, anulado: false,
  anulado_por_nombre: null, anulado_en: null, motivo_anulacion: null, editado_por_nombre: null, editado_en: null, ...c,
});
/** Deja un movimiento "ya conocido" (como si se hubiera visto en una pantalla) para poder editarlo. */
const conocido = async (id = 7, version = 1) => ent.guardarMovimientos([movServidor(id, { version }) as never]);
const editar = (id: number, datos: Record<string, unknown>, versionBase: number | null = 1): NuevaOperacion => ({
  entidad: "movimiento", accion: "editar", entidadId: id, datos, versionBase,
});

describe("encolar", () => {
  it("guarda en IndexedDB en orden, con UUID de operacion propio, y avisa del cambio", async () => {
    const aviso = vi.fn();
    const quitar = alCambiarCola(aviso);
    expect(await cantidadEnCola()).toBe(0);
    await encolar(gasto(10));
    await encolar(apoyo(50));
    expect(await cantidadEnCola()).toBe(2);
    expect(aviso).toHaveBeenCalledTimes(2);
    const ops = await listarOperaciones();
    expect(ops.map((o) => o.entidad)).toEqual(["movimiento", "apoyo"]);
    expect(ops[0].id).toMatch(UUID_V4); // cada operacion tiene su propio UUID
    expect(ops[1].id).toMatch(UUID_V4);
    expect(ops[0].id).not.toBe(ops[1].id);
    expect(ops[0].seq).toBeLessThan(ops[1].seq);
    quitar();
  });

  it("guarda cuando el usuario hizo la accion (fecha del cliente)", async () => {
    const antes = Date.now();
    const { operacion } = await encolar(gasto(10));
    const t = new Date(operacion.fechaCliente).getTime();
    expect(t).toBeGreaterThanOrEqual(antes);
    expect(t).toBeLessThanOrEqual(Date.now());
  });
});

describe("fusion con la creacion pendiente", () => {
  it("editar algo creado sin internet cambia la creacion: sale UNA operacion con el valor final", async () => {
    await encolar(gasto(10, "u1"));
    const r = await encolar({ entidad: "movimiento", accion: "editar", uuid: "u1", datos: { monto: 25, nota: "final" } });
    expect(r.fusionada).toBe(true);
    const ops = await listarOperaciones();
    expect(ops).toHaveLength(1);
    expect(ops[0].accion).toBe("crear");
    expect(ops[0].datos).toMatchObject({ monto: 25, nota: "final", tipo: "gasto" });

    servidor = () => ({ estado: 201, cuerpo: movServidor(50, { monto: 25 }) });
    await sincronizar();
    expect(llamadas).toHaveLength(1); // una sola peticion
    expect(llamadas[0]).toMatchObject({ metodo: "POST", ruta: "/movimientos" });
    expect(llamadas[0].cuerpo).toMatchObject({ monto: 25, nota: "final", uuid_cliente: "u1" });
  });

  it("varias ediciones seguidas siguen siendo una sola creacion", async () => {
    await encolar(gasto(10, "u1"));
    await encolar({ entidad: "movimiento", accion: "editar", uuid: "u1", datos: { monto: 20 } });
    await encolar({ entidad: "movimiento", accion: "editar", uuid: "u1", datos: { monto: 30 } });
    const ops = await listarOperaciones();
    expect(ops).toHaveLength(1);
    expect(ops[0].datos.monto).toBe(30);
  });

  it("pasar de gasto a ingreso en la creacion pendiente limpia la categoria", async () => {
    await encolar(gasto(10, "u1"));
    await encolar({ entidad: "movimiento", accion: "editar", uuid: "u1", datos: { tipo: "ingreso" } });
    expect((await listarOperaciones())[0].datos).toMatchObject({ tipo: "ingreso", categoria_id: null });
  });

  it("anular lo creado sin internet sale como UNA creacion ya anulada (con motivo y fecha de la anulacion)", async () => {
    await encolar(gasto(10, "u1"));
    const r = await encolar({ entidad: "movimiento", accion: "anular", uuid: "u1", datos: { motivo: "  me equivoque " } });
    expect(r.fusionada).toBe(true);
    const ops = await listarOperaciones();
    expect(ops).toHaveLength(1);
    expect(ops[0].datos).toMatchObject({ anulado: true, motivo_anulacion: "me equivoque" });
    expect(typeof ops[0].datos.fecha_cliente_anulacion).toBe("string");
  });

  it("reactivar lo anulado antes de sincronizar deja una creacion normal", async () => {
    await encolar(gasto(10, "u1"));
    await encolar({ entidad: "movimiento", accion: "anular", uuid: "u1", datos: {} });
    await encolar({ entidad: "movimiento", accion: "reactivar", uuid: "u1" });
    const ops = await listarOperaciones();
    expect(ops).toHaveLength(1);
    expect(ops[0].datos.anulado).toBeUndefined();
    expect(ops[0].datos.motivo_anulacion).toBeUndefined();
  });

  it("no deja editar una creacion ya anulada, ni anularla dos veces, ni reactivar lo que no esta anulado", async () => {
    await encolar(gasto(10, "u1"));
    await expect(encolar({ entidad: "movimiento", accion: "reactivar", uuid: "u1" })).rejects.toThrow("no está anulado");
    await encolar({ entidad: "movimiento", accion: "anular", uuid: "u1", datos: {} });
    await expect(encolar({ entidad: "movimiento", accion: "anular", uuid: "u1", datos: {} })).rejects.toThrow("ya está anulado");
    await expect(encolar({ entidad: "movimiento", accion: "editar", uuid: "u1", datos: { monto: 1 } })).rejects.toThrow("anulado");
    expect(await cantidadEnCola()).toBe(1);
  });

  it("si hay una devolucion pendiente del apoyo, NO se fusiona (el orden importa) y se encolan aparte", async () => {
    await encolar(apoyo(300, "ap1"));
    await encolar({ entidad: "devolucion", accion: "crear", uuid: "d1", apoyoUuid: "ap1", datos: { monto: 100, fecha: "2026-11-07", nota: null } });
    const r = await encolar({ entidad: "apoyo", accion: "anular", uuid: "ap1", datos: { motivo: null } });
    expect(r.fusionada).toBe(false);
    const ops = await listarOperaciones();
    expect(ops.map((o) => `${o.entidad}:${o.accion}`)).toEqual(["apoyo:crear", "devolucion:crear", "apoyo:anular"]);
  });

  it("no fusiona con una creacion que ya salio hacia el servidor", async () => {
    await encolar(gasto(10, "u1"));
    let liberar: () => void = () => {};
    servidor = () => "red";
    // la peticion queda en vuelo
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((res) => { liberar = () => res({ ok: true, status: 201, json: async () => movServidor(9, { uuid_cliente: "u1" }) } as Response); }));
    const envio = sincronizar();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const r = await encolar({ entidad: "movimiento", accion: "editar", uuid: "u1", datos: { monto: 99 } });
    expect(r.fusionada).toBe(false); // la creacion ya va en camino con el valor anterior
    liberar();
    await envio;
    const ops = await listarOperaciones();
    expect(ops).toHaveLength(1);
    expect(ops[0].accion).toBe("editar");
  });
});

describe("orden y envio", () => {
  it("envia en el mismo orden en que el usuario hizo las cosas y vacia la cola", async () => {
    await conocido(7);
    await encolar(gasto(10, "u1"));
    await encolar(apoyo(50, "a1"));
    await encolar(editar(7, { monto: 77 }));
    await encolar({ entidad: "movimiento", accion: "anular", entidadId: 7, datos: { motivo: "x" }, versionBase: 1 });
    servidor = (l) => ({ estado: l.metodo === "POST" && l.ruta === "/movimientos" ? 201 : 200, cuerpo: l.ruta.startsWith("/apoyos") ? apoyoServidor(60) : movServidor(7) });
    const r = await sincronizar();
    expect(llamadas.map((l) => `${l.metodo} ${l.ruta}`)).toEqual(["POST /movimientos", "POST /apoyos", "PATCH /movimientos/7", "POST /movimientos/7/anular"]);
    expect(r).toMatchObject({ enviados: 4, rechazados: 0, conflictos: 0, quedan: 0, sinConexion: false });
    expect(await cantidadEnCola()).toBe(0);
  });

  it("cada peticion lleva el UUID de SU operacion y la fecha real en que el usuario la hizo", async () => {
    await conocido(7);
    const { operacion } = await encolar(editar(7, { monto: 5 }));
    await sincronizar();
    expect(llamadas[0].cabeceras["X-Operacion-Id"]).toBe(operacion.id);
    expect(llamadas[0].cabeceras["X-Fecha-Cliente"]).toBe(operacion.fechaCliente);
  });

  it("una devolucion de un apoyo creado sin internet usa el id que el servidor dio al apoyo", async () => {
    await encolar(apoyo(300, "ap1"));
    await encolar({ entidad: "devolucion", accion: "crear", uuid: "d1", apoyoUuid: "ap1", datos: { monto: 100, fecha: "2026-11-07", nota: null } });
    servidor = (l) =>
      l.ruta === "/apoyos"
        ? { estado: 201, cuerpo: apoyoServidor(42, { uuid_cliente: "ap1" }) }
        : { estado: 201, cuerpo: apoyoServidor(42, { devoluciones: [{ id: 5, uuid_cliente: "d1", monto: 100, version: 1, apoyo_id: 42 }] }) };
    await sincronizar();
    expect(llamadas.map((l) => l.ruta)).toEqual(["/apoyos", "/apoyos/42/devoluciones"]);
    expect(llamadas[1].cuerpo).toMatchObject({ monto: 100, uuid_cliente: "d1" });
  });

  it("dos ediciones seguidas del mismo registro: la segunda se basa en la version que dejo la primera", async () => {
    await conocido(7, 3);
    await encolar(editar(7, { monto: 1 }, 3));
    await encolar(editar(7, { monto: 2 }, 3)); // el usuario aun no sabe en que version quedara
    const ops = await listarOperaciones();
    expect(ops[1].encadenada).toBe(true);
    expect(ops[1].versionBase).toBeNull();
    let v = 3;
    servidor = () => ({ estado: 200, cuerpo: movServidor(7, { version: ++v }) });
    await sincronizar();
    expect(llamadas.map((l) => l.cuerpo.version_base)).toEqual([3, 4]);
  });

  it("enviar una operacion aplica la respuesta del servidor a la copia local (version nueva)", async () => {
    await conocido(7, 1);
    await encolar(editar(7, { monto: 8 }));
    servidor = () => ({ estado: 200, cuerpo: movServidor(7, { monto: 8, version: 2 }) });
    await sincronizar();
    expect((await ent.leerMovimiento(7))?.version).toBe(2);
  });
});

describe("sin conexion y reintento", () => {
  it("sin conexion se detiene y conserva TODO (sin perder ni duplicar)", async () => {
    await encolar(gasto(10));
    await encolar(gasto(20));
    servidor = () => "red";
    const r = await sincronizar();
    expect(llamadas).toHaveLength(1); // no insiste con los demas
    expect(r).toMatchObject({ enviados: 0, quedan: 2, sinConexion: true });
    expect(await cantidadEnCola()).toBe(2);
  });

  it("si se corta a la mitad, lo ya enviado sale de la cola y lo demas queda", async () => {
    await encolar(gasto(10));
    await encolar(gasto(20));
    await encolar(gasto(30));
    let n = 0;
    servidor = () => (++n === 1 ? { estado: 201, cuerpo: movServidor(1) } : "red");
    const r = await sincronizar();
    expect(r).toMatchObject({ enviados: 1, quedan: 2, sinConexion: true });
    expect((await listarOperaciones()).map((o) => o.datos.monto)).toEqual([20, 30]);
  });

  it("el reintento envia la MISMA operacion (mismo UUID de operacion y de registro): base de la idempotencia", async () => {
    const { operacion } = await encolar(gasto(10, "uuid-fijo"));
    servidor = () => "red";
    await sincronizar();
    servidor = () => ({ estado: 200, cuerpo: movServidor(1) });
    await sincronizar();
    expect(llamadas.map((l) => l.cuerpo.uuid_cliente)).toEqual(["uuid-fijo", "uuid-fijo"]);
    expect(llamadas.map((l) => l.cabeceras["X-Operacion-Id"])).toEqual([operacion.id, operacion.id]);
    expect(await cantidadEnCola()).toBe(0);
  });

  it("conserva la operacion si la sesion vencio (401) o el servidor fallo (500, 429) y la cuenta como intento", async () => {
    await encolar(gasto(10));
    for (const estado of [401, 500, 429]) {
      servidor = () => ({ estado, cuerpo: { detail: "x" } });
      expect((await sincronizar()).quedan).toBe(1);
    }
    expect((await listarOperaciones())[0].intentos).toBeGreaterThanOrEqual(2);
    servidor = () => ({ estado: 201, cuerpo: movServidor(1) });
    expect((await sincronizar()).quedan).toBe(0);
  });

  it("avisa cuando la sesion vencio", async () => {
    await encolar(gasto(10));
    servidor = () => ({ estado: 401, cuerpo: { detail: "No autenticado" } });
    expect(await sincronizar()).toMatchObject({ sesionVencida: true, quedan: 1 });
  });

  it("no corre dos envios a la vez: lo pendiente se manda una sola vez", async () => {
    await encolar(gasto(10));
    let liberar: () => void = () => {};
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((res) => { liberar = () => res({ ok: true, status: 201, json: async () => movServidor(1) } as Response); }));
    const primera = sincronizar();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const segunda = sincronizar(); // mientras la primera sigue esperando
    liberar();
    const [a, b] = await Promise.all([primera, segunda]);
    expect(a.enviados).toBe(1);
    expect(b.enviados).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("conflictos (409 por version)", () => {
  const conflicto = (actual: unknown, version_actual = 2) => ({
    estado: 409,
    cuerpo: { detail: { codigo: "conflicto_version", mensaje: "El movimiento cambio en el servidor mientras tanto", version_actual, version_base: 1, actual } },
  });

  it("el servidor responde 409: la operacion se conserva EN CONFLICTO con ambas versiones y no se pierde nada", async () => {
    await conocido(7, 1);
    await encolar(editar(7, { monto: 99 }));
    servidor = () => conflicto(movServidor(7, { monto: 55, version: 2, editado_por_nombre: "Beto" }));
    const r = await sincronizar();
    expect(r).toMatchObject({ enviados: 0, conflictos: 1, rechazados: 0, quedan: 1 });
    const [op] = await listarOperaciones();
    expect(op.estado).toBe("conflicto");
    expect(op.datos).toEqual({ monto: 99 }); // lo del usuario sigue ahi
    expect(op.conflicto).toMatchObject({ versionActual: 2 });
    expect((op.conflicto!.actual as { monto: number }).monto).toBe(55); // y lo del servidor
    expect((await ent.leerMovimiento(7))?.version).toBe(2); // la base local pasa a ser la del servidor
    expect(await listarRechazos()).toHaveLength(0);
  });

  it("una operacion en conflicto no se reintenta sola, y bloquea lo siguiente sobre ese mismo registro", async () => {
    await conocido(7, 1);
    await conocido(8, 1);
    await encolar(editar(7, { monto: 99 }));
    await encolar({ entidad: "movimiento", accion: "anular", entidadId: 7, datos: {} }); // depende de la anterior
    await encolar(editar(8, { monto: 5 })); // otro registro: sigue su camino
    let n = 0;
    servidor = (l) => (l.ruta === "/movimientos/7" ? conflicto(movServidor(7, { version: 2 })) : { estado: 200, cuerpo: movServidor(8, { version: ++n + 1 }) });
    const r = await sincronizar();
    expect(r).toMatchObject({ enviados: 1, conflictos: 1, quedan: 2 });
    expect(llamadas.map((l) => l.ruta)).toEqual(["/movimientos/7", "/movimientos/8"]); // la anulacion del 7 espero
    llamadas = [];
    await sincronizar(); // otra pasada: el conflicto sigue esperando la decision del usuario
    expect(llamadas).toHaveLength(0);
  });

  it("'Usar la mia' vuelve a enviar la operacion sobre la version actual del servidor", async () => {
    await conocido(7, 1);
    await encolar(editar(7, { monto: 99 }));
    servidor = () => conflicto(movServidor(7, { monto: 55, version: 2 }));
    await sincronizar();
    const [op] = await listarOperaciones();
    llamadas = [];
    servidor = () => ({ estado: 200, cuerpo: movServidor(7, { monto: 99, version: 3 }) });
    await resolverConflicto(op.id, "mia");
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].cuerpo).toMatchObject({ monto: 99, version_base: 2 });
    expect(llamadas[0].cabeceras["X-Operacion-Id"]).toBe(op.id);
    expect(await cantidadEnCola()).toBe(0);
    expect((await ent.leerMovimiento(7))?.monto).toBe(99);
  });

  it("'Usar la del servidor' descarta lo mio sobre ese registro (y lo que dependia de ello), sin tocar lo demas", async () => {
    await conocido(7, 1);
    await conocido(8, 1);
    await encolar(editar(7, { monto: 99 }));
    await encolar({ entidad: "movimiento", accion: "anular", entidadId: 7, datos: {} });
    await encolar(editar(8, { monto: 5 }));
    servidor = (l) => (l.ruta === "/movimientos/7" ? conflicto(movServidor(7, { version: 2 })) : { estado: 200, cuerpo: movServidor(8, { version: 2 }) });
    await sincronizar();
    const enConflicto = (await listarOperaciones()).find((o) => o.estado === "conflicto")!;
    llamadas = [];
    await resolverConflicto(enConflicto.id, "servidor");
    expect(llamadas).toHaveLength(0); // no se manda nada: se queda con lo del servidor
    expect(await cantidadEnCola()).toBe(0); // el 8 ya se habia enviado; el 7 (edicion + anulacion) se descarto a pedido
  });

  it("el conflicto de una devolucion actualiza la devolucion dentro de su apoyo", async () => {
    await ent.guardarApoyos([apoyoServidor(3, { devoluciones: [{ id: 9, apoyo_id: 3, monto: 100, version: 1, anulado: false }] }) as never]);
    await encolar({ entidad: "devolucion", accion: "editar", entidadId: 9, apoyoId: 3, datos: { monto: 50 }, versionBase: 1 });
    servidor = () => conflicto({ id: 9, apoyo_id: 3, monto: 120, version: 2, anulado: false });
    await sincronizar();
    expect((await ent.leerApoyo(3))?.devoluciones[0]).toMatchObject({ monto: 120, version: 2 });
  });
});

describe("rechazos (403, 422...)", () => {
  it("si el servidor rechaza, se revierte (sale de la cola), se guarda en 'No se pudo sincronizar' CON el motivo y sigue con el resto", async () => {
    await encolar(gasto(10));
    await encolar(gasto(20));
    let n = 0;
    servidor = () => (++n === 1 ? { estado: 403, cuerpo: { detail: "Solo puedes modificar lo que registraste tú" } } : { estado: 201, cuerpo: movServidor(2) });
    const r = await sincronizar();
    expect(r).toMatchObject({ enviados: 1, rechazados: 1, quedan: 0 });
    const rechazos = await listarRechazos();
    expect(rechazos).toHaveLength(1);
    expect(rechazos[0]).toMatchObject({ motivo: "Solo puedes modificar lo que registraste tú", estado: 403 });
    expect(rechazos[0].operacion.datos.monto).toBe(10); // nada se descarta en silencio: queda lo que el usuario hizo
    expect(await cantidadEnCola()).toBe(0);
  });

  it("una regla de negocio (400/422) tambien se rechaza con su motivo", async () => {
    await encolar({ entidad: "devolucion", accion: "crear", uuid: "d1", apoyoId: 3, datos: { monto: 999, fecha: "2026-11-07", nota: null } });
    servidor = () => ({ estado: 400, cuerpo: { detail: "La devolucion supera lo pendiente (Bs 10.00)" } });
    await sincronizar();
    expect((await listarRechazos())[0].motivo).toContain("supera lo pendiente");
  });

  it("si se rechaza la creacion de un apoyo, lo que dependia de el tambien se rechaza con motivo (no queda colgado)", async () => {
    await encolar(apoyo(300, "ap1"));
    await encolar({ entidad: "devolucion", accion: "crear", uuid: "d1", apoyoUuid: "ap1", datos: { monto: 100, fecha: "2026-11-07", nota: null } });
    servidor = () => ({ estado: 422, cuerpo: { detail: "Dato invalido" } });
    const r = await sincronizar();
    expect(r.rechazados).toBe(2);
    expect(llamadas).toHaveLength(1); // la devolucion ni se intento enviar
    const rechazos = await listarRechazos();
    expect(rechazos).toHaveLength(2);
    expect(rechazos[1].motivo).toContain("Depende de un registro que no se pudo sincronizar");
    expect(await cantidadEnCola()).toBe(0);
  });

  it("el usuario descarta el aviso de un rechazo cuando lo leyo", async () => {
    await encolar(gasto(10));
    servidor = () => ({ estado: 422, cuerpo: { detail: "Dato invalido" } });
    await sincronizar();
    const [r] = await listarRechazos();
    await descartarRechazo(r.id);
    expect(await listarRechazos()).toHaveLength(0);
  });

  it("si el usuario esta esperando la respuesta, el rechazo se le muestra a el (error) y no va a la lista", async () => {
    servidor = () => ({ estado: 422, cuerpo: { detail: "La categoría está desactivada" } });
    const { resultado } = await ejecutar(gasto(10));
    expect(resultado).toEqual({ tipo: "rechazada", estado: 422, motivo: "La categoría está desactivada" });
    expect(await listarRechazos()).toHaveLength(0);
    expect(await cantidadEnCola()).toBe(0);
  });
});

describe("ejecutar (enviar ahora o dejar pendiente)", () => {
  it("con conexion: se aplica al instante y la respuesta del servidor vuelve al que la pidio", async () => {
    servidor = () => ({ estado: 201, cuerpo: movServidor(5) });
    const { resultado } = await ejecutar(gasto(10));
    expect(resultado.tipo).toBe("aplicada");
    expect(await cantidadEnCola()).toBe(0);
  });

  it("sin conexion: queda pendiente", async () => {
    servidor = () => "red";
    const { resultado } = await ejecutar(gasto(10));
    expect(resultado).toEqual({ tipo: "pendiente" });
    expect(await cantidadEnCola()).toBe(1);
  });

  it("un conflicto al editar estando en linea se avisa al instante y queda para decidir", async () => {
    await conocido(7, 1);
    servidor = () => ({ estado: 409, cuerpo: { detail: { codigo: "conflicto_version", mensaje: "cambio", version_actual: 2, version_base: 1, actual: movServidor(7, { version: 2 }) } } });
    const { resultado } = await ejecutar(editar(7, { monto: 1 }));
    expect(resultado.tipo).toBe("conflicto");
    expect((await listarOperaciones())[0].estado).toBe("conflicto");
  });

  it("editar lo creado sin internet cuando vuelve la conexion: se manda la creacion ya con el valor final", async () => {
    servidor = () => "red";
    await ejecutar(gasto(10, "u1"));
    const r = await ejecutar({ entidad: "movimiento", accion: "editar", uuid: "u1", datos: { monto: 44 } });
    expect(r.fusionada).toBe(true);
    expect(r.resultado.tipo).toBe("pendiente");
    servidor = () => ({ estado: 201, cuerpo: movServidor(1, { monto: 44 }) });
    llamadas = [];
    await sincronizar();
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].cuerpo.monto).toBe(44);
  });
});

describe("referencias temporales", () => {
  it("un registro creado sin internet se identifica con un id negativo; al sincronizarse ese id sigue llevando al registro real", async () => {
    const { operacion } = await encolar(gasto(10, "u1"));
    expect(await resolverReferencia("movimiento", -operacion.seq)).toEqual({ id: null, uuid: "u1" });
    servidor = () => ({ estado: 201, cuerpo: movServidor(88, { uuid_cliente: "u1" }) });
    await sincronizar();
    expect(await resolverReferencia("movimiento", -operacion.seq)).toEqual({ id: 88, uuid: null });
    expect(await resolverReferencia("movimiento", 5)).toEqual({ id: 5, uuid: null });
    await expect(resolverReferencia("movimiento", -9999)).rejects.toBeInstanceOf(ErrorApi);
  });
});
