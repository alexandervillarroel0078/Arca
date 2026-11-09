// Lo pendiente se ve encima de lo ultimo que se sabe del servidor (listas y totales estimados).
import { describe, expect, it } from "vitest";
import type { Apoyo } from "../apoyos/api";
import type { Movimiento } from "../movimientos/api";
import type { Resumen } from "../reportes/api";
import type { Operacion } from "./tipos";
import {
  aplicarOperaciones, superponerActividad, superponerApoyos, superponerMovimientos, superponerResumen, superponerResumenApoyos,
  type Entorno, type Local,
} from "./superponer";

const env = (ids: Record<string, number> = {}): Entorno => ({
  yo: { id: 1, nombre: "Ana" },
  categorias: [
    { id: 2, nombre: "Comida", icono: "utensils", activa: true },
    { id: 3, nombre: "Transporte", icono: "bus", activa: true },
  ],
  ids,
});

let seq = 0;
const op = (c: Partial<Operacion>): Operacion => ({
  seq: ++seq, id: `op-${seq}`, entidad: "movimiento", accion: "crear", uuid: null, entidadId: null, apoyoId: null, apoyoUuid: null,
  datos: {}, versionBase: null, encadenada: false, fechaCliente: "2026-11-07T10:00:00.000Z", estado: "pendiente", intentos: 0, ...c,
});

const aud = { version: 1, uuid_cliente: null, anulado: false, anulado_por_nombre: null, anulado_en: null, motivo_anulacion: null, editado_por_nombre: null, editado_en: null };
const mov = (id: number, c: Partial<Movimiento> = {}): Movimiento => ({
  id, tipo: "gasto", monto: 10, fecha: "2026-11-05", categoria_id: 2, categoria_nombre: "Comida", categoria_icono: "utensils", nota: `m${id}`,
  usuario_id: 1, usuario_nombre: "Ana", ...aud, ...c,
});
const apoyo = (id: number, c: Partial<Apoyo> = {}): Apoyo => ({
  id, beneficiario: "Tia Rosa", monto: 300, fecha: "2026-11-02", nota: null, usuario_id: 1, usuario_nombre: "Ana", devuelto: 0, consumido: 0,
  pendiente: 300, estado: "Pendiente", devoluciones: [], devoluciones_activas: 0, ...aud, ...c,
});
const mapa = (...xs: Local[]) => new Map<string, Local>(xs.map((x) => [`${"tipo" in x ? "movimiento" : "apoyo"}:${x.id}`, x]));
const NOV = { desde: "2026-11-01", hasta: "2026-11-30" };
const cmp = { anterior: 0, diferencia: 0, porcentaje: null };
const resumen = (c: Partial<Resumen> = {}): Resumen => ({
  mes: "2026-11", desde: NOV.desde, hasta: NOV.hasta,
  comparacion: { desde: "2026-10-01", hasta: "2026-10-31", etiqueta: "vs octubre 2026", ingresos: { ...cmp }, gastos: { ...cmp }, saldo: { ...cmp } },
  ingresos: 1000, gastos: 200, apoyos_entregados: 300, devoluciones: 0, saldo: 500, consumido: 0, gasto_familiar_total: 200,
  apoyos_pendientes_total: 300, apoyos_pendientes_cantidad: 1, ...c,
});
const gastoNuevo = (monto: number, uuid = `g${monto}`) => op({ entidad: "movimiento", accion: "crear", uuid, datos: { tipo: "gasto", monto, fecha: "2026-11-07", categoria_id: 3, nota: "nuevo" } });

