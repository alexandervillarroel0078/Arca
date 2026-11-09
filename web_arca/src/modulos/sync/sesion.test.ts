// Seguridad: el cache y la cola se borran al cerrar sesion; la cola nunca se envia a otra cuenta.
import { beforeEach, describe, expect, it } from "vitest";
import * as almacen from "../../core/almacen";
import { instalarServidorFalso, movServidor } from "../../test/servidorFalso";
import { leerCache } from "./cache";
import { cantidadEnCola, encolar, listarRechazos, sincronizar } from "./cola";
import * as ent from "./entidades";
import { borrarTodoLocal, olvidarCacheDeSesionVencida, prepararSesion } from "./sesion";

let sv: ReturnType<typeof instalarServidorFalso>;
beforeEach(() => {
  sv = instalarServidorFalso();
});

async function llenar() {
  await almacen.poner("cache", { clave: "resumen:2026-11", datos: { saldo: 1 }, guardado: Date.now() });
  await ent.guardarMovimientos([movServidor(1) as never]);
  await encolar({ entidad: "movimiento", accion: "crear", uuid: "u1", datos: { tipo: "gasto", monto: 5, fecha: "2026-11-07", categoria_id: 2, nota: null } });
  await prepararSesion(1);
}

describe("cerrar sesion", () => {
  it("borra TODO: cache, registros conocidos, cola y rechazos", async () => {
    await llenar();
    sv.responder = () => ({ estado: 422, cuerpo: { detail: "x" } });
    await sincronizar(); // deja un rechazo
    await encolar({ entidad: "movimiento", accion: "crear", uuid: "u2", datos: { tipo: "gasto", monto: 6, fecha: "2026-11-07", categoria_id: 2, nota: null } });
    expect(await listarRechazos()).toHaveLength(1);
    await borrarTodoLocal();
    expect(await leerCache("resumen:2026-11")).toBeUndefined();
    expect(await ent.leerMovimiento(1)).toBeUndefined();
    expect(await cantidadEnCola()).toBe(0);
    expect(await listarRechazos()).toHaveLength(0);
    expect(await almacen.todos("meta")).toHaveLength(0);
  });

  it("borra tambien la cola de versiones anteriores que vivia en localStorage", async () => {
    localStorage.setItem("arca-cola", "[{}]");
    await borrarTodoLocal();
    expect(localStorage.getItem("arca-cola")).toBeNull();
  });
});

describe("la sesion vencio (no fue el usuario)", () => {
  it("se borra el cache pero se CONSERVAN los cambios sin enviar (son trabajo del usuario)", async () => {
    await llenar();
    await olvidarCacheDeSesionVencida();
    expect(await leerCache("resumen:2026-11")).toBeUndefined();
    expect(await ent.leerMovimiento(1)).toBeUndefined();
    expect(await cantidadEnCola()).toBe(1);
  });

  it("la misma persona vuelve a entrar y su cola sigue ahi", async () => {
    await llenar();
    await olvidarCacheDeSesionVencida();
    expect(await prepararSesion(1)).toBe(0);
    expect(await cantidadEnCola()).toBe(1);
  });
});

describe("entra otra cuenta en el mismo aparato", () => {
  it("lo guardado de la cuenta anterior se descarta (NUNCA se envia como si fuera de la nueva) y se dice cuantos cambios eran", async () => {
    await llenar();
    expect(await prepararSesion(2)).toBe(1);
    expect(await cantidadEnCola()).toBe(0);
    expect(await leerCache("resumen:2026-11")).toBeUndefined();
    sv.responder = () => ({ estado: 201, cuerpo: movServidor(9) });
    await sincronizar();
    expect(sv.llamadas).toHaveLength(0); // no se mando nada del usuario anterior
  });

  it("primer uso: no descarta nada y recuerda al dueno", async () => {
    expect(await prepararSesion(5)).toBe(0);
    await encolar({ entidad: "movimiento", accion: "crear", uuid: "u", datos: { tipo: "gasto", monto: 1, fecha: "2026-11-07", categoria_id: 2, nota: null } });
    expect(await prepararSesion(5)).toBe(0);
    expect(await cantidadEnCola()).toBe(1);
  });
});
