import { describirComparacion, type Comparacion } from "../../core/comparacion";
import { bs, iconoDe, nombreMes } from "../../core/formato";
import { usePeriodo } from "../../core/PeriodoContext";
import SelectorPeriodo from "../../core/SelectorPeriodo";
import { NotaPrivados } from "../privacidad/Etiquetas";
import { Cargando, ErrorCaja, SinDatosPeriodo, Tarjeta, Titulo, Vacio, useCarga } from "../../core/ui";
import { useEnCola } from "../sync/useSync";
import { porCategoria, porMiembro, resumenPeriodo, tendencia } from "./api";

/** No hay base para comparar: el periodo anterior estaba en cero (no se divide por cero). */
const sinBase = (c: Comparacion) => c.porcentaje === null;

/**
 * "▲ 12 % mas que el periodo anterior (+Bs 120.00)": flecha y texto, nunca solo color. `masEsBueno` solo ajusta el tono.
 * Sin base de comparacion (periodo anterior en cero) solo se dice: sin flecha ni diferencia en Bs, que no compararian con nada.
 */
function TextoComparacion({ c, masEsBueno, testid }: { c: Comparacion; masEsBueno: boolean; testid?: string }) {
  const d = describirComparacion(c);
  if (sinBase(c)) {
    return (
      <p className="text-sm font-semibold text-stone-600" data-testid={testid}>
        {d.texto}
      </p>
    );
  }
  const bueno = d.direccion === "igual" ? null : (d.direccion === "sube") === masEsBueno;
  const tono = bueno === null ? "text-stone-600" : bueno ? "text-arca" : "text-apoyo-texto";
  return (
    <p className={`text-sm font-semibold ${tono}`} data-testid={testid}>
      <span aria-hidden>{d.flecha}</span> {d.texto}
      {d.detalle && <span className="text-xs font-normal whitespace-nowrap"> ({d.detalle})</span>}
    </p>
  );
}

function TarjetaComparacion({ titulo, valor, c, masEsBueno, id }: { titulo: string; valor: number; c: Comparacion; masEsBueno: boolean; id: string }) {
  return (
    <Tarjeta className="!p-3 space-y-1" >
      <p className="text-xs text-stone-600">{titulo}</p>
      <p className="monto font-titulo font-bold text-lg break-words">{bs(valor)}</p>
      <TextoComparacion c={c} masEsBueno={masEsBueno} testid={`comparacion-${id}`} />
    </Tarjeta>
  );
}

function Barra({ valor, maximo, clase }: { valor: number; maximo: number; clase: string }) {
  return (
    <div className="h-2.5 rounded-full bg-stone-100 overflow-hidden">
      <div className={`h-full rounded-full ${clase}`} style={{ width: `${maximo ? Math.max(2, (valor / maximo) * 100) : 0}%` }} />
    </div>
  );
}