describe("registros creados sin internet", () => {
  it("aparecen en la lista con id temporal negativo, marcados como sin enviar, con su categoria", () => {
    const o = gastoNuevo(25);
    const ap = aplicarOperaciones(mapa(mov(1)), [o], env());
    const lista = superponerMovimientos([mov(1)], ap, NOV);
    expect(lista).toHaveLength(2);
    expect(lista[0]).toMatchObject({ id: -o.seq, monto: 25, categoria_nombre: "Transporte", usuario_nombre: "Ana", sinSincronizar: true, uuid_cliente: "g25" });
  });

  it("no se duplican si el servidor ya los trae (mismo uuid) ni si ya se sincronizaron (id conocido)", () => {
    const o = gastoNuevo(25, "u9");
    const yaEnLista = superponerMovimientos([mov(77, { uuid_cliente: "u9" })], aplicarOperaciones(new Map(), [o], env()), NOV);
    expect(yaEnLista.map((m) => m.id)).toEqual([77]);
    const sincronizado = superponerMovimientos([mov(77, { uuid_cliente: "u9" })], aplicarOperaciones(mapa(mov(77)), [o], env({ "movimiento:u:u9": 77 })), NOV);
    expect(sincronizado.map((m) => m.id)).toEqual([77]);
  });

  it("no aparecen en el mes equivocado ni los anulados", () => {
    const octubre = op({ entidad: "movimiento", accion: "crear", uuid: "o", datos: { tipo: "gasto", monto: 1, fecha: "2026-10-30", categoria_id: 2, nota: null } });
    expect(superponerMovimientos([], aplicarOperaciones(new Map(), [octubre], env()), NOV)).toHaveLength(0);
    const anulado = op({ entidad: "movimiento", accion: "crear", uuid: "a", datos: { tipo: "gasto", monto: 1, fecha: "2026-11-07", categoria_id: 2, nota: null, anulado: true } });
    expect(superponerMovimientos([], aplicarOperaciones(new Map(), [anulado], env()), NOV)).toHaveLength(0);
  });

  it("editar / anular lo creado sin internet (cuando no se fusiono) se aplica en orden", () => {
    const c = gastoNuevo(25, "u1");
    const e = op({ entidad: "movimiento", accion: "editar", uuid: "u1", datos: { monto: 40 } });
    const a = op({ entidad: "movimiento", accion: "anular", uuid: "u1", datos: { motivo: "x" } });
    const fin = aplicarOperaciones(new Map(), [c, e, a], env()).finales.get(`movimiento:${-c.seq}`) as Movimiento;
    expect(fin).toMatchObject({ monto: 40, anulado: true, motivo_anulacion: "x" });
  });
});

describe("cambios sobre registros del servidor", () => {
  it("editar cambia lo que se ve (monto, categoria con su nombre) y marca el registro", () => {
    const e = op({ entidad: "movimiento", accion: "editar", entidadId: 1, datos: { monto: 99, categoria_id: 3 } });
    const [m] = superponerMovimientos([mov(1)], aplicarOperaciones(mapa(mov(1)), [e], env()), NOV);
    expect(m).toMatchObject({ monto: 99, categoria_nombre: "Transporte", sinSincronizar: true, editado_por_nombre: "Ana" });
  });

  it("pasar a ingreso limpia la categoria", () => {
    const e = op({ entidad: "movimiento", accion: "editar", entidadId: 1, datos: { tipo: "ingreso" } });
    const [m] = superponerMovimientos([mov(1)], aplicarOperaciones(mapa(mov(1)), [e], env()), NOV);
    expect(m).toMatchObject({ tipo: "ingreso", categoria_id: null, categoria_nombre: null });
  });

  it("anular lo saca de la lista de Inicio; reactivar lo devuelve", () => {
    const a = op({ entidad: "movimiento", accion: "anular", entidadId: 1, datos: {} });
    expect(superponerMovimientos([mov(1), mov(2)], aplicarOperaciones(mapa(mov(1), mov(2)), [a], env()), NOV).map((m) => m.id)).toEqual([2]);
    const r = op({ entidad: "movimiento", accion: "reactivar", entidadId: 3, datos: {} });
    const base = mov(3, { anulado: true });
    expect(superponerMovimientos([], aplicarOperaciones(mapa(base), [r], env()), NOV).map((m) => m.id)).toEqual([3]);
  });

  it("la lista conserva el orden: fecha mas reciente primero, y lo nuevo sin enviar antes de lo del mismo dia", () => {
    const lista = [mov(1, { fecha: "2026-11-07" }), mov(2, { fecha: "2026-11-03" })];
    const o = gastoNuevo(5); // fecha 2026-11-07
    expect(superponerMovimientos(lista, aplicarOperaciones(mapa(...lista), [o], env()), NOV).map((m) => m.id)).toEqual([-o.seq, 1, 2]);
  });

  it("un cambio de un registro desconocido no rompe nada", () => {
    const e = op({ entidad: "movimiento", accion: "editar", entidadId: 404, datos: { monto: 1 } });
    expect(superponerMovimientos([mov(1)], aplicarOperaciones(new Map(), [e], env()), NOV)).toEqual([mov(1)]);
  });

  it("un registro cuyo cambio esta en conflicto se marca", () => {
    const e = op({ entidad: "movimiento", accion: "editar", entidadId: 1, datos: { monto: 5 }, estado: "conflicto" });
    const [m] = superponerMovimientos([mov(1)], aplicarOperaciones(mapa(mov(1)), [e], env()), NOV);
    expect(m.enConflicto).toBe(true);
  });
});

