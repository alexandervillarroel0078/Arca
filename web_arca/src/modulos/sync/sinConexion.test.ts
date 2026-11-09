// Las pantallas (Inicio, Apoyos, Lista, Reportes, Familia) cargan sin internet con lo ultimo guardado, y crear / editar /
// anular / reactivar movimientos, apoyos y devoluciones funcionan sin conexion (a traves de los modulos api.ts).
import { beforeEach, describe, expect, it } from "vitest";
import { ErrorApi, ErrorRed } from "../../core/api";
import { instalarServidorFalso, movServidor } from "../../test/servidorFalso";
import * as apoyos from "../apoyos/api";
import * as familia from "../familia/api";
import * as movs from "../movimientos/api";
import { listarActividad } from "../movimientos/actividad";
import { registrar } from "../movimientos/registrar";
import * as reportes from "../reportes/api";
import { cantidadEnCola, listarOperaciones, sincronizar } from "./cola";
import { datosDeCache } from "./cache";

let sv: ReturnType<typeof instalarServidorFalso>;
let enLinea = true;
const apoyoSrv = (id: number, c: Record<string, unknown> = {}) => ({
  id, beneficiario: "Tia Rosa", monto: 300, fecha: "2026-11-02", nota: null, usuario_id: 1, usuario_nombre: "Ana", devuelto: 0, consumido: 0,
  pendiente: 300, estado: "Pendiente", devoluciones: [], devoluciones_activas: 0, version: 1, uuid_cliente: null, anulado: false,
  anulado_por_nombre: null, anulado_en: null, motivo_anulacion: null, editado_por_nombre: null, editado_en: null, ...c,
});
const resumen = { mes: "2026-11", ingresos: 1000, gastos: 10, apoyos_entregados: 300, devoluciones: 0, saldo: 690, consumido: 0, gasto_familiar_total: 10, apoyos_pendientes_total: 300, apoyos_pendientes_cantidad: 1 };
const categorias = [{ id: 2, nombre: "Comida", icono: "utensils", activa: true }];
const MES = "2026-11";
const NOV = { desde: "2026-11-01", hasta: "2026-11-30" };

beforeEach(() => {
  enLinea = true;
  localStorage.setItem("arca-usuario", JSON.stringify({ id: 1, nombre: "Ana" }));
  sv = instalarServidorFalso();
  sv.responder = (l) => {
    if (!enLinea) return "red";
    if (l.metodo === "GET") {
      if (l.ruta.startsWith("/movimientos/")) return { estado: 200, cuerpo: movServidor(Number(l.ruta.split("/")[2])) };
      if (l.ruta.startsWith("/movimientos")) return { estado: 200, cuerpo: [movServidor(1)] };
      if (l.ruta.startsWith("/apoyos/resumen")) return { estado: 200, cuerpo: { total_entregado: 300, total_devuelto: 0, total_consumido: 0, total_pendiente: 300, total_entregado_periodo: 300, total_devuelto_periodo: 0, beneficiarios: [{ beneficiario: "Tia Rosa", entregado: 300, devuelto: 0, consumido: 0, pendiente: 300, estado: "Pendiente", cantidad_apoyos: 1, entregado_periodo: 300, devuelto_periodo: 0 }] } };
      if (l.ruta.startsWith("/apoyos/")) return { estado: 200, cuerpo: apoyoSrv(Number(l.ruta.split("/")[2].split("?")[0])) };
      if (l.ruta.startsWith("/apoyos")) return { estado: 200, cuerpo: [apoyoSrv(5)] };
      if (l.ruta.startsWith("/actividad")) return { estado: 200, cuerpo: { items: [], total: 0, hay_mas: false } };
      if (l.ruta.startsWith("/reportes/resumen")) return { estado: 200, cuerpo: resumen };
      if (l.ruta.startsWith("/reportes/por-categoria")) return { estado: 200, cuerpo: { mes: MES, categorias: [], total_gastos: 0, apoyos_consumidos: 0 } };
      if (l.ruta.startsWith("/reportes/por-miembro")) return { estado: 200, cuerpo: { mes: MES, miembros: [] } };
      if (l.ruta.startsWith("/reportes/tendencia")) return { estado: 200, cuerpo: { meses: [] } };
      if (l.ruta === "/categorias") return { estado: 200, cuerpo: categorias };
      if (l.ruta === "/familia/miembros") return { estado: 200, cuerpo: [{ usuario_id: 1, nombre: "Ana", email: "a@t.com", rol: "admin", activo: true }] };
    }
    return { estado: 200, cuerpo: {} };
  };
});

const desconectar = () => { enLinea = false; };