export default function PaginaReportes() {
  const { periodo } = usePeriodo();
  const rango = { desde: periodo.desde, hasta: periodo.hasta };
  const { datos, error, cargando, sinConexion } = useCarga(
    async () => {
      const [resumen, categorias, miembros, meses] = await Promise.all([
        resumenPeriodo(rango, periodo.tipo),
        porCategoria(rango, periodo.tipo),
        porMiembro(rango),
        tendencia(),
      ]);
      return {
        resumen, categorias, miembros: miembros.miembros, meses: meses.meses,
        privados: { miembros: miembros.incluye_privados, meses: meses.incluye_privados },
      };
    },
    [periodo.desde, periodo.hasta, periodo.tipo],
    true,
  );
  const sinEnviar = useEnCola();
  // Si NINGUNA comparacion tiene base (el periodo anterior esta vacio) no se repite el mismo mensaje en cada tarjeta: sale una sola vez
  const comparacion = datos?.resumen.comparacion;
  const hayBase = !!comparacion && [comparacion.ingresos, comparacion.gastos, comparacion.saldo].some((c) => !sinBase(c));

  return (
    <div className="space-y-4">
      <Titulo>Reportes</Titulo>

      <SelectorPeriodo />

      {sinEnviar > 0 && (
        <p role="status" data-testid="aviso-pendientes-reportes" className="rounded-xl bg-apoyo-claro text-apoyo text-sm px-4 py-2">
          Hay {sinEnviar} {sinEnviar === 1 ? "cambio" : "cambios"} sin enviar: el resumen los incluye; las categorías, personas y meses se actualizan al sincronizar.
        </p>
      )}
      {cargando && !datos && <Cargando />}
      {error && !datos && (sinConexion ? <SinDatosPeriodo /> : <ErrorCaja mensaje={error} />)}

      {datos && (
        <>
          {hayBase && (
          <section aria-label="Comparación de totales" className="space-y-2">
            <h2 className="font-titulo font-bold">Comparado con el periodo anterior</h2>
            <p className="text-xs text-stone-600" data-testid="periodo-anterior">
              Comparado {datos.resumen.comparacion.etiqueta}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <TarjetaComparacion id="ingresos" titulo="Ingresos" valor={datos.resumen.ingresos} c={datos.resumen.comparacion.ingresos} masEsBueno />
              <TarjetaComparacion id="gastos" titulo="Gastos" valor={datos.resumen.gastos} c={datos.resumen.comparacion.gastos} masEsBueno={false} />
            </div>
            <TarjetaComparacion id="saldo" titulo="Saldo de efectivo" valor={datos.resumen.saldo} c={datos.resumen.comparacion.saldo} masEsBueno />
          </section>
          )}

          <Tarjeta>
            <h2 className="font-titulo font-bold mb-2">Resumen</h2>
            {!hayBase && (
              <p data-testid="sin-periodo-anterior" className="-mt-1 mb-2 text-sm text-stone-600">
                Sin datos en el periodo anterior ({datos.resumen.comparacion.etiqueta.replace(/^vs /, "")}) para comparar.
              </p>
            )}
            <dl className="monto text-sm space-y-1">
              {[
                ["Ingresos", datos.resumen.ingresos],
                ["Gastos", -datos.resumen.gastos],
                ["Apoyos entregados", -datos.resumen.apoyos_entregados],
                ["Devoluciones", datos.resumen.devoluciones],
              ].map(([t, v]) => (
                <div key={t as string} className="flex justify-between">
                  <dt className="text-stone-600">{t}</dt>
                  <dd className="font-medium">{bs(v as number)}</dd>
                </div>
              ))}
              <div className="flex justify-between border-t border-stone-200 pt-1 mt-1 font-bold">
                <dt>Saldo de efectivo</dt>
                <dd className="text-arca">{bs(datos.resumen.saldo)}</dd>
              </div>
              <div className="flex justify-between text-apoyo pt-1">
                <dt>Apoyos consumidos (gasto familiar)</dt>
                <dd className="font-medium">{bs(datos.resumen.consumido)}</dd>
              </div>
            </dl>
            <NotaPrivados n={datos.resumen.incluye_privados} className="text-arca mt-2" />
          </Tarjeta>

          <Tarjeta>
            <h2 className="font-titulo font-bold mb-3">Gastos por categoría</h2>
            <NotaPrivados n={datos.categorias.incluye_privados} className="text-arca -mt-2 mb-2" />
            {datos.categorias.categorias.length === 0 && datos.categorias.apoyos_consumidos === 0 ? (
              <Vacio icono="📊" texto="Sin gastos en este periodo." accion={{ texto: "Registrar un gasto", a: "/nuevo" }} />
            ) : (
              <ul className="space-y-3">
                {datos.categorias.categorias.map((c) => (
                  <li key={c.categoria_id}>
                    <div className="flex justify-between text-sm mb-1">
                      <span>{iconoDe(c.icono)} {c.categoria} <span className="text-stone-500">({c.porcentaje}%)</span></span>
                      <span className="monto font-medium">{bs(c.total)}</span>
                    </div>
                    <Barra valor={c.total} maximo={datos.categorias.categorias[0].total} clase="bg-arca" />
                    {hayBase && (
                      <div className="mt-0.5"><TextoComparacion c={c.comparacion} masEsBueno={false} testid={`comparacion-categoria-${c.categoria_id}`} /></div>
                    )}
                  </li>
                ))}
                {datos.categorias.apoyos_consumidos > 0 && (
                  <li className="border-t border-dashed border-stone-300 pt-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-apoyo">🤝 Apoyos consumidos (aparte)</span>
                      <span className="monto font-medium text-apoyo">{bs(datos.categorias.apoyos_consumidos)}</span>
                    </div>
                  </li>
                )}
              </ul>
            )}
          </Tarjeta>

          <Tarjeta>
            <h2 className="font-titulo font-bold mb-3">Por persona</h2>
            <NotaPrivados n={datos.privados.miembros} className="text-arca -mt-2 mb-2" />
            <ul className="divide-y divide-stone-100">
              {datos.miembros.map((m) => (
                <li key={m.usuario_id} className="py-2">
                  <p className="font-medium">{m.nombre}</p>
                  <p className="monto text-sm text-stone-600">
                    <span className="whitespace-nowrap">Ingresos {bs(m.ingresos)}</span> · <span className="whitespace-nowrap">Gastos {bs(m.gastos)}</span> ·{" "}
                    <span className="whitespace-nowrap">Apoyos {bs(m.apoyos_entregados)}</span>
                  </p>
                </li>
              ))}
            </ul>
          </Tarjeta>

          <Tarjeta>
            <h2 className="font-titulo font-bold mb-3">Últimos 6 meses</h2>
            <NotaPrivados n={datos.privados.meses} className="text-arca -mt-2 mb-2" />
            {/* que representa cada barra: la verde es de ingresos y la gris de gastos (la misma que lleva cada mes) */}
            <ul aria-label="Leyenda de las barras" data-testid="leyenda-meses" className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-stone-700">
              <li className="flex items-center gap-1.5">
                <span aria-hidden className="inline-block h-2.5 w-5 rounded-full bg-arca" />
                Ingresos
              </li>
              <li className="flex items-center gap-1.5">
                <span aria-hidden className="inline-block h-2.5 w-5 rounded-full bg-stone-500" />
                Gastos
              </li>
            </ul>
            {(() => {
              const max = Math.max(1, ...datos.meses.flatMap((m) => [m.ingresos, m.gastos]));
              return (
                <div className="space-y-3">
                  {datos.meses.map((m) => (
                    <div key={m.mes} data-testid="fila-mes">
                      <div className="flex items-baseline justify-between gap-3 text-sm mb-1">
                        <span className="font-medium capitalize whitespace-nowrap">{nombreMes(m.mes, true)} {m.mes.slice(0, 4)}</span>
                        <span className={`monto whitespace-nowrap ${m.saldo < 0 ? "text-red-700" : "text-stone-600"}`}>Saldo {bs(m.saldo)}</span>
                      </div>
                      <div className="space-y-1">
                        <Barra valor={m.ingresos} maximo={max} clase="bg-arca" />
                        <Barra valor={m.gastos} maximo={max} clase="bg-stone-500" />
                      </div>
                      <p className="monto text-sm text-stone-600 mt-0.5">Ingresos {bs(m.ingresos)} · Gastos {bs(m.gastos)}</p>
                    </div>
                  ))}
                </div>
              );
            })()}
          </Tarjeta>
        </>
      )}
    </div>
  );
}
