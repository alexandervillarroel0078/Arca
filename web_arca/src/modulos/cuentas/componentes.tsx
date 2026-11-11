import { useCallback } from "react";
import { Link } from "react-router-dom";
import { useAviso } from "../../core/Aviso";
import { ErrorApi } from "../../core/api";
import { fechaCorta } from "../../core/formato";
import { Tarjeta } from "../../core/ui";
import { useUsuarioOpcional } from "../auth/AuthContext";
import { etiquetaVisibilidad } from "../privacidad/visibilidad";
import type { Cuenta, MovimientoCuenta, TipoMovimiento } from "./api";
import { ICONO_TIPO, NOMBRE_TIPO } from "./matriz";
import { aMonto, esNegativo, formatear, formatearTexto, type Moneda } from "./montos";

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
          <span className="block font-titulo font-bold truncate">{c.nombre}{c.anulado && " (anulada)"}</span>
          <span className="block text-sm text-stone-600 truncate">{descripcionCuenta(c)}</span>
          {etiqueta && <span className="block text-xs font-semibold text-stone-600">{etiqueta}</span>}
        </span>
        <span className="text-right shrink-0">
          <Saldo texto={c.saldo} moneda={c.moneda} />
        </span>
      </Link>
    </li>
  );
}

export function nombrePersona(m: Pick<MovimientoCuenta, "persona_tipo" | "persona_nombre">): string {
  return m.persona_tipo === "sin_identificar" ? "Sin identificar" : m.persona_nombre || "Sin identificar";
}

/** Una línea de movimiento. `cuentaRef`: se está viendo ESA cuenta (se muestra el efecto sobre ella y no su nombre). */
export function FilaMovimiento({
  m, cuentaRef, alAnular, alReactivar, alHistorial,
}: {
  m: MovimientoCuenta;
  cuentaRef?: number;
  alAnular?: (m: MovimientoCuenta) => void;
  alReactivar?: (m: MovimientoCuenta) => void;
  alHistorial?: (m: MovimientoCuenta) => void;
}) {
  const efecto = m.efecto !== null && m.efecto !== undefined ? aMonto(m.efecto) : null;
  const titulo = m.tipo === "traspaso" ? `Traspaso a ${m.cuenta_destino_nombre}` : NOMBRE_MOVIMIENTO[m.tipo];
  const dondeEstoy = m.tipo === "traspaso" && cuentaRef !== undefined && m.cuenta_destino_id === cuentaRef;
  const tituloFinal = m.tipo === "traspaso" ? (dondeEstoy ? `Traspaso desde ${m.cuenta_nombre}` : titulo) : titulo;
  const detalles = [
    nombrePersona(m),
    fechaCorta(m.fecha),
    cuentaRef === undefined ? m.cuenta_nombre : null,
    m.tipo === "retiro" && m.comision && aMonto(m.comision) !== 0n ? `comisión ${formatearTexto(m.comision, m.moneda)}` : null,
    m.tipo === "ajuste" && m.saldo_declarado ? `saldo contado ${formatearTexto(m.saldo_declarado, m.moneda)}` : null,
  ].filter(Boolean);
  return (
    <li data-testid="fila-movimiento" data-tipo={m.tipo} data-anulado={m.anulado || undefined} className="py-3 space-y-1">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className={`font-semibold ${m.anulado ? "line-through text-stone-500" : ""}`}>{tituloFinal}</p>
          <p className="text-sm text-stone-600">{detalles.join(" · ")}</p>
          {m.nota && <p className="text-sm text-stone-700 break-words">{m.nota}</p>}
          {m.anulado && <p className="text-sm font-semibold text-red-700">Anulado{m.motivo_anulacion ? ` · ${m.motivo_anulacion}` : ""}</p>}
        </div>
        <p className={`shrink-0 font-titulo font-bold ${m.anulado ? "line-through text-stone-500" : efecto !== null ? (esNegativo(efecto) ? "text-red-700" : "text-arca") : ""}`}>
          {efecto !== null ? `${esNegativo(efecto) ? "" : "+"}${formatear(efecto, m.moneda)}` : formatearTexto(m.monto, m.moneda)}
        </p>
      </div>
      {(alAnular || alReactivar || alHistorial) && (
        <div className="flex flex-wrap gap-2">
          {alHistorial && (
            <button type="button" onClick={() => alHistorial(m)} className="min-h-[44px] px-3 rounded-xl text-sm font-semibold text-arca active:bg-arca-claro">
              Historial
            </button>
          )}
          {m.puede_registrar && !m.anulado && alAnular && (
            <button type="button" onClick={() => alAnular(m)} className="min-h-[44px] px-3 rounded-xl text-sm font-semibold text-red-700 active:bg-red-50">
              Anular
            </button>
          )}
          {m.puede_registrar && m.anulado && alReactivar && (
            <button type="button" onClick={() => alReactivar(m)} className="min-h-[44px] px-3 rounded-xl text-sm font-semibold text-arca active:bg-arca-claro">
              Reactivar
            </button>
          )}
        </div>
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
