import { Link } from "react-router-dom";
import { bs } from "../../core/formato";
import { usePeriodo } from "../../core/PeriodoContext";
import SelectorPeriodo from "../../core/SelectorPeriodo";
import { Cargando, ErrorCaja, SinDatosPeriodo, Tarjeta, Vacio, useCarga } from "../../core/ui";
import { useAuth } from "../auth/AuthContext";
import { NotaPrivados } from "../privacidad/Etiquetas";
import FilaActividad, { useAccionesFila } from "../movimientos/FilaActividad";
import { listarMovimientos } from "../movimientos/api";
import { resumenPeriodo } from "../reportes/api";
import { movimientoAItem } from "../sync/superponer";

function Fila({ texto, valor, signo }: { texto: string; valor: number; signo: "+" | "-" }) {
  return (
    <div className="flex justify-between text-sm py-0.5">
      <span className="text-white/85">{signo === "+" ? "＋" : "－"} {texto}</span>
      <span className="monto font-medium">{bs(valor)}</span>
    </div>
  );
}

/** Ingresos o gastos del mes, en grande, dentro de la tarjeta verde. */
function Cifra({ texto, valor, icono }: { texto: string; valor: number; icono: string }) {
  return (
    <div className="flex-1 rounded-2xl bg-white/15 px-3 py-2.5 min-w-0">
      <span className="block text-xs text-white/85"><span aria-hidden>{icono} </span>{texto}</span>
      <span className="monto block font-titulo font-bold text-lg break-words">{bs(valor)}</span>
    </div>
  );
}

export default function PaginaInicio() {
  const { usuario } = useAuth();
  const { periodo } = usePeriodo();
  const rango = { desde: periodo.desde, hasta: periodo.hasta };
  const { datos, error, cargando, sinConexion, recargar } = useCarga(
    async () => ({ resumen: await resumenPeriodo(rango), movs: await listarMovimientos(rango) }),
    [periodo.desde, periodo.hasta],
    true,
  );
  const { acciones, dialogos } = useAccionesFila(recargar);

  const iniciales = (usuario?.nombre ?? "?").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");

  const encabezado = (
    <header className="flex items-center justify-between">
      <div className="min-w-0">
        <p className="text-sm text-stone-600">Hola, {usuario?.nombre.split(" ")[0]}</p>
        <h1 className="font-titulo text-xl font-bold break-words">{usuario?.familia_nombre}</h1>
      </div>
      <Link
        to="/familia/perfil"
        aria-label="Mi perfil"
        className="shrink-0 w-11 h-11 rounded-full bg-arca-claro text-arca font-titulo font-bold flex items-center justify-center border-[1.5px] border-arca/30 active:bg-arca/10"
      >
        {iniciales}
      </Link>
    </header>
  );

  if (cargando && !datos) return <Cargando />;
  if (error && !datos)
    return (
      <div className="space-y-3">
        {encabezado}
        <SelectorPeriodo />
        {sinConexion ? (
          <SinDatosPeriodo />
        ) : (
          <ErrorCaja mensaje={`${error}. Aún puedes registrar con el botón +; se enviará al volver la conexión.`} />
        )}
      </div>
    );
  const { resumen: r, movs } = datos!;

  return (
    <div className="space-y-4">
      {encabezado}
      <SelectorPeriodo />

      <section className="rounded-tarjeta bg-arca text-white p-5" aria-label="Saldo del periodo">
        <p className="text-sm text-white/85">Saldo de efectivo · <span data-testid="etiqueta-saldo">{periodo.etiqueta}</span></p>
        <p className="monto font-titulo text-4xl font-bold my-1" data-testid="saldo">{bs(r.saldo)}</p>
        <div className="flex gap-2 mt-3">
          <Cifra texto="Ingresos" valor={r.ingresos} icono="⬆" />
          <Cifra texto="Gastos" valor={r.gastos} icono="⬇" />
        </div>
        <div className="border-t border-white/20 mt-3 pt-2">
          <Fila texto="Apoyos entregados" valor={r.apoyos_entregados} signo="-" />
          <Fila texto="Devoluciones" valor={r.devoluciones} signo="+" />
        </div>
        {!periodo.esActual && (
          <p role="status" data-testid="aviso-periodo-anterior" className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">
            <span aria-hidden>🕑</span> Viendo un periodo anterior
          </p>
        )}
        <NotaPrivados n={r.incluye_privados} className="text-white/90 mt-2" />
        {r.consumido > 0 && (
          <p className="text-xs text-white/80 mt-2">
            Apoyos consumidos (gasto familiar, aparte): {bs(r.consumido)}
          </p>
        )}
      </section>

      {r.apoyos_pendientes_total > 0 && (
        <Link to="/apoyos" className="flex items-center gap-3 rounded-tarjeta bg-apoyo-claro border border-apoyo/30 p-4 min-h-[56px]">
          <span className="text-3xl" aria-hidden>🤝</span>
          <span className="flex-1">
            <span className="block font-titulo font-bold text-apoyo-texto">
              Apoyos pendientes: {bs(r.apoyos_pendientes_total)}
            </span>
            <span className="block text-sm text-apoyo-texto/90">
              {r.apoyos_pendientes_cantidad} {r.apoyos_pendientes_cantidad === 1 ? "persona" : "personas"} por devolver
            </span>
          </span>
          <span className="text-2xl text-apoyo" aria-hidden>›</span>
        </Link>
      )}

      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-titulo font-bold text-lg">Últimos movimientos</h2>
          <Link to="/todos" className="min-h-[44px] flex items-center px-2 text-sm font-semibold text-arca">Ver todos ›</Link>
        </div>
        {movs.length === 0 ? (
          <Vacio
            icono="🧾"
            texto="Sin movimientos en este periodo. Toca + para registrar uno."
            accion={{ texto: "Registrar un movimiento", a: "/nuevo" }}
          />
        ) : (
          <Tarjeta className="!p-0 divide-y divide-stone-100">
            {movs.slice(0, 8).map((m) => {
              const item = movimientoAItem(m);
              return <FilaActividad key={m.id} item={item} acciones={acciones(item)} testid="fila-inicio" />;
            })}
          </Tarjeta>
        )}
      </section>

      {dialogos}
    </div>
  );
}