describe("las cinco pantallas cargan sin internet con lo ultimo que se vio", () => {
  it("Inicio (resumen + movimientos), Apoyos (resumen + lista), Lista, Reportes (4) y Familia (categorias y miembros)", async () => {
    // en linea: el usuario visita cada pantalla
    const antes = await Promise.all([
      reportes.resumenPeriodo(NOV), movs.listarMovimientos(NOV), apoyos.resumenApoyos(NOV), apoyos.listarApoyos(false),
      listarActividad({ ...NOV, usuario: "", tipo: "", categoria: "", verAnulados: false }, 0),
      reportes.porCategoria(NOV), reportes.porMiembro(NOV), reportes.tendencia(), familia.listarCategorias(), familia.listarMiembros(),
    ]);
    expect(datosDeCache()).toBeNull();

    desconectar();
    const sin = await Promise.all([
      reportes.resumenPeriodo(NOV), movs.listarMovimientos(NOV), apoyos.resumenApoyos(NOV), apoyos.listarApoyos(false),
      listarActividad({ ...NOV, usuario: "", tipo: "", categoria: "", verAnulados: false }, 0),
      reportes.porCategoria(NOV), reportes.porMiembro(NOV), reportes.tendencia(), familia.listarCategorias(), familia.listarMiembros(),
    ]);
    expect(sin).toEqual(antes); // exactamente lo ultimo que se vio
    expect(datosDeCache()).not.toBeNull(); // y se avisa que son datos guardados
  });

  it("una pantalla que nunca se vio y sin conexion da el error de red (no inventa datos)", async () => {
    desconectar();
    await expect(apoyos.resumenApoyos(NOV)).rejects.toBeInstanceOf(ErrorRed);
  });
});

describe("crear, editar, anular y reactivar movimientos sin conexion", () => {
  it("crear: queda pendiente, se ve de inmediato en Inicio y se envia UNA vez al volver la conexion", async () => {
    await familia.listarCategorias();
    await movs.listarMovimientos(NOV);
    await reportes.resumenPeriodo(NOV);
    desconectar();
    expect(await registrar({ clase: "movimiento", datos: { tipo: "gasto", monto: 25, fecha: "2026-11-07", categoria_id: 2, nota: "Sin red" } })).toBe("en_cola");

    const lista = await movs.listarMovimientos(NOV);
    expect(lista.map((m) => m.nota)).toEqual(["Sin red", null]);
    expect(lista[0]).toMatchObject({ sinSincronizar: true, categoria_nombre: "Comida", monto: 25 });
    expect(await reportes.resumenPeriodo(NOV)).toMatchObject({ gastos: 35, saldo: 665 });

    enLinea = true;
    sv.llamadas.length = 0;
    sv.responder = (l) => (l.metodo === "POST" ? { estado: 201, cuerpo: movServidor(2, { monto: 25, nota: "Sin red", uuid_cliente: l.cuerpo.uuid_cliente }) } : { estado: 200, cuerpo: [] });
    await sincronizar();
    expect(sv.llamadas.filter((l) => l.metodo === "POST")).toHaveLength(1);
    expect(await cantidadEnCola()).toBe(0);
  });

  it("editar, anular y reactivar un registro del servidor sin conexion: cada uno es su operacion y se ve al instante", async () => {
    await movs.listarMovimientos(NOV);
    desconectar();
    const e = await movs.editarMovimiento(1, { monto: 77 });
    expect(e).toMatchObject({ monto: 77, sinSincronizar: true });
    expect((await movs.listarMovimientos(NOV))[0].monto).toBe(77);
    const a = await movs.anularMovimiento(1, "Duplicado");
    expect(a).toMatchObject({ anulado: true, motivo_anulacion: "Duplicado" });
    expect(await movs.listarMovimientos(NOV)).toHaveLength(0); // anulado: sale de Inicio
    const r = await movs.reactivarMovimiento(1);
    expect(r.anulado).toBe(false);
    const ops = await listarOperaciones();
    expect(ops.map((o) => o.accion)).toEqual(["editar", "anular", "reactivar"]);
    expect(new Set(ops.map((o) => o.id)).size).toBe(3);
    expect(ops[0].versionBase).toBe(1); // basada en la version que el usuario vio
    expect(ops[1].encadenada).toBe(true);
  });

  it("abrir a editar un registro sin conexion funciona (viene de la copia local)", async () => {
    await movs.listarMovimientos(NOV);
    desconectar();
    expect(await movs.obtenerMovimiento(1)).toMatchObject({ id: 1, monto: 10 });
    await expect(movs.obtenerMovimiento(404)).rejects.toBeInstanceOf(ErrorApi);
  });

  it("editar lo creado sin conexion (id temporal negativo) se fusiona con su creacion", async () => {
    await familia.listarCategorias();
    await movs.listarMovimientos(NOV);
    desconectar();
    await registrar({ clase: "movimiento", datos: { tipo: "gasto", monto: 25, fecha: "2026-11-07", categoria_id: 2, nota: "x" } });
    const [nuevo] = await movs.listarMovimientos(NOV);
    expect(nuevo.id).toBeLessThan(0);
    expect(await movs.obtenerMovimiento(nuevo.id)).toMatchObject({ monto: 25 });
    await movs.editarMovimiento(nuevo.id, { monto: 30 });
    await movs.anularMovimiento(nuevo.id, "mal");
    const ops = await listarOperaciones();
    expect(ops).toHaveLength(1); // una sola creacion con el valor final (ya anulada)
    expect(ops[0].datos).toMatchObject({ monto: 30, anulado: true, motivo_anulacion: "mal" });
  });
});

