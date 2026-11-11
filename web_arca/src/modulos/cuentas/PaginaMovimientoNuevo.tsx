import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAviso } from "../../core/Aviso";
import Encabezado, { AccionFija } from "../../core/Encabezado";
import { hoyISO } from "../../core/formato";
import { AvisoRevisar, Boton, Campo, Cargando, ErrorCaja, Vacio, claseInput, claseRevisar, useCarga } from "../../core/ui";
import { nuevoUuid } from "../../core/uuid";
import { listarMiembros } from "../familia/api";
import {
  listarCuentas, listarMovimientosCuentas, registrarAjuste, registrarDeposito, registrarRetiro, registrarTraspaso,
  type Cuenta, type MovimientoCuenta, type Persona, type PersonaTipo, type TipoMovimiento,
} from "./api";
import BotonDictar from "./BotonDictar";
import { AvisoNegativo, AvisoNota, NOMBRE_MOVIMIENTO, useManejoError } from "./componentes";
import { interpretarDictado, type CampoDictado, type Eleccion } from "./dictadoInterprete";
import { aMonto, errorDeMonto, formatear, formatearTexto, abs, esNegativo, NOMBRE_MONEDA, type Moneda } from "./montos";
import { cuentasRegistrables, destinosDeTraspaso } from "./permisos";
import { guardarUltimo, leerUltimo } from "./recordar";
import { sugerenciasDeNombres } from "./resumen";

const TIPOS: TipoMovimiento[] = ["deposito", "retiro", "traspaso", "ajuste"];
const MONTOS_RAPIDOS = [50, 100, 200, 500];
/** Los montos rápidos (50, 100, 200, 500) tienen sentido en Bs, USD y USDT; en BTC no. */
const conMontosRapidos = (m: Moneda) => m !== "BTC";

