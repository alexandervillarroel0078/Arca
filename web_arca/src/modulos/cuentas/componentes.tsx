import { useCallback } from "react";
import { Link } from "react-router-dom";
import { useAviso } from "../../core/Aviso";
import { ErrorApi } from "../../core/api";
import { fechaCorta } from "../../core/formato";
import MenuFila, { type AccionMenu } from "../../core/MenuFila";
import { Tarjeta } from "../../core/ui";
import { useUsuarioOpcional } from "../auth/AuthContext";
import { etiquetaVisibilidad } from "../privacidad/visibilidad";
import type { Cuenta, MovimientoCuenta, TipoMovimiento } from "./api";
import { ICONO_TIPO, NOMBRE_TIPO } from "./matriz";
import { aMonto, esNegativo, formatear, formatearTexto, type Moneda } from "./montos";
import { puedeCambiarFecha } from "./permisos";

export const NOMBRE_MOVIMIENTO: Record<TipoMovimiento, string> = {
  deposito: "Depósito",
  retiro: "Retiro",
  traspaso: "Traspaso",
  ajuste: "Ajuste por conteo",
};

/** Aviso FIJO junto al campo de la nota: se copia al historial y a la bitácora. Siempre visible. */
export function AvisoNota({ id }: { id: string }) {
  return (
    <p id={id} data-testid="aviso-nota" className="mt-1.5 flex items-start gap-1.5 rounded-xl bg-apoyo-claro px-3 py-2 text-sm font-medium text-apoyo-texto">
      <span aria-hidden>🔒</span>
      <span>No escribas claves ni frases semilla. Las notas se copian al historial y a la bitácora.</span>
    </p>
  );
}

/** Saldo: en negativo va en rojo con un icono y un texto (nunca solo el color), y no bloquea nada. */
export function Saldo({ texto, moneda, grande = false, avisar = false }: { texto: string; moneda: Moneda; grande?: boolean; avisar?: boolean }) {
  const m = aMonto(texto);
  const negativo = m !== null && esNegativo(m);
  return (
    <span data-testid="saldo-cuenta" data-negativo={negativo || undefined} className={`${negativo ? "text-red-700" : "text-stone-900"} font-titulo font-bold ${grande ? "text-3xl" : "text-lg"}`}>
      {negativo && <span aria-hidden className="mr-1">⚠</span>}
      {formatearTexto(texto, moneda)}
      {negativo && avisar && <span className="sr-only"> (saldo en negativo)</span>}
    </span>
  );
}

export function AvisoNegativo({ texto = "Saldo en negativo: hay más salidas que entradas registradas. Revisa los movimientos o haz un ajuste por conteo." }: { texto?: string }) {
  return (
    <p role="status" data-testid="aviso-negativo" className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm font-medium text-red-800">
      <span aria-hidden>⚠</span>
      <span>{texto}</span>
    </p>
  );
}

/** Descripción corta de una cuenta: "Banco Unión · Caja de ahorro · ••••1234". */
export function descripcionCuenta(c: Pick<Cuenta, "tipo" | "banco" | "banco_otro" | "ultimos4">): string {
  const banco = c.banco === "Otro" ? c.banco_otro : c.banco;
  return [banco, NOMBRE_TIPO[c.tipo], c.ultimos4 ? `•••• ${c.ultimos4}` : null].filter(Boolean).join(" · ");
}

export function FilaCuenta({ c }: { c: Cuenta }) {
  const yo = useUsuarioOpcional();
  const etiqueta = etiquetaVisibilidad(c, yo);
  return (
    <li>
      <Link
        to={`/cuentas/${c.id}`}
        data-testid="fila-cuenta"
        className={`flex items-center gap-3 min-h-[68px] rounded-tarjeta border border-stone-200 bg-white p-3 active:bg-stone-100 ${c.anulado ? "opacity-60" : ""}`}
      >
        <span aria-hidden className="shrink-0 w-11 h-11 rounded-2xl bg-arca-claro flex items-center justify-center text-2xl">{ICONO_TIPO[c.tipo]}</span>
        <span className="flex-1 min-w-0">
          {/* truncados A PROPOSITO (la prueba visual los acepta solo con esta marca); el texto completo queda en `title` */}
          <span className="block font-titulo font-bold truncate" data-truncado="a-proposito" title={c.nombre}>{c.nombre}{c.anulado && " (anulada)"}</span>
          <span className="block text-sm text-stone-600 truncate" data-truncado="a-proposito" title={descripcionCuenta(c)}>{descripcionCuenta(c)}</span>
          {etiqueta && <span className="block text-xs font-semibold text-stone-600">{etiqueta}</span>}
        </span>
        <span className="text-right shrink-0">
          <Saldo texto={c.saldo} moneda={c.moneda} />
        </span>
      </Link>
    </li>
  );
}