describe("apoyos y devoluciones sin conexion", () => {
  it("devolucion de un apoyo creado sin conexion: funciona porque el UUID lo genera el cliente", async () => {
    desconectar();
    await registrar({ clase: "apoyo", datos: { beneficiario: "Primo", monto: 200, fecha: "2026-11-07", nota: null } });
    const [nuevo] = await apoyos.listarApoyos(false).catch(() => [] as apoyos.Apoyo[]);
    // la lista de apoyos nunca se vio con conexion: se prueba con el registro local directo
    const id = nuevo?.id ?? -(await listarOperaciones())[0].seq;
    await apoyos.devolverApoyo(id, 50);
    const ops = await listarOperaciones();
    expect(ops.map((o) => `${o.entidad}:${o.accion}`)).toEqual(["apoyo:crear", "devolucion:crear"]);
    expect(ops[1].apoyoUuid).toBe(ops[0].uuid);

    enLinea = true;
    sv.llamadas.length = 0;
    sv.responder = (l) =>
      l.ruta === "/apoyos"
        ? { estado: 201, cuerpo: apoyoSrv(42, { uuid_cliente: l.cuerpo.uuid_cliente, monto: 200, beneficiario: "Primo" }) }
        : { estado: 201, cuerpo: apoyoSrv(42, { devoluciones: [{ id: 3, apoyo_id: 42, monto: 50, uuid_cliente: l.cuerpo.uuid_cliente, version: 1, anulado: false }] }) };
    await sincronizar();
    expect(sv.llamadas.map((l) => `${l.metodo} ${l.ruta}`)).toEqual(["POST /apoyos", "POST /apoyos/42/devoluciones"]);
  });

  it("devolver, editar, anular y reactivar una devolucion del servidor sin conexion; el apoyo cambia de estado al instante", async () => {
    const conDev = apoyoSrv(5, {
      devuelto: 100, pendiente: 200, devoluciones_activas: 1,
      devoluciones: [{ id: 9, apoyo_id: 5, monto: 100, fecha: "2026-11-03", nota: null, usuario_id: 1, usuario_nombre: "Ana", anulada_con_apoyo: false, version: 1, uuid_cliente: null, anulado: false, anulado_por_nombre: null, anulado_en: null, motivo_anulacion: null, editado_por_nombre: null, editado_en: null }],
    });
    const base = sv.responder;
    sv.responder = (l) => (l.ruta.startsWith("/apoyos?") ? { estado: 200, cuerpo: [conDev] } : base(l));
    await apoyos.listarApoyos(false);
    desconectar();

    expect((await apoyos.devolverApoyo(5, 200)).estado).toBe("Saldado");
    expect(await apoyos.anularDevolucion(5, 9, "mal")).toMatchObject({ devuelto: 200 });
    expect(await apoyos.reactivarDevolucion(5, 9)).toMatchObject({ devuelto: 300, estado: "Saldado" });
    expect((await apoyos.editarDevolucion(5, 9, { monto: 50 })).devuelto).toBe(250);
    const ops = await listarOperaciones();
    expect(ops.map((o) => o.accion)).toEqual(["crear", "anular", "reactivar", "editar"]);
    expect(ops[1].versionBase).toBe(1);
  });

  it("anular y reactivar un apoyo sin conexion", async () => {
    await apoyos.listarApoyos(false);
    desconectar();
    expect(await apoyos.anularApoyo(5, "mal")).toMatchObject({ anulado: true, estado: "Anulado" });
    expect(await apoyos.listarApoyos(false)).toHaveLength(0);
    expect(await apoyos.reactivarApoyo(5)).toMatchObject({ anulado: false, estado: "Pendiente" });
  });

  it("consumir y reabrir necesitan conexion, y no se adelantan a cambios del mismo apoyo que siguen en la cola", async () => {
    await apoyos.listarApoyos(false);
    desconectar();
    await apoyos.editarApoyo(5, { nota: "x" });
    enLinea = true;
    await expect(apoyos.consumirApoyo(5)).rejects.toThrow("cambios sin enviar");
    expect(sv.llamadas.filter((l) => l.ruta.includes("consumir"))).toHaveLength(0);
  });
});