/** Nuevo movimiento de una cuenta: depósito, retiro, traspaso o ajuste por conteo. El servidor manda sobre lo que se ve. */
export default function PaginaMovimientoNuevo() {
  const [params] = useSearchParams();
  const navegar = useNavigate();
  const avisar = useAviso();
  const cuentasQ = useCarga(() => listarCuentas(false), []);
  const miembrosQ = useCarga(() => listarMiembros(), []);
  const usadosQ = useCarga(() => listarMovimientosCuentas({ limite: 200 }), []);
  const alError = useManejoError(cuentasQ.recargar);

  const tipoInicial = TIPOS.includes(params.get("tipo") as TipoMovimiento) ? (params.get("tipo") as TipoMovimiento) : "deposito";
  const [tipo, setTipo] = useState<TipoMovimiento>(tipoInicial);
  const [cuentaId, setCuentaId] = useState<number | null>(null);
  const [destinoId, setDestinoId] = useState<number | null>(null);
  const [monto, setMonto] = useState("");
  const [comision, setComision] = useState("");
  const [saldoReal, setSaldoReal] = useState("");
  const [fecha, setFecha] = useState(hoyISO());
  const [personaTipo, setPersonaTipo] = useState<PersonaTipo>("sin_identificar");
  const [miembroId, setMiembroId] = useState<number | null>(null);
  const [otra, setOtra] = useState("");
  const [nota, setNota] = useState("");
  const [intento, setIntento] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [errorServidor, setErrorServidor] = useState<string | null>(null);
  // dictado: lo que no se entendió queda por revisar (resaltado) y, si hay dudas entre cuentas, se elige con un toque
  const [porRevisar, setPorRevisar] = useState<Partial<Record<CampoDictado, string>>>({});
  const [elecciones, setElecciones] = useState<Eleccion[]>([]);
  const [mensajeDictado, setMensajeDictado] = useState("");
  const uuid = useRef(nuevoUuid()); // reintentar el mismo envío no duplica el movimiento
  const inicializado = useRef(false);

  const cuentas = cuentasQ.datos?.cuentas ?? [];
  const registrables = cuentasRegistrables(cuentas);
  const cuenta = registrables.find((c) => c.id === cuentaId);
  const destinos = destinosDeTraspaso(cuenta, cuentas);
  const destino = destinos.find((c) => c.id === destinoId);
  const moneda = cuenta?.moneda ?? "BS";
  const miembros = (miembrosQ.datos ?? []).filter((m) => m.activo);

  // valores iniciales (una sola vez): la cuenta del enlace, o la última usada, o la primera; y la última persona
  useEffect(() => {
    if (inicializado.current || !cuentasQ.datos || !miembrosQ.datos) return;
    inicializado.current = true;
    const ult = leerUltimo();
    const deEnlace = Number(params.get("cuenta"));
    const elegida = registrables.find((c) => c.id === deEnlace) ?? registrables.find((c) => c.id === ult.cuenta_id) ?? registrables[0];
    setCuentaId(elegida?.id ?? null);
    if (ult.persona_tipo === "miembro" && miembros.some((m) => m.usuario_id === ult.persona_usuario_id)) {
      setPersonaTipo("miembro");
      setMiembroId(ult.persona_usuario_id ?? null);
    }
    // «Otra persona» no se recuerda: su nombre no se guarda, y un tipo sin nombre solo estorbaría
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cuentasQ.datos, miembrosQ.datos]);

  // si el servidor cambió los permisos (ya no puedes registrar en la cuenta elegida) se elige otra
  useEffect(() => {
    if (!inicializado.current || !cuentasQ.datos) return;
    if (cuentaId !== null && !registrables.some((c) => c.id === cuentaId)) setCuentaId(registrables[0]?.id ?? null);
    if (destinoId !== null && !destinos.some((c) => c.id === destinoId)) setDestinoId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cuentasQ.datos, cuentaId]);

  const sugerencias = useMemo(() => sugerenciasDeNombres(usadosQ.datos ?? [], otra), [usadosQ.datos, otra]);

  // ---- ajuste por conteo: la diferencia se muestra ANTES de guardar
  const saldoActual = cuenta ? aMonto(cuenta.saldo) : null;
  const real = aMonto(saldoReal);
  const diferencia = tipo === "ajuste" && saldoActual !== null && real !== null ? real - saldoActual : null;

  // ---- errores
  const errores: Record<string, string | null> = {
    cuenta: cuenta ? null : "Elige la cuenta",
    destino: tipo === "traspaso" && !destino ? "Elige la cuenta de destino" : null,
    monto: tipo === "ajuste" ? null : errorDeMonto(monto, moneda),
    comision: tipo === "retiro" ? errorDeMonto(comision, moneda, { positivo: false, obligatorio: false }) : null,
    saldoReal: tipo === "ajuste" ? errorDeMonto(saldoReal, moneda, { positivo: false, negativo: true }) : null,
    persona:
      personaTipo === "miembro" && miembroId === null ? "Elige a la persona"
      : personaTipo === "otra" && !otra.trim() ? "Escribe el nombre" : null,
  };
  const hayErrores = Object.values(errores).some(Boolean);
  const sinDiferencia = tipo === "ajuste" && diferencia !== null && diferencia === 0n;
  const mostrar = (k: string) => (intento ? errores[k] : null);

  function persona(): Persona {
    if (personaTipo === "miembro") return { persona_tipo: "miembro", persona_usuario_id: miembroId ?? undefined };
    if (personaTipo === "otra") return { persona_tipo: "otra", persona_nombre: otra.trim() };
    return { persona_tipo: "sin_identificar" };
  }

  /** El usuario tocó o corrigió estos campos: dejan de estar «por revisar». */
  function quitarRevision(...campos: CampoDictado[]) {
    setPorRevisar((p) => (campos.some((c) => c in p) ? Object.fromEntries(Object.entries(p).filter(([k]) => !campos.includes(k as CampoDictado))) : p));
    setElecciones((e) => (e.some((x) => campos.includes(x.campo)) ? e.filter((x) => !campos.includes(x.campo)) : e));
  }

  /**
   * Dictado (entrega A: tipo, cuenta, destino y monto). SOLO rellena el formulario con los mismos setters que usa el teclado:
   * no guarda nada, y lo que no entendió queda vacío o conservado pero resaltado. Guardar sigue siendo el único camino.
   */
  function alDictar(frases: string[]) {
    const r = interpretarDictado(frases, { cuentas: registrables, cuentaActualId: cuentaId });
    if (r.ajuste || (r.tipo === null && tipo === "ajuste")) {
      setMensajeDictado("El ajuste por conteo no se dicta. Elige «Ajuste por conteo» en el tipo de movimiento y escribe tú el saldo contado.");
      return;
    }
    const revisar = Object.keys(r.porRevisar).length;
    if (r.rellenados === 0 && r.elecciones.length === 0) {
      setMensajeDictado("No entendí nada del dictado. Inténtalo otra vez o llena el formulario a mano.");
      return;
    }
    setIntento(false);
    setErrorServidor(null);
    if (r.tipo) setTipo(r.tipo);
    if (r.cuentaId !== null) setCuentaId(r.cuentaId);
    if (r.tipo === "traspaso") setDestinoId(r.destinoId);
    else if (r.tipo !== null) setDestinoId(null);
    setMonto(r.monto ?? "");
    setPorRevisar(r.porRevisar);
    setElecciones(r.elecciones);
    setMensajeDictado(
      `Dictado aplicado: ${r.rellenados} ${r.rellenados === 1 ? "campo rellenado" : "campos rellenados"}, ${revisar} por revisar. Revisa y toca Guardar cuando esté bien.`,
    );
    setTimeout(() => document.querySelector('[data-revisar="true"]')?.scrollIntoView?.({ block: "center", behavior: "smooth" }), 0);
  }

  function elegirCuentaDictada(c: Cuenta) {
    setCuentaId(c.id);
    quitarRevision("cuenta");
    // la moneda de la cuenta elegida puede no admitir los decimales dictados: no se redondea, se vacía y se marca
    const e = monto.trim() ? errorDeMonto(monto, c.moneda) : null;
    if (e) {
      setPorRevisar((p) => ({ ...p, monto: `Escuché ${monto.trim()}: ${e}` }));
      setMonto("");
    }
  }
  function elegirDestinoDictado(c: Cuenta) {
    setDestinoId(c.id);
    quitarRevision("destino");
  }
  const fichas = (campo: "cuenta" | "destino", elegir: (c: Cuenta) => void) => {
    const e = elecciones.find((x) => x.campo === campo);
    if (!e) return null;
    const opciones = e.opciones.map((id) => registrables.find((c) => c.id === id)).filter((c): c is Cuenta => !!c);
    return (
      <div className="flex flex-wrap gap-2" role="group" aria-label={campo === "cuenta" ? "Elige la cuenta" : "Elige la cuenta de destino"} data-testid={`eleccion-${campo}`}>
        {opciones.map((c) => (
          <button key={c.id} type="button" onClick={() => elegir(c)} className="min-h-[44px] px-4 rounded-full border-[1.5px] border-stone-300 bg-white text-sm font-semibold active:bg-stone-100">
            {[c.nombre, c.banco_otro ?? c.banco, NOMBRE_MONEDA[c.moneda]].filter(Boolean).join(" · ")}
          </button>
        ))}
      </div>
    );
  };

  /** Lleva la vista al primer campo con error (el botón de guardar está abajo y los errores pueden quedar fuera de pantalla). */
  function mostrarPrimerError() {
    setTimeout(() => document.querySelector('[role="alert"]')?.scrollIntoView?.({ block: "center", behavior: "smooth" }), 0); // (jsdom no lo implementa)
  }

  async function guardar() {
    setIntento(true);
    setErrorServidor(null);
    if (hayErrores || sinDiferencia || !cuenta) {
      mostrarPrimerError();
      return;
    }
    const comun = { fecha, nota: nota.trim() || undefined, uuid_cliente: uuid.current, ...persona() };
    setOcupado(true);
    try {
      let r: MovimientoCuenta;
      if (tipo === "deposito") r = await registrarDeposito(cuenta.id, { ...comun, monto: monto.trim().replace(",", ".") });
      else if (tipo === "retiro")
        r = await registrarRetiro(cuenta.id, { ...comun, monto: monto.trim().replace(",", "."), comision: comision.trim() ? comision.trim().replace(",", ".") : undefined });
      else if (tipo === "traspaso")
        r = await registrarTraspaso({ ...comun, cuenta_id: cuenta.id, cuenta_destino_id: destino!.id, monto: monto.trim().replace(",", ".") });
      else r = await registrarAjuste(cuenta.id, { ...comun, saldo_declarado: saldoReal.trim().replace(",", ".") });

      guardarUltimo({ cuenta_id: cuenta.id, persona_tipo: personaTipo === "otra" ? "sin_identificar" : personaTipo, persona_usuario_id: miembroId ?? undefined });
      // el servidor manda: si calculó otra cosa que lo mostrado, se dice
      if (tipo === "ajuste" && r.saldo_previo !== null && saldoActual !== null && aMonto(r.saldo_previo) !== saldoActual) {
        avisar(
          `Registrado, pero el saldo cambió mientras tanto: se ajustó sobre ${formatearTexto(r.saldo_previo, cuenta.moneda)} (veías ${formatear(saldoActual, cuenta.moneda)}). Diferencia: ${formatearTexto(r.monto, cuenta.moneda)}.`,
          "info",
        );
      } else if (r.deja_saldo_negativo) {
        avisar(`Registrado. La cuenta quedó en negativo (${formatearTexto(r.saldo_resultante, cuenta.moneda)}); puedes revisarlo con un ajuste por conteo.`, "info");
      } else avisar("Movimiento registrado");
      navegar(`/cuentas/${cuenta.id}`, { replace: true });
    } catch (e) {
      setErrorServidor((e as Error).message);
      alError(e);
      setOcupado(false);
    }
  }

  if (cuentasQ.cargando && !cuentasQ.datos) return <Cargando />;
  if (cuentasQ.error && !cuentasQ.datos) {
    return (
      <div className="space-y-4">
        <Encabezado titulo="Nuevo movimiento" volverA="/cuentas" />
        <ErrorCaja mensaje={cuentasQ.error} />
      </div>
    );
  }
  if (cuentasQ.datos && registrables.length === 0) {
    return (
      <div className="space-y-4">
        <Encabezado titulo="Nuevo movimiento" volverA="/cuentas" />
        <Vacio icono="🏦" texto="No tienes cuentas donde puedas registrar movimientos. Crea una cuenta o pide que te designen encargado." accion={{ texto: "Nueva cuenta", a: "/cuentas/nueva" }} />
      </div>
    );
  }

  const rapidos = conMontosRapidos(moneda) && tipo !== "ajuste";
  const quedaNegativo = (tipo === "retiro" || tipo === "traspaso") && cuenta && saldoActual !== null && aMonto(monto) !== null
    ? saldoActual - (aMonto(monto) ?? 0n) - (tipo === "retiro" ? aMonto(comision) ?? 0n : 0n) < 0n
    : false;

  return (
    <div className="space-y-4">
      <Encabezado titulo="Nuevo movimiento" volverA={cuenta ? `/cuentas/${cuenta.id}` : "/cuentas"} />

      <div className={porRevisar.tipo ? claseRevisar : undefined} data-revisar={porRevisar.tipo ? "true" : undefined}>
        <span id="etiqueta-tipo-mov" className="block text-sm font-semibold text-stone-600 mb-1.5">Tipo de movimiento</span>
        <div role="radiogroup" aria-labelledby="etiqueta-tipo-mov" className="grid grid-cols-2 gap-1 bg-stone-200 rounded-xl p-1">
          {TIPOS.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={tipo === t}
              onClick={() => { setTipo(t); setIntento(false); setErrorServidor(null); quitarRevision("tipo"); }}
              className={`min-h-[48px] rounded-lg text-sm font-semibold ${tipo === t ? "bg-white text-arca shadow-sm" : "text-stone-700"}`}
            >
              {NOMBRE_MOVIMIENTO[t]}
            </button>
          ))}
        </div>
        <AvisoRevisar mensaje={porRevisar.tipo} />
      </div>

      <BotonDictar listo={!!cuentasQ.datos && !!miembrosQ.datos} alTerminar={alDictar} mensaje={mensajeDictado} />

      <Campo etiqueta={tipo === "traspaso" ? "Desde" : "Cuenta"} error={mostrar("cuenta")} aviso={porRevisar.cuenta}>
        <select className={claseInput} value={cuentaId ?? ""} onChange={(e) => { setCuentaId(Number(e.target.value)); setDestinoId(null); quitarRevision("cuenta"); }}>
          {registrables.map((c) => (
            <option key={c.id} value={c.id}>{c.nombre} · {formatearTexto(c.saldo, c.moneda)}</option>
          ))}
        </select>
      </Campo>
      {fichas("cuenta", elegirCuentaDictada)}

      {tipo === "traspaso" && (
        <>
          <Campo etiqueta="Hacia" error={mostrar("destino")} aviso={porRevisar.destino}>
            <select className={claseInput} value={destinoId ?? ""} onChange={(e) => { setDestinoId(e.target.value ? Number(e.target.value) : null); quitarRevision("destino"); }}>
              <option value="">Elige la cuenta de destino</option>
              {destinos.map((c) => <option key={c.id} value={c.id}>{c.nombre} · {formatearTexto(c.saldo, c.moneda)}</option>)}
            </select>
          </Campo>
          {fichas("destino", elegirDestinoDictado)}
          {destinos.length === 0 && (
            <p className="text-sm text-stone-600" data-testid="sin-destinos">No tienes otra cuenta en {moneda === "BS" ? "Bs" : moneda} donde puedas registrar. Un traspaso solo une cuentas de la misma moneda.</p>
          )}
        </>
      )}

      {tipo === "ajuste" ? (
        <div className="space-y-2">
          <Campo etiqueta={`Saldo real contado (${moneda === "BS" ? "Bs" : moneda})`} error={mostrar("saldoReal")}>
            <input className={claseInput} inputMode="decimal" autoComplete="off" value={saldoReal} onChange={(e) => setSaldoReal(e.target.value)} placeholder="0.00" />
          </Campo>
          {cuenta && saldoActual !== null && (
            <div data-testid="diferencia-ajuste" className="rounded-xl bg-white border border-stone-200 p-3 text-sm space-y-0.5">
              <p>Saldo registrado: <strong>{formatear(saldoActual, cuenta.moneda)}</strong></p>
              {diferencia !== null && (
                <p>
                  Diferencia:{" "}
                  <strong className={diferencia === 0n ? "" : esNegativo(diferencia) ? "text-red-700" : "text-arca"}>
                    {diferencia === 0n ? "ninguna" : `${esNegativo(diferencia) ? "−" : "+"}${formatear(abs(diferencia), cuenta.moneda)}`}
                  </strong>
                  {diferencia !== 0n && (esNegativo(diferencia) ? " (se registra como salida)" : " (se registra como entrada)")}
                </p>
              )}
              {sinDiferencia && <p className="font-semibold text-stone-700">El saldo contado coincide con el registrado: no hay nada que ajustar.</p>}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <Campo etiqueta={`Monto (${moneda === "BS" ? "Bs" : moneda})`} error={mostrar("monto")} aviso={porRevisar.monto}>
            <input className={claseInput} inputMode="decimal" autoComplete="off" value={monto} onChange={(e) => { setMonto(e.target.value); quitarRevision("monto"); }} placeholder="0.00" />
          </Campo>
          {rapidos && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Montos rápidos">
              {MONTOS_RAPIDOS.map((n) => (
                <button key={n} type="button" onClick={() => { setMonto(String(n)); quitarRevision("monto"); }} className="min-h-[44px] min-w-[64px] px-4 rounded-full border-[1.5px] border-stone-300 bg-white font-semibold active:bg-stone-100">
                  {n}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {tipo === "retiro" && cuenta?.tipo === "cripto" && (
        <Campo etiqueta={`Comisión de red (opcional, ${moneda})`} error={mostrar("comision")}>
          <input className={claseInput} inputMode="decimal" autoComplete="off" value={comision} onChange={(e) => setComision(e.target.value)} placeholder="0" />
          <span className="block text-xs text-stone-600 mt-1">Se descuenta además del monto.</span>
        </Campo>
      )}
      {quedaNegativo && <AvisoNegativo texto="Con este movimiento la cuenta quedará en negativo. Se puede registrar igual." />}

      <fieldset className="space-y-2">
        <legend className="block text-sm font-semibold text-stone-600 mb-1.5">Persona</legend>
        <div role="radiogroup" aria-label="Tipo de persona" className="grid grid-cols-3 gap-1 bg-stone-200 rounded-xl p-1">
          {([["miembro", "Miembro"], ["otra", "Otra persona"], ["sin_identificar", "Sin identificar"]] as [PersonaTipo, string][]).map(([v, t]) => (
            <button key={v} type="button" role="radio" aria-checked={personaTipo === v} onClick={() => setPersonaTipo(v)}
              className={`min-h-[48px] rounded-lg text-sm font-semibold leading-tight ${personaTipo === v ? "bg-white text-arca shadow-sm" : "text-stone-700"}`}>
              {t}
            </button>
          ))}
        </div>
        {personaTipo === "miembro" && (
          <Campo etiqueta="¿Quién de la familia?" error={mostrar("persona")}>
            <select className={claseInput} value={miembroId ?? ""} onChange={(e) => setMiembroId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Elige a la persona</option>
              {miembros.map((m) => <option key={m.usuario_id} value={m.usuario_id}>{m.nombre}</option>)}
            </select>
          </Campo>
        )}
        {personaTipo === "otra" && (
          <div className="space-y-2">
            <Campo etiqueta="Nombre de la otra persona" error={mostrar("persona")}>
              <input className={claseInput} maxLength={80} autoComplete="off" value={otra} onChange={(e) => setOtra(e.target.value)} />
            </Campo>
            {sugerencias.length > 0 && (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Nombres usados antes">
                {sugerencias.map((n) => (
                  <button key={n} type="button" onClick={() => setOtra(n)} className="min-h-[44px] px-4 rounded-full border-[1.5px] border-stone-300 bg-white text-sm font-semibold active:bg-stone-100">
                    {n}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </fieldset>

      <Campo etiqueta="Fecha">
        <input className={claseInput} type="date" max={hoyISO()} value={fecha} onChange={(e) => setFecha(e.target.value)} />
      </Campo>

      <div>
        <label htmlFor="nota-movimiento" className="block text-sm font-semibold text-stone-600 mb-1.5">Nota (opcional)</label>
        <textarea
          id="nota-movimiento"
          aria-describedby="aviso-nota-movimiento"
          maxLength={500}
          rows={2}
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          className={`${claseInput} py-3 min-h-[88px]`}
        />
        <AvisoNota id="aviso-nota-movimiento" />
      </div>

      <ErrorCaja mensaje={errorServidor} />
      <AccionFija>
        <Boton onClick={guardar} disabled={ocupado || sinDiferencia}>{ocupado ? "Guardando..." : `Guardar ${NOMBRE_MOVIMIENTO[tipo].toLowerCase()}`}</Boton>
      </AccionFija>
    </div>
  );
}
