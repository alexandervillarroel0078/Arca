import { useState } from "react";
import { describirComparacion, type Comparacion } from "../../core/comparacion";
import { bs, iconoDe, nombreMes } from "../../core/formato";
import { usePeriodo } from "../../core/PeriodoContext";
import SelectorPeriodo from "../../core/SelectorPeriodo";
import { NotaPrivados } from "../privacidad/Etiquetas";
import { Cargando, ErrorCaja, SinDatosPeriodo, Tarjeta, Titulo, Vacio, useCarga } from "../../core/ui";
import { useEnCola } from "../sync/useSync";
import { porCategoria, porMiembro, resumenPeriodo, tendencia, type FiltroFuente, type MesTotal } from "./api";
import { ingresadoAlBanco, pagadoConBanco, saldoEfectivo } from "./fuente";

const FILTROS: { id: FiltroFuente; texto: string }[] = [
  { id: "todos", texto: "Todos" },
  { id: "efectivo", texto: "Efectivo" },
  { id: "banco", texto: "Banco" },
];

/** Lo del mes en Efectivo: la barra muestra gastos en efectivo + apoyos en efectivo + te queda (= ingresos en efectivo + devoluciones). */
const efectivoDe = (m: MesTotal) => ({
  ingresos: m.ingresos - ingresadoAlBanco(m),
  gastos: m.gastos - (m.gastos_banco ?? 0),
  apoyos: m.apoyos_entregados - (m.apoyos_banco ?? 0),
  queda: saldoEfectivo(m),
});

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

/** Largo de la barra de un mes (en efectivo): lo que entro (ingresos + devoluciones) o lo que salio (gastos + apoyos), lo mayor. */
const largoMes = (m: MesTotal) => {
  const e = efectivoDe(m);
  return Math.max(e.ingresos + m.devoluciones, e.gastos + e.apoyos);
};

/**
 * UNA barra por mes: gris (gastos), naranja (apoyos) y verde (lo que queda = saldo). Con saldo >= 0 los tres
 * suman ingresos + devoluciones; con saldo < 0 no hay verde. Un monto 0 no dibuja tramo; si todo es 0 queda la
 * tira minima gris (2 %). Cada tramo dice su monto (aria-label y title): el color nunca es lo unico que informa.
 */
function BarraMes({ m, maximo }: { m: MesTotal; maximo: number }) {
  const e = efectivoDe(m);
  const tramos = [
    { texto: "Gastos en efectivo", monto: e.gastos, clase: "bg-stone-500" },
    { texto: "Apoyos", monto: e.apoyos, clase: "bg-apoyo" },
    { texto: "Te queda", monto: e.queda, clase: "bg-arca" },
  ].filter((t) => t.monto > 0);
  const visibles = tramos.length ? tramos : [{ texto: "Gastos en efectivo", monto: 0, clase: "bg-stone-500" }];
  return (
    <div className="h-2.5 rounded-full bg-stone-100 overflow-hidden flex">
      {visibles.map((t, i) => (
        <div
          key={t.texto}
          className={`h-full ${t.clase} ${i === 0 ? "rounded-l-full" : ""} ${i === visibles.length - 1 ? "rounded-r-full" : ""}`}
          style={{ width: `${Math.max(2, (t.monto / maximo) * 100)}%` }}
          role="img" aria-label={`${t.texto} ${bs(t.monto)}`} title={`${t.texto} ${bs(t.monto)}`}
        />
      ))}
    </div>
  );
}

