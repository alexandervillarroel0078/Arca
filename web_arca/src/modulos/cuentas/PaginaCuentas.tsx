import { useState } from "react";
import { Link } from "react-router-dom";
import { ChipInterruptor } from "../../core/ChipFiltro";
import Encabezado from "../../core/Encabezado";
import { Boton, Cargando, ErrorCaja, Tarjeta, Vacio, claseBotonPrimario, useCarga } from "../../core/ui";
import { listarCuentas, listarMovimientosCuentas } from "./api";
import { BloqueMoneda, FilaCuenta, FilaMovimiento } from "./componentes";
import { cuentasRegistrables } from "./permisos";

/** Inicio de Cuentas: un total por moneda (sin sumar monedas distintas), las cuentas que ves y lo último que pasó. */
export default function PaginaCuentas() {
  const [verAnuladas, setVerAnuladas] = useState(false);
  const { datos, error, cargando, recargar } = useCarga(() => listarCuentas(verAnuladas), [verAnuladas]);
  const movs = useCarga(() => listarMovimientosCuentas({ limite: 8 }), []);
  const puedeRegistrar = !!datos && cuentasRegistrables(datos.cuentas).length > 0;

  return (
    <div className="space-y-4">
      <Encabezado titulo="Cuentas" volverA="/familia" />
      <p className="text-sm text-stone-600">Cuánto entra y sale de las cuentas bancarias, cripto y efectivo de la familia. No cuenta como ingreso ni gasto.</p>

      <ErrorCaja mensaje={error} />
      {cargando && !datos && <Cargando />}

      {datos && (
        <>
          <div className="grid grid-cols-1 gap-3" aria-label="Totales por moneda" role="group">
            {datos.totales.map((t) => (
              <BloqueMoneda key={t.moneda} moneda={t.moneda} total={t.total} cuentas={t.cuentas} hayNegativas={t.hay_negativas} />
            ))}
          </div>
          {datos.privadas_propias > 0 && (
            <p data-testid="aviso-privadas" className="text-sm text-stone-600">
              Incluye tus {datos.privadas_propias} {datos.privadas_propias === 1 ? "cuenta privada" : "cuentas privadas"}.
            </p>
          )}

          <div className="grid grid-cols-1 gap-2">
            <Link to="/cuentas/nueva" className={claseBotonPrimario}>Nueva cuenta</Link>
            {puedeRegistrar && (
              <Link
                to="/cuentas/movimiento"
                className="flex items-center justify-center w-full min-h-[48px] px-4 rounded-campo font-semibold bg-white text-stone-900 border-[1.5px] border-stone-300 active:bg-stone-100"
              >
                Registrar movimiento
              </Link>
            )}
          </div>

          {datos.cuentas.length === 0 ? (
            <Vacio icono="🏦" texto="Todavía no hay cuentas que puedas ver. Crea la primera para empezar a llevar sus movimientos." />
          ) : (
            <section aria-labelledby="titulo-cuentas" className="space-y-2">
              <h2 id="titulo-cuentas" className="font-titulo text-lg font-bold">Tus cuentas</h2>
              <ul className="space-y-2" aria-label="Cuentas">
                {datos.cuentas.map((c) => <FilaCuenta key={c.id} c={c} />)}
              </ul>
            </section>
          )}
          <ChipInterruptor etiqueta="Ver cuentas anuladas" activo={verAnuladas} alCambiar={setVerAnuladas} />

          <section aria-labelledby="titulo-ultimos" className="space-y-2">
            <h2 id="titulo-ultimos" className="font-titulo text-lg font-bold">Últimos movimientos</h2>
            {movs.cargando && !movs.datos && <Cargando />}
            <ErrorCaja mensaje={movs.error} />
            {movs.datos && movs.datos.length === 0 && <p className="text-sm text-stone-600">Todavía no hay movimientos.</p>}
            {movs.datos && movs.datos.length > 0 && (
              <Tarjeta className="!py-0">
                <ul className="divide-y divide-stone-100" aria-label="Últimos movimientos">
                  {movs.datos.map((m) => <FilaMovimiento key={m.id} m={m} />)}
                </ul>
              </Tarjeta>
            )}
          </section>
          <Boton variante="suave" onClick={() => { recargar(); movs.recargar(); }}>Actualizar</Boton>
        </>
      )}
    </div>
  );
}
