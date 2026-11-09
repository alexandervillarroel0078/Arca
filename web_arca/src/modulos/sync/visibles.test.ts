// Fase 17: lo que dejo de ser visible se olvida del telefono (entidades y cache), no se queda "guardado".
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as almacen from "../../core/almacen";
import { instalarServidorFalso, movServidor } from "../../test/servidorFalso";
import * as ent from "./entidades";
import { reconciliarVisibles } from "./visibles";

let sv: ReturnType<typeof instalarServidorFalso>;
beforeEach(() => {
  sv = instalarServidorFalso();
  localStorage.setItem("arca-token", "t");
  vi.stubEnv("VITE_API_URL", "http://x");
});

const visibles = (movimientos: number[], apoyos: number[] = []) => {
  sv.responder = () => ({ estado: 200, cuerpo: { movimientos, apoyos } });
};
const cache = (clave: string, datos: unknown, guardado = 1) => almacen.poner("cache", { clave, datos, guardado });

describe("reconciliarVisibles", () => {
  it("si todo sigue visible no toca nada", async () => {
    await ent.guardarMovimientos([movServidor(1), movServidor(2)] as never);
    await cache("movimientos:a", [{ id: 1 }, { id: 2 }]);
    visibles([1, 2]);
    expect(await reconciliarVisibles()).toBe(0);
    expect(await ent.leerMovimiento(1)).toBeDefined();
    expect((await almacen.todos("cache")).length).toBe(1);
  });

  it("lo que alguien paso a privado se olvida de los registros conocidos y del cache de listas y totales", async () => {
    await ent.guardarMovimientos([movServidor(1, { nota: "Cena secreta" }), movServidor(2)] as never);
    await cache("movimientos:a", [{ id: 1, nota: "Cena secreta" }, { id: 2 }]);
    await cache("resumen:mes:x", { gastos: 20 });
    await cache("apoyos:false", []);
    await cache("categorias", [{ id: 1 }]); // no depende de los registros: se conserva
    visibles([2]);
    expect(await reconciliarVisibles()).toBe(1);
    expect(await ent.leerMovimiento(1)).toBeUndefined();
    expect(await ent.leerMovimiento(2)).toBeDefined();
    const claves = (await almacen.todos<{ clave: string }>("cache")).map((c) => c.clave);
    expect(claves).toEqual(["categorias"]);
    expect(JSON.stringify(await almacen.todos("cache"))).not.toContain("Cena secreta");
    expect(JSON.stringify(await almacen.todos("entidades"))).not.toContain("Cena secreta");
  });

  it("detecta lo perdido por la lista anterior aunque el telefono no guardara el registro suelto", async () => {
    visibles([1, 2]);
    await reconciliarVisibles(); // primera vez: guarda la lista
    await cache("resumen:mes:x", { gastos: 20 });
    visibles([2]);
    expect(await reconciliarVisibles()).toBe(1);
    expect(await almacen.todos("cache")).toHaveLength(0);
  });

  it("avisa a las pantallas abiertas para que se vuelvan a leer", async () => {
    await ent.guardarMovimientos([movServidor(1)] as never);
    const oyente = vi.fn();
    window.addEventListener("arca-datos-nuevos", oyente);
    visibles([]);
    await reconciliarVisibles();
    window.removeEventListener("arca-datos-nuevos", oyente);
    expect(oyente).toHaveBeenCalledTimes(1);
  });

  it("no toca la cola de cambios pendientes ni los registros creados sin internet (id negativo)", async () => {
    await almacen.poner("cola", { id: "op1", entidad: "movimiento", accion: "crear", datos: {}, estado: "pendiente" });
    await ent.guardarMovimientos([movServidor(1), movServidor(-3)] as never);
    visibles([]);
    await reconciliarVisibles();
    expect(await almacen.todos("cola")).toHaveLength(1);
    expect(await ent.leerMovimiento(-3)).toBeDefined();
  });

  it("sin conexion lanza el error y no borra nada", async () => {
    await ent.guardarMovimientos([movServidor(1)] as never);
    sv.responder = () => "red";
    await expect(reconciliarVisibles()).rejects.toThrow();
    expect(await ent.leerMovimiento(1)).toBeDefined();
  });
});