export default function PaginaReportes() {
  const { periodo } = usePeriodo();
  const rango = { desde: periodo.desde, hasta: periodo.hasta };
  const [fuente, setFuente] = useState<FiltroFuente>("todos");
  const { datos, error, cargando, sinConexion } = useCarga(
    async () => {
      const [resumen, categorias, miembros, meses] = await Promise.all([
        resumenPeriodo(rango, periodo.tipo, fuente),
        porCategoria(rango, periodo.tipo, fuente),
        porMiembro(rango, fuente),
        tendencia(fuente),
      ]);
      return {
        resumen, categorias, miembros: miembros.miembros, meses: meses.meses,
        privados: { miembros: miembros.incluye_privados, meses: meses.incluye_privados },
      };
    },
    [periodo.desde, periodo.hasta, periodo.tipo, fuente],
    true,
  );
  const sinEnviar = useEnCola();
  const conEfectivo = fuente !== "banco"; // con el filtro Banco no hay "Te queda" (el efectivo no se mueve)
  // Si NINGUNA comparacion tiene base (el periodo anterior esta vacio) no se repite el mismo mensaje en cada tarjeta: sale una sola vez
  const comparacion = datos?.resumen.comparacion;
  const hayBase = !!comparacion && [comparacion.ingresos, comparacion.gastos, comparacion.saldo].some((c) => !sinBase(c));

  return (
    <div className="space-y-4">
      <Titulo>Reportes</Titulo>

      <SelectorPeriodo />

      {/* Fuente de pago: Todos (como siempre), solo Efectivo o solo Banco */}
      <div role="radiogroup" aria-label="Fuente de pago" data-testid="filtro-fuente" className="grid grid-cols-3 gap-1 bg-stone-200 rounded-xl p-1">
        {FILTROS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="radio"
            aria-checked={fuente === f.id}
            onClick={() => setFuente(f.id)}
            className={`min-h-[44px] rounded-lg text-sm font-semibold ${fuente === f.id ? "bg-arca text-white" : "text-stone-700"}`}
          >
            {f.texto}
          </button>
        ))}
      </div>

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
            {conEfectivo && (
              <TarjetaComparacion
                id="saldo" titulo="Saldo de efectivo" valor={saldoEfectivo(datos.resumen)}
                c={datos.resumen.comparacion.saldo_efectivo ?? datos.resumen.comparacion.saldo} masEsBueno
              />
            )}
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
                // para que cuadre: lo de banco esta en gastos/apoyos/ingresos pero no mueve el efectivo
                ...(conEfectivo && pagadoConBanco(datos.resumen) > 0 ? [["Pagado con banco", pagadoConBanco(datos.resumen)]] : []),
                ...(conEfectivo && ingresadoAlBanco(datos.resumen) > 0 ? [["Ingresado al banco", -ingresadoAlBanco(datos.resumen)]] : []),
              ].map(([t, v]) => (
                <div key={t as string} className="flex justify-between">
                  <dt className="text-stone-600">{t}</dt>
                  <dd className="font-medium">{bs(v as number)}</dd>
                </div>
              ))}
              {conEfectivo && (
                <div className="flex justify-between border-t border-stone-200 pt-1 mt-1 font-bold">
                  <dt>Saldo de efectivo</dt>
                  <dd className="text-arca" data-testid="saldo-efectivo-reportes">{bs(saldoEfectivo(datos.resumen))}</dd>
                </div>
              )}
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
            {/* que representa cada tramo de la barra del mes: gris gastos, naranja apoyos, verde lo que queda */}
            <ul aria-label="Leyenda de las barras" data-testid="leyenda-meses" className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-stone-700">
              <li className="flex items-center gap-1.5">
                <span aria-hidden className="inline-block h-2.5 w-5 rounded-full bg-stone-500" />
                Gastos en efectivo
              </li>
              <li className="flex items-center gap-1.5">
                <span aria-hidden className="inline-block h-2.5 w-5 rounded-full bg-apoyo" />
                Apoyos
              </li>
              <li className="flex items-center gap-1.5">
                <span aria-hidden className="inline-block h-2.5 w-5 rounded-full bg-arca" />
                Te queda
              </li>
            </ul>
            {(() => {
              const max = Math.max(1, ...datos.meses.map(largoMes));
              return (
                <div className="space-y-3">
                  {datos.meses.map((m) => (
                    <div key={m.mes} data-testid="fila-mes">
                      <div className="flex items-baseline justify-between gap-3 text-sm mb-1">
                        <span className="font-medium capitalize whitespace-nowrap">{nombreMes(m.mes, true)} {m.mes.slice(0, 4)}</span>
                        <span className={`monto whitespace-nowrap ${saldoEfectivo(m) < 0 ? "text-red-700" : "text-stone-600"}`}>Te queda {bs(saldoEfectivo(m))}</span>
                      </div>
                      <BarraMes m={m} maximo={max} />
                      <p className="monto text-sm text-stone-600 mt-0.5">
                        Ingresos {bs(m.ingresos)} · Gastos {bs(m.gastos)} · Apoyos {bs(m.apoyos_entregados)}
                        {m.devoluciones > 0 && ` · Devoluciones ${bs(m.devoluciones)}`}
                      </p>
                      {pagadoConBanco(m) > 0 && (
                        <p className="monto text-xs text-stone-600" data-testid="pagado-banco-mes">
                          Pagado con banco {bs(pagadoConBanco(m))} (incluido en {(m.apoyos_banco ?? 0) > 0 ? "gastos y apoyos" : "gastos"})
                        </p>
                      )}
                      {ingresadoAlBanco(m) > 0 && (
                        <p className="monto text-xs text-stone-600" data-testid="ingresado-banco-mes">
                          Ingresado al banco {bs(ingresadoAlBanco(m))} (incluido en ingresos)
                        </p>
                      )}
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