describe("apoyos y devoluciones", () => {
  it("una devolucion nueva baja el pendiente y puede dejar el apoyo Saldado", () => {
    const d = op({ entidad: "devolucion", accion: "crear", uuid: "d1", apoyoId: 1, datos: { monto: 100, fecha: "2026-11-07", nota: null } });
    const [a] = superponerApoyos([apoyo(1)], aplicarOperaciones(mapa(apoyo(1)), [d], env()), false);
    expect(a).toMatchObject({ devuelto: 100, pendiente: 200, estado: "Pendiente", devoluciones_activas: 1 });
    expect(a.devoluciones[0]).toMatchObject({ id: -d.seq, monto: 100, sinSincronizar: true });
    const d2 = op({ entidad: "devolucion", accion: "crear", uuid: "d2", apoyoId: 1, datos: { monto: 200, fecha: "2026-11-07", nota: null } });
    const [todo] = superponerApoyos([apoyo(1)], aplicarOperaciones(mapa(apoyo(1)), [d, d2], env()), false);
    expect(todo).toMatchObject({ pendiente: 0, estado: "Saldado" });
  });

  it("la devolucion de un apoyo creado sin internet funciona (el UUID lo genera el cliente)", () => {
    const c = op({ entidad: "apoyo", accion: "crear", uuid: "ap1", datos: { beneficiario: "Primo", monto: 200, fecha: "2026-11-07", nota: null } });
    const d = op({ entidad: "devolucion", accion: "crear", uuid: "d1", apoyoUuid: "ap1", datos: { monto: 50, fecha: "2026-11-07", nota: null } });
    const [a] = superponerApoyos([], aplicarOperaciones(new Map(), [c, d], env()), false);
    expect(a).toMatchObject({ id: -c.seq, beneficiario: "Primo", devuelto: 50, pendiente: 150, sinSincronizar: true });
    expect(a.devoluciones).toHaveLength(1);
  });

  it("anular un apoyo anula en cascada sus devoluciones; reactivarlo las devuelve", () => {
    const dev = { id: 9, apoyo_id: 1, monto: 100, fecha: "2026-11-03", nota: null, usuario_id: 1, usuario_nombre: "Ana", anulada_con_apoyo: false, ...aud };
    const base = apoyo(1, { devuelto: 100, pendiente: 200, devoluciones: [dev], devoluciones_activas: 1 });
    const anular = op({ entidad: "apoyo", accion: "anular", entidadId: 1, datos: { motivo: "m" } });
    const [anulado] = superponerApoyos([base], aplicarOperaciones(mapa(base), [anular], env()), true);
    expect(anulado).toMatchObject({ anulado: true, estado: "Anulado", devuelto: 0, pendiente: 0, devoluciones_activas: 0 });
    expect(anulado.devoluciones[0]).toMatchObject({ anulado: true, anulada_con_apoyo: true });
    const reactivar = op({ entidad: "apoyo", accion: "reactivar", entidadId: 1, datos: {} });
    const [vuelve] = superponerApoyos([base], aplicarOperaciones(mapa(base), [anular, reactivar], env()), true);
    expect(vuelve).toMatchObject({ anulado: false, devuelto: 100, pendiente: 200, estado: "Pendiente" });
    expect(vuelve.devoluciones[0].anulado).toBe(false);
  });

  it("sin 'ver anulados' no se muestran apoyos anulados ni devoluciones anuladas", () => {
    const anular = op({ entidad: "apoyo", accion: "anular", entidadId: 1, datos: {} });
    expect(superponerApoyos([apoyo(1), apoyo(2)], aplicarOperaciones(mapa(apoyo(1), apoyo(2)), [anular], env()), false).map((a) => a.id)).toEqual([2]);
  });

  it("anular una devolucion la saca del devuelto", () => {
    const dev = { id: 9, apoyo_id: 1, monto: 100, fecha: "2026-11-03", nota: null, usuario_id: 1, usuario_nombre: "Ana", anulada_con_apoyo: false, ...aud };
    const base = apoyo(1, { devuelto: 100, pendiente: 200, devoluciones: [dev], devoluciones_activas: 1 });
    const o = op({ entidad: "devolucion", accion: "anular", entidadId: 9, apoyoId: 1, datos: { motivo: null } });
    const [a] = superponerApoyos([base], aplicarOperaciones(mapa(base), [o], env()), true);
    expect(a).toMatchObject({ devuelto: 0, pendiente: 300, devoluciones_activas: 0 });
    expect(a.devoluciones[0].anulado).toBe(true);
  });

  it("un apoyo conocido solo por la lista completa (sin devoluciones) conserva lo devuelto al editarlo", () => {
    const parcial = apoyo(1, { devuelto: 100, pendiente: 200, devoluciones_activas: 1, devoluciones: [] });
    const e = op({ entidad: "apoyo", accion: "editar", entidadId: 1, datos: { monto: 500 } });
    const [a] = superponerApoyos([parcial], aplicarOperaciones(mapa(parcial), [e], env()), false);
    expect(a).toMatchObject({ monto: 500, devuelto: 100, pendiente: 400 });
  });
});