/** Nombre de la persona del movimiento, o null si no está identificada (en la fila no se escribe "Sin identificar"). */
export function personaIdentificada(m: Pick<MovimientoCuenta, "persona_tipo" | "persona_nombre">): string | null {
  return m.persona_tipo === "sin_identificar" ? null : m.persona_nombre || null;
}

/** Título de la fila: el tipo, o "Traspaso a X" / "Traspaso desde X" según la cuenta que se está viendo. */
export function tituloMovimiento(m: MovimientoCuenta, cuentaRef?: number): string {
  if (m.tipo !== "traspaso") return NOMBRE_MOVIMIENTO[m.tipo];
  const dondeEstoy = cuentaRef !== undefined && m.cuenta_destino_id === cuentaRef;
  return dondeEstoy ? `Traspaso desde ${m.cuenta_nombre}` : `Traspaso a ${m.cuenta_destino_nombre}`;
}

/** Lo que va en la segunda línea (vacío: la fila queda en una sola línea). El "Anulado · motivo" va aparte, en rojo. */
export function detallesMovimiento(m: MovimientoCuenta, cuentaRef?: number): string[] {
  return [
    cuentaRef === undefined ? m.cuenta_nombre : null, // lista global: de qué cuenta es
    personaIdentificada(m),
    m.tipo === "retiro" && m.comision && aMonto(m.comision) !== 0n ? `comisión ${formatearTexto(m.comision, m.moneda)}` : null,
    m.tipo === "ajuste" && m.saldo_declarado ? `saldo contado ${formatearTexto(m.saldo_declarado, m.moneda)}` : null,
    m.nota,
  ].filter((x): x is string => !!x);
}

/** Acciones del menu "…" de la fila. Mismas reglas de siempre; el servidor manda (si rechaza, la pantalla se refresca). */
export function accionesMovimiento(
  m: MovimientoCuenta,
  h: { alHistorial?: (m: MovimientoCuenta) => void; alCambiarFecha?: (m: MovimientoCuenta) => void; alAnular?: (m: MovimientoCuenta) => void; alReactivar?: (m: MovimientoCuenta) => void },
): AccionMenu[] {
  const out: AccionMenu[] = [];
  if (h.alHistorial) out.push({ texto: "Historial", alAccionar: () => h.alHistorial!(m) });
  if (h.alCambiarFecha && puedeCambiarFecha(m)) out.push({ texto: "Cambiar fecha", alAccionar: () => h.alCambiarFecha!(m) });
  if (h.alAnular && m.puede_registrar && !m.anulado) out.push({ texto: "Anular", alAccionar: () => h.alAnular!(m), peligro: true });
  if (h.alReactivar && m.puede_registrar && m.anulado) out.push({ texto: "Reactivar", alAccionar: () => h.alReactivar!(m) });
  return out;
}

// Columnas compartidas por la cabecera y las filas (que queden alineadas).
const COL_FECHA = "w-12 shrink-0";
const COL_MENU = "w-11 shrink-0";

/** Cabecera de columnas, solo visual: los lectores de pantalla leen cada fila completa. */
export function CabeceraMovimientos({ conMenu = false }: { conMenu?: boolean }) {
  return (
    <div aria-hidden="true" data-testid="cabecera-movimientos" className="flex items-center gap-2 pt-3 pb-2 border-b border-stone-100 text-xs font-semibold text-stone-500">
      <span className={COL_FECHA}>Fecha</span>
      <span className="flex-1 min-w-0">Movimiento</span>
      <span className="shrink-0">Monto</span>
      {conMenu && <span className={COL_MENU} />}
    </div>
  );
}

/**
 * Una fila de movimiento en una línea: fecha · tipo · monto · "…". El tipo se trunca con "…" (el monto nunca se parte ni se
 * corta); una segunda línea pequeña solo si hay algo que mostrar. `cuentaRef`: se está viendo ESA cuenta (se muestra el efecto
 * sobre ella y no su nombre). Sin manejadores (lista global) no hay menu.
 */
