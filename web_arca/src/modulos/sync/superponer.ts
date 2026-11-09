// Superpone las operaciones pendientes de la cola sobre lo ultimo que se sabe del servidor (funciones puras), para
// que el usuario vea de inmediato lo que hizo sin conexion: en las listas, en los totales de Inicio y en Apoyos.
//
// Sin conexion los totales son una ESTIMACION (suma o resta lo que cambia cada operacion pendiente); al sincronizar
// el servidor recalcula todo y se muestran sus numeros.
import type { Apoyo, Beneficiario, Devolucion, ResumenApoyos } from "../apoyos/api";
import type { Categoria } from "../familia/api";
import type { FiltrosActividad, ItemActividad } from "../movimientos/actividad";
import type { Movimiento } from "../movimientos/api";
import { recomparar } from "../../core/comparacion";
import { enRango, type Rango } from "../../core/periodo";
import type { Resumen } from "../reportes/api";
import { claveUuid } from "./entidades";
import type { Operacion } from "./tipos";

export interface Entorno {
  yo: { id: number; nombre: string };
  categorias: Categoria[];
  /** UUID del cliente -> id del servidor, de lo que ya se sincronizo. */
  ids: Record<string, number>;
}
type ApoyoLocal = Apoyo & { _consumido?: number; _devuelto?: number };
export type Local = Movimiento | Apoyo;
export interface Aplicado {
  bases: Map<string, Local>;
  finales: Map<string, Local>;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const cents = (n: number) => Math.round(n * 100);

export function calcularEstado(pendiente: number, consumido: number): Apoyo["estado"] {
  if (pendiente > 0) return "Pendiente";
  return consumido > 0 ? "Cerrado" : "Saldado";
}

// ---------------------------------------------------------------- registros afectados por la cola
function nuevoMovimiento(op: Operacion, env: Entorno): Movimiento {
  const d = op.datos as Record<string, any>;
  const cat = env.categorias.find((c) => c.id === d.categoria_id);
  return {
    id: -op.seq, tipo: d.tipo, monto: Number(d.monto), fecha: d.fecha, categoria_id: d.categoria_id ?? null,
    categoria_nombre: cat?.nombre ?? null, categoria_icono: cat?.icono ?? null, nota: d.nota ?? null,
    usuario_id: env.yo.id, usuario_nombre: env.yo.nombre, version: 0, uuid_cliente: op.uuid, sinSincronizar: true,
    visibilidad: d.visibilidad ?? "familia", compartido_con: d.compartido_con ?? [],
    anulado: !!d.anulado, anulado_por_nombre: d.anulado ? env.yo.nombre : null,
    anulado_en: d.anulado ? (d.fecha_cliente_anulacion ?? op.fechaCliente) : null,
    motivo_anulacion: d.anulado ? (d.motivo_anulacion ?? null) : null, editado_por_nombre: null, editado_en: null,
  };
}

function nuevoApoyo(op: Operacion, env: Entorno): Apoyo {
  const d = op.datos as Record<string, any>;
  const a: Apoyo = {
    id: -op.seq, beneficiario: String(d.beneficiario).trim(), monto: Number(d.monto), fecha: d.fecha, nota: d.nota ?? null,
    usuario_id: env.yo.id, usuario_nombre: env.yo.nombre, devuelto: 0, consumido: 0, pendiente: Number(d.monto),
    estado: "Pendiente", devoluciones: [], devoluciones_activas: 0, version: 0, uuid_cliente: op.uuid, sinSincronizar: true,
    visibilidad: d.visibilidad ?? "familia", compartido_con: d.compartido_con ?? [],
    anulado: !!d.anulado, anulado_por_nombre: d.anulado ? env.yo.nombre : null,
    anulado_en: d.anulado ? (d.fecha_cliente_anulacion ?? op.fechaCliente) : null,
    motivo_anulacion: d.anulado ? (d.motivo_anulacion ?? null) : null, editado_por_nombre: null, editado_en: null,
  };
  return derivar(a, false);
}

/** Recalcula devuelto / pendiente / estado de un apoyo a partir de sus devoluciones activas. */
function derivar(a: Apoyo, tocoDevoluciones: boolean): Apoyo {
  if (a.anulado) return { ...a, devuelto: 0, consumido: 0, pendiente: 0, estado: "Anulado", devoluciones_activas: 0 };
  // un apoyo conocido solo por la lista completa no trae sus devoluciones: se conservan sus totales
  const parcial = a.devoluciones.length === 0 && a.devoluciones_activas > 0 && !tocoDevoluciones;
  const activas = a.devoluciones.filter((d) => !d.anulado);
  const devuelto = parcial ? a.devuelto : r2(activas.reduce((s, d) => s + d.monto, 0));
  const pendiente = r2(a.monto - devuelto - a.consumido);
  return {
    ...a, devuelto, pendiente, estado: calcularEstado(pendiente, a.consumido),
    devoluciones_activas: parcial ? a.devoluciones_activas : activas.length,
  };
}

function mutarMovimiento(m: Movimiento, op: Operacion, env: Entorno): Movimiento {
  const marca = { editado_por_nombre: env.yo.nombre, editado_en: op.fechaCliente, sinSincronizar: true, enConflicto: m.enConflicto || op.estado === "conflicto" };
  if (op.accion === "editar") {
    const c = op.datos as Partial<Movimiento>;
    const sig = { ...m, ...c, ...marca } as Movimiento;
    if (sig.tipo === "ingreso") return { ...sig, categoria_id: null, categoria_nombre: null, categoria_icono: null };
    const cat = env.categorias.find((x) => x.id === sig.categoria_id);
    return { ...sig, categoria_nombre: cat?.nombre ?? m.categoria_nombre, categoria_icono: cat?.icono ?? m.categoria_icono };
  }
  if (op.accion === "anular") {
    return {
      ...m, ...marca, anulado: true, anulado_por_nombre: env.yo.nombre, anulado_en: op.fechaCliente,
      motivo_anulacion: ((op.datos.motivo as string | undefined) ?? "").trim() || null,
    };
  }
  return { ...m, ...marca, anulado: false, anulado_por_nombre: null, anulado_en: null, motivo_anulacion: null };
}

function mutarApoyo(a: ApoyoLocal, op: Operacion, env: Entorno): Apoyo {
  const marca = { editado_por_nombre: env.yo.nombre, editado_en: op.fechaCliente, sinSincronizar: true, enConflicto: a.enConflicto || op.estado === "conflicto" };
  if (op.accion === "editar") {
    const c = op.datos as Partial<Apoyo>;
    return derivar({ ...a, ...c, beneficiario: (c.beneficiario ?? a.beneficiario).trim(), ...marca }, false);
  }
  if (op.accion === "anular") {
    // anular un apoyo anula en cascada sus devoluciones activas (vuelven al reactivarlo)
    const devoluciones = a.devoluciones.map((d) =>
      d.anulado ? d : { ...d, anulado: true, anulada_con_apoyo: true, anulado_por_nombre: env.yo.nombre, anulado_en: op.fechaCliente, motivo_anulacion: "Anulada junto con el apoyo" },
    );
    const anulado: ApoyoLocal = {
      ...a, ...marca, devoluciones, anulado: true, anulado_por_nombre: env.yo.nombre, anulado_en: op.fechaCliente,
      motivo_anulacion: ((op.datos.motivo as string | undefined) ?? "").trim() || null, _consumido: a.consumido, _devuelto: a.devuelto,
    };
    return derivar(anulado, true);
  }
  const devoluciones = a.devoluciones.map((d) =>
    d.anulada_con_apoyo ? { ...d, anulado: false, anulada_con_apoyo: false, anulado_por_nombre: null, anulado_en: null, motivo_anulacion: null } : d,
  );
  const react: ApoyoLocal = {
    ...a, ...marca, devoluciones, anulado: false, anulado_por_nombre: null, anulado_en: null, motivo_anulacion: null,
    consumido: a._consumido ?? a.consumido,
  };
  // sin la lista de devoluciones (apoyo conocido solo por la lista completa) se recupera lo devuelto que tenia antes
  const sinLista = a.devoluciones.length === 0 && a._devuelto !== undefined;
  return derivar(sinLista ? { ...react, devuelto: a._devuelto!, devoluciones_activas: react.devoluciones_activas } : react, !sinLista);
}

function mutarDevolucion(a: Apoyo, op: Operacion, env: Entorno, seqDe: Map<string, number>): Apoyo {
  if (op.accion === "crear") {
    if (a.devoluciones.some((d) => d.uuid_cliente && d.uuid_cliente === op.uuid)) return a; // ya sincronizada
    const dd = op.datos as Record<string, any>;
    const d: Devolucion = {
      id: -op.seq, apoyo_id: a.id, monto: Number(dd.monto), fecha: dd.fecha, nota: dd.nota ?? null, usuario_id: env.yo.id,
      usuario_nombre: env.yo.nombre, anulada_con_apoyo: false, version: 0, uuid_cliente: op.uuid, sinSincronizar: true,
      anulado: !!dd.anulado, anulado_por_nombre: dd.anulado ? env.yo.nombre : null, anulado_en: dd.anulado ? op.fechaCliente : null,
      motivo_anulacion: dd.anulado ? (dd.motivo_anulacion ?? null) : null, editado_por_nombre: null, editado_en: null,
    };
    return derivar({ ...a, devoluciones: [...a.devoluciones, d] }, true);
  }
  const esta = (d: Devolucion) =>
    op.entidadId != null ? d.id === op.entidadId : d.uuid_cliente === op.uuid || (!!op.uuid && d.id === -(seqDe.get(`devolucion:${op.uuid}`) ?? 0));
  const devoluciones = a.devoluciones.map((d) => {
    if (!esta(d)) return d;
    const marca = { editado_por_nombre: env.yo.nombre, editado_en: op.fechaCliente, sinSincronizar: true, enConflicto: d.enConflicto || op.estado === "conflicto" };
    if (op.accion === "editar") return { ...d, ...(op.datos as Partial<Devolucion>), ...marca };
    if (op.accion === "anular") {
      return { ...d, ...marca, anulado: true, anulada_con_apoyo: false, anulado_por_nombre: env.yo.nombre, anulado_en: op.fechaCliente, motivo_anulacion: ((op.datos.motivo as string | undefined) ?? "").trim() || null };
    }
    return { ...d, ...marca, anulado: false, anulada_con_apoyo: false, anulado_por_nombre: null, anulado_en: null, motivo_anulacion: null };
  });
  return derivar({ ...a, devoluciones }, true);
}

/** Aplica la cola, en orden, sobre los registros conocidos. Devuelve solo los registros que la cola toca. */
export function aplicarOperaciones(bases: Map<string, Local>, ops: Operacion[], env: Entorno): Aplicado {
  const finales = new Map<string, Local>();
  const seqDe = new Map<string, number>(); // "entidad:uuid" -> seq de la creacion pendiente (id temporal = -seq)
  for (const o of ops) if (o.accion === "crear" && o.uuid) seqDe.set(`${o.entidad}:${o.uuid}`, o.seq);

  const claveDe = (entidad: "movimiento" | "apoyo", id: number | null, uuid: string | null): string | null => {
    if (id != null) return `${entidad}:${id}`;
    if (!uuid) return null;
    const real = env.ids[claveUuid(entidad, uuid)];
    if (real != null) return `${entidad}:${real}`;
    const seq = seqDe.get(`${entidad}:${uuid}`);
    return seq != null ? `${entidad}:${-seq}` : null;
  };
  const actual = (k: string | null) => (k ? (finales.get(k) ?? bases.get(k)) : undefined);

  for (const op of ops) {
    if (op.entidad === "devolucion") {
      const k = claveDe("apoyo", op.apoyoId, op.apoyoUuid);
      const a = actual(k) as Apoyo | undefined;
      if (k && a) finales.set(k, mutarDevolucion(a, op, env, seqDe));
      continue;
    }
    if (op.accion === "crear") {
      if (op.uuid && env.ids[claveUuid(op.entidad, op.uuid)] != null) continue; // ya se sincronizo: viene en los datos
      finales.set(`${op.entidad}:${-op.seq}`, op.entidad === "movimiento" ? nuevoMovimiento(op, env) : nuevoApoyo(op, env));
      continue;
    }
    const k = claveDe(op.entidad, op.entidadId, op.uuid);
    const cur = actual(k);
    if (!k || !cur) continue;
    finales.set(k, op.entidad === "movimiento" ? mutarMovimiento(cur as Movimiento, op, env) : mutarApoyo(cur as ApoyoLocal, op, env));
  }
  return { bases, finales };
}

// ---------------------------------------------------------------- listas
const antes = (a: { fecha: string; id: number; sinSincronizar?: boolean }, b: { fecha: string; id: number; sinSincronizar?: boolean }) =>
  b.fecha.localeCompare(a.fecha) || Number(!!b.sinSincronizar) - Number(!!a.sinSincronizar) || b.id - a.id;

const entidadesDe = <T extends Local>(ap: Aplicado, prefijo: string) =>
  [...ap.finales.entries()].filter(([k]) => k.startsWith(`${prefijo}:`)).map(([, v]) => v as T);

/** Une una lista del servidor con los registros que la cola crea o cambia (`cumple` = el filtro de esa pantalla). */
function unir<T extends Local>(lista: T[], tocados: T[], cumple: (x: T) => boolean): T[] {
  const idsTocados = new Set(tocados.map((t) => t.id));
  const uuidsLista = new Set(lista.map((x) => x.uuid_cliente).filter(Boolean));
  const nuevos = tocados.filter((t) => !(t.id < 0 && t.uuid_cliente && uuidsLista.has(t.uuid_cliente))).filter(cumple);
  return [...nuevos, ...lista.filter((x) => !idsTocados.has(x.id))].sort(antes);
}

export function superponerMovimientos(lista: Movimiento[], ap: Aplicado, rango: Rango): Movimiento[] {
  return unir(lista, entidadesDe<Movimiento>(ap, "movimiento"), (m) => !m.anulado && enRango(m.fecha, rango));
}

export function superponerApoyos(lista: Apoyo[], ap: Aplicado, verAnulados: boolean): Apoyo[] {
  const r = unir(lista, entidadesDe<Apoyo>(ap, "apoyo"), (a) => verAnulados || !a.anulado);
  return verAnulados ? r : r.map((a) => ({ ...a, devoluciones: a.devoluciones.filter((d) => !d.anulado) }));
}

export function movimientoAItem(m: Movimiento): ItemActividad {
  return {
    clase: "movimiento", id: m.id, tipo: m.tipo, titulo: m.nota?.trim() || m.categoria_nombre || "Ingreso", monto: m.monto,
    fecha: m.fecha, nota: m.nota, usuario_id: m.usuario_id, usuario_nombre: m.usuario_nombre,
    visibilidad: m.visibilidad, compartido_con: m.compartido_con, categoria_id: m.categoria_id,
    categoria_nombre: m.categoria_nombre, categoria_icono: m.categoria_icono, beneficiario: null, estado: null, pendiente: null,
    devoluciones_activas: null, version: m.version, uuid_cliente: m.uuid_cliente, sinSincronizar: m.sinSincronizar, enConflicto: m.enConflicto,
    anulado: m.anulado, anulado_por_nombre: m.anulado_por_nombre, anulado_en: m.anulado_en, motivo_anulacion: m.motivo_anulacion,
    editado_por_nombre: m.editado_por_nombre, editado_en: m.editado_en,
  };
}

export function apoyoAItem(a: Apoyo): ItemActividad {
  return {
    clase: "apoyo", id: a.id, tipo: "apoyo", titulo: a.beneficiario, monto: a.monto, fecha: a.fecha, nota: a.nota,
    usuario_id: a.usuario_id, usuario_nombre: a.usuario_nombre, visibilidad: a.visibilidad, compartido_con: a.compartido_con, categoria_id: null, categoria_nombre: null, categoria_icono: null,
    beneficiario: a.beneficiario, estado: a.estado, pendiente: a.pendiente, devuelto: a.devuelto, consumido: a.consumido,
    devoluciones_activas: a.devoluciones_activas, version: a.version, uuid_cliente: a.uuid_cliente, sinSincronizar: a.sinSincronizar,
    enConflicto: a.enConflicto, anulado: a.anulado, anulado_por_nombre: a.anulado_por_nombre, anulado_en: a.anulado_en,
    motivo_anulacion: a.motivo_anulacion, editado_por_nombre: a.editado_por_nombre, editado_en: a.editado_en,
  };
}

/** Lista completa: solo la primera pagina recibe los registros nuevos; los cambios y anulaciones se aplican en cualquiera. */
export function superponerActividad(items: ItemActividad[], ap: Aplicado, f: FiltrosActividad, primeraPagina: boolean): ItemActividad[] {
  const cumple = (i: ItemActividad) => {
    if (!f.verAnulados && i.anulado) return false;
    if (f.desde && f.hasta && !enRango(i.fecha, { desde: f.desde, hasta: f.hasta })) return false;
    if (f.usuario && String(i.usuario_id) !== f.usuario) return false;
    if (f.tipo && i.tipo !== f.tipo) return false;
    if (f.categoria && String(i.categoria_id) !== f.categoria) return false;
    return true;
  };
  const tocados = [
    ...entidadesDe<Movimiento>(ap, "movimiento").map(movimientoAItem),
    ...entidadesDe<Apoyo>(ap, "apoyo").map(apoyoAItem),
  ];
  const clave = (i: ItemActividad) => `${i.clase}:${i.id}`;
  const enListaUuid = new Set(items.map((i) => i.uuid_cliente).filter(Boolean));
  const idsTocados = new Set(tocados.map(clave));
  const nuevos = tocados
    .filter((i) => !(i.id < 0 && i.uuid_cliente && enListaUuid.has(i.uuid_cliente)))
    .filter((i) => (i.id < 0 ? primeraPagina : true))
    .filter(cumple);
  const resto = items.filter((i) => !idsTocados.has(clave(i)));
  return [...nuevos, ...resto].sort(antes);
}

// ---------------------------------------------------------------- totales (estimacion mientras hay cambios pendientes)
interface Contribucion {
  ingresos: number;
  gastos: number;
  apoyos: number;
  devoluciones: number;
  consumido: number;
  pendiente: number;
}
const CERO: Contribucion = { ingresos: 0, gastos: 0, apoyos: 0, devoluciones: 0, consumido: 0, pendiente: 0 };

/** Lo devuelto de un apoyo con fecha de devolucion dentro del periodo (cada devolucion por su propia fecha). */
function devueltoEn(a: Apoyo, rango: Rango): number {
  const parcial = a.devoluciones.length === 0 && a.devoluciones_activas > 0; // llego sin detalle (lista completa)
  return parcial
    ? (enRango(a.fecha, rango) ? a.devuelto : 0)
    : a.devoluciones.filter((d) => !d.anulado && enRango(d.fecha, rango)).reduce((s, d) => s + d.monto, 0);
}

function contribucion(x: Local | undefined, rango: Rango): Contribucion {
  if (!x || x.anulado) return CERO;
  if ("tipo" in x) {
    if (!enRango(x.fecha, rango)) return CERO;
    return x.tipo === "ingreso" ? { ...CERO, ingresos: x.monto } : { ...CERO, gastos: x.monto };
  }
  const enPeriodo = enRango(x.fecha, rango);
  return { ingresos: 0, gastos: 0, apoyos: enPeriodo ? x.monto : 0, devoluciones: devueltoEn(x, rango), consumido: enPeriodo ? x.consumido : 0, pendiente: x.pendiente };
}

export function superponerResumen(r: Resumen, ap: Aplicado, rango: Rango): Resumen {
  const d = { ...CERO };
  for (const [k, final] of ap.finales) {
    const a = contribucion(ap.bases.get(k), rango);
    const b = contribucion(final, rango);
    for (const c of Object.keys(d) as (keyof Contribucion)[]) d[c] += b[c] - a[c];
  }
  if (Object.values(d).every((v) => Math.abs(v) < 0.005)) return r;
  const total = r2(r.apoyos_pendientes_total + d.pendiente);
  const cantidad = total <= 0 ? 0 : r.apoyos_pendientes_total <= 0 ? Math.max(1, r.apoyos_pendientes_cantidad) : r.apoyos_pendientes_cantidad;
  const ingresos = r2(r.ingresos + d.ingresos);
  const gastos = r2(r.gastos + d.gastos);
  const saldo = r2(r.saldo + d.ingresos - d.gastos - d.apoyos + d.devoluciones);
  return {
    ...r,
    ingresos,
    gastos,
    apoyos_entregados: r2(r.apoyos_entregados + d.apoyos),
    devoluciones: r2(r.devoluciones + d.devoluciones),
    consumido: r2(r.consumido + d.consumido),
    saldo,
    // el periodo anterior no cambia: solo se recalcula la diferencia con lo nuevo de este periodo
    comparacion: r.comparacion
      ? { ...r.comparacion, ingresos: recomparar(r.comparacion.ingresos, ingresos), gastos: recomparar(r.comparacion.gastos, gastos), saldo: recomparar(r.comparacion.saldo, saldo) }
      : r.comparacion,
    gasto_familiar_total: r2(r.gasto_familiar_total + d.gastos + d.consumido),
    apoyos_pendientes_total: total,
    apoyos_pendientes_cantidad: cantidad,
  };
}

interface Grupo {
  entregado: number;
  devuelto: number;
  consumido: number;
  n: number;
  entregadoPeriodo: number;
  devueltoPeriodo: number;
}

/** El pendiente y el estado son acumulados; `rango` solo reparte lo entregado y devuelto DENTRO del periodo. */
export function superponerResumenApoyos(r: ResumenApoyos, ap: Aplicado, rango?: Rango): ResumenApoyos {
  const grupoDe = (a: Apoyo | undefined): Grupo | null =>
    !a || a.anulado
      ? null
      : {
          entregado: a.monto, devuelto: a.devuelto, consumido: a.consumido, n: 1,
          entregadoPeriodo: !rango || enRango(a.fecha, rango) ? a.monto : 0,
          devueltoPeriodo: rango ? devueltoEn(a, rango) : a.devuelto,
        };
  const filas = new Map<string, Grupo & { nombre: string }>();
  for (const b of r.beneficiarios) {
    filas.set(b.beneficiario.trim().toLowerCase(), {
      nombre: b.beneficiario, entregado: b.entregado, devuelto: b.devuelto, consumido: b.consumido, n: b.cantidad_apoyos,
      entregadoPeriodo: b.entregado_periodo ?? b.entregado, devueltoPeriodo: b.devuelto_periodo ?? b.devuelto,
    });
  }
  let cambio = false;
  const mover = (a: Apoyo | undefined, signo: 1 | -1) => {
    const g = grupoDe(a);
    if (!g || !a) return;
    const k = a.beneficiario.trim().toLowerCase();
    const f = filas.get(k) ?? { nombre: a.beneficiario, entregado: 0, devuelto: 0, consumido: 0, n: 0, entregadoPeriodo: 0, devueltoPeriodo: 0 };
    f.entregado = r2(f.entregado + signo * g.entregado);
    f.devuelto = r2(f.devuelto + signo * g.devuelto);
    f.consumido = r2(f.consumido + signo * g.consumido);
    f.n += signo * g.n;
    f.entregadoPeriodo = r2(f.entregadoPeriodo + signo * g.entregadoPeriodo);
    f.devueltoPeriodo = r2(f.devueltoPeriodo + signo * g.devueltoPeriodo);
    filas.set(k, f);
    cambio = true;
  };
  for (const [k, final] of ap.finales) {
    if (!k.startsWith("apoyo:")) continue;
    mover(ap.bases.get(k) as Apoyo | undefined, -1);
    mover(final as Apoyo, 1);
  }
  if (!cambio) return r;
  const beneficiarios: Beneficiario[] = [...filas.values()]
    .filter((f) => f.n > 0)
    .map((f) => {
      const pendiente = r2(f.entregado - f.devuelto - f.consumido);
      return {
        beneficiario: f.nombre, entregado: f.entregado, devuelto: f.devuelto, consumido: f.consumido, pendiente,
        estado: calcularEstado(pendiente, f.consumido), cantidad_apoyos: f.n,
        entregado_periodo: f.entregadoPeriodo, devuelto_periodo: f.devueltoPeriodo,
      };
    })
    // igual que el servidor: con periodo, solo quien tiene pendiente o movimiento en el periodo
    .filter((b) => !rango || b.pendiente > 0 || b.entregado_periodo !== 0 || b.devuelto_periodo !== 0)
    .sort((a, b) => Number(a.estado !== "Pendiente") - Number(b.estado !== "Pendiente") || a.beneficiario.toLowerCase().localeCompare(b.beneficiario.toLowerCase()));
  const suma = (c: keyof Beneficiario) => r2(beneficiarios.reduce((s, b) => s + (b[c] as number), 0));
  return {
    total_entregado: suma("entregado"), total_devuelto: suma("devuelto"), total_consumido: suma("consumido"),
    total_pendiente: suma("pendiente"), total_entregado_periodo: suma("entregado_periodo"),
    total_devuelto_periodo: suma("devuelto_periodo"), beneficiarios,
  };
}

export const centavos = cents;
