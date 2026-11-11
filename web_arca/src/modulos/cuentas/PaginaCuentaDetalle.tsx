import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChipFiltro, ChipInterruptor } from "../../core/ChipFiltro";
import Encabezado, { AccionFija } from "../../core/Encabezado";
import HojaOpciones from "../../core/HojaOpciones";
import { mesActual, mesDesplazado, nombreMes } from "../../core/formato";
import { useAnular } from "../../core/useAnular";
import { Boton, Cargando, ErrorCaja, Tarjeta, Vacio, claseBotonPrimario, useCarga } from "../../core/ui";
import DialogoHistorial, { type PedidoHistorial } from "../historial/DialogoHistorial";
import { anularCuenta, anularMovimientoCuenta, listarMovimientosCuentas, obtenerCuenta, reactivarCuenta, reactivarMovimientoCuenta, type MovimientoCuenta } from "./api";
import { AvisoNegativo, FilaMovimiento, NOMBRE_MOVIMIENTO, Saldo, descripcionCuenta, useManejoError } from "./componentes";
import { formatear, formatearTexto } from "./montos";
import { permisosDeCuenta, puedeAnularMovimiento } from "./permisos";
import { filtrarPorPersona, limitesDeMes, personasDe, resumenMes } from "./resumen";

/** Detalle de una cuenta: saldo, lo que entró y salió en el mes, filtro por persona y los movimientos del mes. */
export default function PaginaCuentaDetalle() {
  const id = Number(useParams().id);
  const [mes, setMes] = useState(mesActual());
  const [persona, setPersona] = useState("");
  const [hoja, setHoja] = useState(false);
  const [verAnulados, setVerAnulados] = useState(false);
  const [historial, setHistorial] = useState<PedidoHistorial | null>(null);

  const cuenta = useCarga(() => obtenerCuenta(id), [id]);
  const { desde, hasta } = limitesDeMes(mes);
  const movs = useCarga(() => listarMovimientosCuentas({ cuenta: id, desde, hasta, verAnulados: true, limite: 500 }), [id, mes]);
  // el servidor manda: tras cualquier acción (o rechazo) se vuelve a pedir todo
  const recargar = () => { cuenta.recargar(); movs.recargar(); };
  const alError = useManejoError(recargar);
  const anular = useAnular(recargar);

  const lista = movs.datos ?? [];
  const personas = useMemo(() => personasDe(lista), [lista]);
  const visibles = filtrarPorPersona(lista, persona).filter((m) => verAnulados || !m.anulado);
  const resumen = useMemo(() => resumenMes(filtrarPorPersona(lista, persona)), [lista, persona]);

  if (!Number.isFinite(id)) return <Vacio texto="Cuenta no encontrada." />;
  const c = cuenta.datos;
  if (cuenta.error && !c) {
    return (
      <div className="space-y-4">
        <Encabezado titulo="Cuenta" volverA="/cuentas" />
        <ErrorCaja mensaje={cuenta.error} />
      </div>
    );
  }
  if (!c) return <Cargando />;
  const permisos = permisosDeCuenta(c);
  const textoPersona = personas.find((p) => p.valor === persona)?.texto ?? "Todas las personas";

  const pedirAnularMovimiento = (m: MovimientoCuenta) =>
    anular.pedirAnular({
      titulo: "Anular movimiento",
      detalle: `${NOMBRE_MOVIMIENTO[m.tipo]} · ${formatearTexto(m.monto, m.moneda)}`,
      advertencia: m.tipo === "traspaso" ? "Se anula el traspaso completo: el dinero vuelve a la cuenta de origen." : undefined,
      anular: (motivo) => anularMovimientoCuenta(m, motivo).catch((e) => { alError(e); throw e; }),
      reactivar: () => reactivarMovimientoCuenta(m),
    });
  const reactivarMovimiento = async (m: MovimientoCuenta) => {
    try {
      await reactivarMovimientoCuenta(m);
    } catch (e) {
      alError(e);
      return;
    }
    recargar();
  };

  return (
    <div className="space-y-4">
      <Encabezado titulo={c.nombre} volverA="/cuentas" />
      <Tarjeta className="space-y-2">
        <p className="text-sm text-stone-600">{descripcionCuenta(c)}{c.anulado && " · Anulada"}</p>
        <p className="text-sm font-semibold text-stone-600">Saldo</p>
        <Saldo texto={c.saldo} moneda={c.moneda} grande avisar />
        {c.saldo_negativo && <AvisoNegativo />}
        <p className="text-xs text-stone-600">
          Dueño: {c.usuario_nombre}{c.encargado_nombre ? ` · Encargado: ${c.encargado_nombre}` : ""}
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Boton variante="suave" className="!min-h-[44px]" onClick={() => setHistorial({ entidad: "cuenta", id: c.id, titulo: c.nombre })}>Historial</Boton>
          {permisos.editar && <Link to={`/cuentas/${c.id}/editar`} className="inline-flex items-center justify-center min-h-[44px] px-4 rounded-campo font-semibold bg-white border-[1.5px] border-stone-300 active:bg-stone-100">Editar</Link>}
          {permisos.editar && !c.anulado && (
            <Boton
              variante="peligro"
              className="!min-h-[44px]"
              onClick={() => anular.pedirAnular({
                titulo: "Anular cuenta",
                detalle: c.nombre,
                advertencia: "La cuenta deja de sumar en los totales. Sus movimientos se conservan y puedes reactivarla.",
                anular: (motivo) => anularCuenta(c, motivo).catch((e) => { alError(e); throw e; }),
                reactivar: () => reactivarCuenta(c),
              })}
            >
              Anular cuenta
            </Boton>
          )}
          {permisos.editar && c.anulado && (
            <Boton variante="suave" className="!min-h-[44px]" onClick={() => reactivarCuenta(c).then(recargar).catch(alError)}>Reactivar cuenta</Boton>
          )}
        </div>
      </Tarjeta>

      <div className="flex items-center justify-between gap-2" role="group" aria-label="Mes">
        <button type="button" aria-label="Mes anterior" onClick={() => setMes(mesDesplazado(mes, -1))} className="min-h-[44px] min-w-[44px] text-2xl text-arca">‹</button>
        <h2 className="font-titulo text-lg font-bold" data-testid="mes-cuenta">{nombreMes(mes)}</h2>
        <button type="button" aria-label="Mes siguiente" disabled={mes >= mesActual()} onClick={() => setMes(mesDesplazado(mes, 1))} className="min-h-[44px] min-w-[44px] text-2xl text-arca disabled:opacity-30">›</button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Tarjeta><p className="text-sm font-semibold text-stone-600">Entró</p><p data-testid="entro" className="font-titulo text-lg font-bold text-arca">{formatear(resumen.entro, c.moneda)}</p></Tarjeta>
        <Tarjeta><p className="text-sm font-semibold text-stone-600">Salió</p><p data-testid="salio" className="font-titulo text-lg font-bold text-red-700">{formatear(resumen.salio, c.moneda)}</p></Tarjeta>
      </div>
      <p className="text-sm text-stone-600" data-testid="aparte">
        Aparte (no suman a Entró ni Salió): traspasos {formatear(resumen.traspasos, c.moneda)} · ajustes por conteo {formatear(resumen.ajustes, c.moneda)}
      </p>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtros">
        <ChipFiltro etiqueta="Persona" texto={textoPersona} activo={!!persona} alAbrir={() => setHoja(true)} />
        <ChipInterruptor etiqueta="Ver anulados" activo={verAnulados} alCambiar={setVerAnulados} />
      </div>

      <ErrorCaja mensaje={movs.error} />
      {movs.cargando && !movs.datos && <Cargando />}
      {movs.datos && visibles.length === 0 && (
        <Vacio icono="🧾" texto={`No hay movimientos en ${nombreMes(mes).toLowerCase()}${persona ? " con esta persona" : ""}.`} />
      )}
      {visibles.length > 0 && (
        <Tarjeta className="!py-0">
          <ul className="divide-y divide-stone-100" aria-label="Movimientos del mes">
            {visibles.map((m) => (
              <FilaMovimiento
                key={m.id}
                m={m}
                cuentaRef={c.id}
                alHistorial={(x) => setHistorial({ entidad: "cuenta_mov", id: x.id, titulo: `${x.tipo} · ${x.monto}` })}
                alAnular={puedeAnularMovimiento(m) ? pedirAnularMovimiento : undefined}
                alReactivar={puedeAnularMovimiento(m) ? reactivarMovimiento : undefined}
              />
            ))}
          </ul>
        </Tarjeta>
      )}

      {permisos.registrar && (
        <AccionFija>
          <Link to={`/cuentas/movimiento?cuenta=${c.id}`} className={claseBotonPrimario}>Registrar en esta cuenta</Link>
        </AccionFija>
      )}
      {hoja && (
        <HojaOpciones
          titulo="Persona"
          opciones={[{ valor: "", texto: "Todas las personas" }, ...personas]}
          valor={persona}
          alElegir={(v) => { setPersona(v); setHoja(false); }}
          alCerrar={() => setHoja(false)}
        />
      )}
      {historial && <DialogoHistorial pedido={historial} alCerrar={() => setHistorial(null)} />}
      {anular.dialogo}
    </div>
  );
}