export function FilaMovimiento({
  m, cuentaRef, alAnular, alReactivar, alHistorial, alCambiarFecha,
}: {
  m: MovimientoCuenta;
  cuentaRef?: number;
  alAnular?: (m: MovimientoCuenta) => void;
  alReactivar?: (m: MovimientoCuenta) => void;
  alHistorial?: (m: MovimientoCuenta) => void;
  alCambiarFecha?: (m: MovimientoCuenta) => void;
}) {
  const efecto = m.efecto !== null && m.efecto !== undefined ? aMonto(m.efecto) : null;
  const titulo = tituloMovimiento(m, cuentaRef);
  const detalles = detallesMovimiento(m, cuentaRef);
  const conMenu = !!(alAnular || alReactivar || alHistorial || alCambiarFecha);
  const acciones = conMenu ? accionesMovimiento(m, { alHistorial, alCambiarFecha, alAnular, alReactivar }) : [];
  const tachado = m.anulado ? "line-through text-stone-500" : "";
  return (
    <li data-testid="fila-movimiento" data-tipo={m.tipo} data-anulado={m.anulado || undefined} className={m.anulado ? "text-stone-500" : ""}>
      <div className="flex items-center gap-2 min-h-[52px]">
        <span className={`${COL_FECHA} monto whitespace-nowrap text-sm text-stone-600`}>{fechaCorta(m.fecha)}</span>
        {/* truncado A PROPOSITO: la prueba visual lo acepta solo con esta marca; el texto completo queda en `title` y en el DOM */}
        <p className={`flex-1 min-w-0 truncate break-words font-semibold ${tachado}`} title={titulo} data-truncado="a-proposito">
          {titulo}
        </p>
        <p data-testid="monto-movimiento" className={`shrink-0 whitespace-nowrap monto font-titulo font-bold ${m.anulado ? tachado : efecto !== null ? (esNegativo(efecto) ? "text-red-700" : "text-arca") : ""}`}>
          {efecto !== null ? `${esNegativo(efecto) ? "" : "+"}${formatear(efecto, m.moneda)}` : formatearTexto(m.monto, m.moneda)}
        </p>
        {conMenu && (
          <div className={COL_MENU}>
            <MenuFila acciones={acciones} etiqueta={`Acciones de ${titulo}`} />
          </div>
        )}
      </div>
      {(m.anulado || detalles.length > 0) && (
        <p data-testid="detalle-movimiento" className={`-mt-1.5 pb-2 pl-14 text-xs text-stone-600 break-words ${conMenu ? "pr-11" : ""}`}>
          {m.anulado && (
            <span className="font-semibold text-red-700">
              Anulado{m.motivo_anulacion ? ` · ${m.motivo_anulacion}` : ""}{detalles.length > 0 ? " · " : ""}
            </span>
          )}
          {detalles.join(" · ")}
        </p>
      )}
    </li>
  );
}

/** Un bloque por moneda (jamás se suman monedas distintas). */
export function BloqueMoneda({ moneda, total, cuentas, hayNegativas }: { moneda: Moneda; total: string; cuentas: number; hayNegativas: boolean }) {
  return (
    <Tarjeta className="space-y-0.5" >
      <div data-testid={`total-${moneda}`}>
        <p className="text-sm font-semibold text-stone-600">Total en {moneda === "BS" ? "Bs" : moneda}</p>
        <Saldo texto={total} moneda={moneda} grande />
        <p className="text-xs text-stone-600">{cuentas} {cuentas === 1 ? "cuenta" : "cuentas"}{hayNegativas ? " · alguna en negativo" : ""}</p>
      </div>
    </Tarjeta>
  );
}

/**
 * Manejo común de errores al registrar o anular: el servidor manda. Se muestra su mensaje y, si el rechazo es por
 * permisos, porque ya no existe o porque cambió (403, 404, 409), se refresca la pantalla y se avisa.
 */
export function useManejoError(recargar: () => void) {
  const avisar = useAviso();
  return useCallback(
    (e: unknown) => {
      const refrescar = e instanceof ErrorApi && [403, 404, 409].includes(e.estado);
      // un solo aviso (solo se ve el más reciente): el mensaje del servidor y, si hace falta, que se refrescó la pantalla
      avisar(refrescar ? `${(e as Error).message}. Se actualizó la pantalla con los datos del servidor` : (e as Error).message, "error");
      if (refrescar) recargar();
    },
    [avisar, recargar],
  );
}