describe("lista completa", () => {
  it("aplica los filtros: lo nuevo solo entra si cumple (mes, tipo, persona) y solo en la primera pagina", () => {
    const o = gastoNuevo(25);
    const ap = aplicarOperaciones(new Map(), [o], env());
    const f = { ...NOV, usuario: "", tipo: "", categoria: "", verAnulados: false };
    expect(superponerActividad([], ap, f, true)).toHaveLength(1);
    expect(superponerActividad([], ap, f, false)).toHaveLength(0);
    expect(superponerActividad([], ap, { ...f, tipo: "ingreso" }, true)).toHaveLength(0);
    expect(superponerActividad([], ap, { ...f, desde: "2026-10-01", hasta: "2026-10-31" }, true)).toHaveLength(0);
    expect(superponerActividad([], ap, { ...f, usuario: "2" }, true)).toHaveLength(0);
    expect(superponerActividad([], ap, { ...f, categoria: "3" }, true)).toHaveLength(1);
  });

  it("muestra movimientos y apoyos con el titulo de la lista y 'ver anulados' los incluye", () => {
    const anular = op({ entidad: "movimiento", accion: "anular", entidadId: 1, datos: {} });
    const ap = aplicarOperaciones(mapa(mov(1)), [anular], env());
    const f = { desde: "", hasta: "", usuario: "", tipo: "", categoria: "", verAnulados: false };
    expect(superponerActividad([], ap, f, true)).toHaveLength(0);
    const conAnulados = superponerActividad([], ap, { ...f, verAnulados: true }, true);
    expect(conAnulados[0]).toMatchObject({ clase: "movimiento", anulado: true, titulo: "m1" });
  });
});

describe("totales estimados", () => {
  it("un gasto nuevo sin enviar baja el saldo y sube los gastos; un ingreso lo sube", () => {
    const g = gastoNuevo(25);
    const i = op({ entidad: "movimiento", accion: "crear", uuid: "i", datos: { tipo: "ingreso", monto: 100, fecha: "2026-11-07", categoria_id: null, nota: null } });
    const r = superponerResumen(resumen(), aplicarOperaciones(new Map(), [g, i], env()), NOV);
    expect(r).toMatchObject({ gastos: 225, ingresos: 1100, saldo: 575, gasto_familiar_total: 225 });
  });

  it("editar el monto de un gasto ajusta solo la diferencia; anularlo lo quita", () => {
    const e = op({ entidad: "movimiento", accion: "editar", entidadId: 1, datos: { monto: 60 } });
    expect(superponerResumen(resumen(), aplicarOperaciones(mapa(mov(1)), [e], env()), NOV)).toMatchObject({ gastos: 250, saldo: 450 });
    const a = op({ entidad: "movimiento", accion: "anular", entidadId: 1, datos: {} });
    expect(superponerResumen(resumen(), aplicarOperaciones(mapa(mov(1)), [a], env()), NOV)).toMatchObject({ gastos: 190, saldo: 510 });
  });

  it("no toca los totales de otro mes", () => {
    const octubre = op({ entidad: "movimiento", accion: "crear", uuid: "o", datos: { tipo: "gasto", monto: 50, fecha: "2026-10-30", categoria_id: 2, nota: null } });
    const r = resumen();
    expect(superponerResumen(r, aplicarOperaciones(new Map(), [octubre], env()), NOV)).toBe(r);
  });

  it("un apoyo nuevo y una devolucion mueven apoyos entregados, devoluciones, saldo y pendientes", () => {
    const base = apoyo(1);
    const d = op({ entidad: "devolucion", accion: "crear", uuid: "d1", apoyoId: 1, datos: { monto: 100, fecha: "2026-11-07", nota: null } });
    const nuevo = op({ entidad: "apoyo", accion: "crear", uuid: "n", datos: { beneficiario: "Primo", monto: 80, fecha: "2026-11-07", nota: null } });
    const r = superponerResumen(resumen(), aplicarOperaciones(mapa(base), [d, nuevo], env()), NOV);
    expect(r).toMatchObject({ apoyos_entregados: 380, devoluciones: 100, saldo: 500 - 80 + 100, apoyos_pendientes_total: 300 - 100 + 80 });
  });

  it("anular un apoyo quita su entrega, su devuelto y su pendiente", () => {
    const dev = { id: 9, apoyo_id: 1, monto: 100, fecha: "2026-11-03", nota: null, usuario_id: 1, usuario_nombre: "Ana", anulada_con_apoyo: false, ...aud };
    const base = apoyo(1, { devuelto: 100, pendiente: 200, devoluciones: [dev], devoluciones_activas: 1 });
    const r0 = resumen({ apoyos_entregados: 300, devoluciones: 100, saldo: 800, apoyos_pendientes_total: 200 });
    const a = op({ entidad: "apoyo", accion: "anular", entidadId: 1, datos: {} });
    expect(superponerResumen(r0, aplicarOperaciones(mapa(base), [a], env()), NOV)).toMatchObject({
      apoyos_entregados: 0, devoluciones: 0, saldo: 800 + 300 - 100, apoyos_pendientes_total: 0, apoyos_pendientes_cantidad: 0,
    });
  });

  it("sin cambios pendientes devuelve exactamente el mismo resumen", () => {
    const r = resumen();
    expect(superponerResumen(r, aplicarOperaciones(new Map(), [], env()), NOV)).toBe(r);
  });

  it("Apoyos: totales por beneficiario con el estado recalculado, filas nuevas y filas que desaparecen", () => {
    const base = { total_entregado: 300, total_devuelto: 0, total_consumido: 0, total_pendiente: 300, beneficiarios: [{ beneficiario: "Tia Rosa", entregado: 300, devuelto: 0, consumido: 0, pendiente: 300, estado: "Pendiente" as const, cantidad_apoyos: 1, entregado_periodo: 300, devuelto_periodo: 0 }], total_entregado_periodo: 300, total_devuelto_periodo: 0 };
    const d = op({ entidad: "devolucion", accion: "crear", uuid: "d1", apoyoId: 1, datos: { monto: 300, fecha: "2026-11-07", nota: null } });
    const nuevo = op({ entidad: "apoyo", accion: "crear", uuid: "n", datos: { beneficiario: "Primo", monto: 80, fecha: "2026-11-07", nota: null } });
    const r = superponerResumenApoyos(base, aplicarOperaciones(mapa(apoyo(1)), [d, nuevo], env()));
    expect(r.total_entregado).toBe(380);
    expect(r.total_devuelto).toBe(300);
    expect(r.total_pendiente).toBe(80);
    expect(r.beneficiarios.map((b) => [b.beneficiario, b.estado])).toEqual([["Primo", "Pendiente"], ["Tia Rosa", "Saldado"]]); // pendientes primero
    const anular = op({ entidad: "apoyo", accion: "anular", entidadId: 1, datos: {} });
    expect(superponerResumenApoyos(base, aplicarOperaciones(mapa(apoyo(1)), [anular], env())).beneficiarios).toHaveLength(0);
    expect(superponerResumenApoyos(base, aplicarOperaciones(new Map(), [], env()))).toBe(base);
  });
});
