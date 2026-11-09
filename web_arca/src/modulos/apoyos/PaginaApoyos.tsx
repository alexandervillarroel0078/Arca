import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Fondo } from "../../core/DialogoAnular";
import { EtiquetaSync } from "../../core/EtiquetaSync";
import { useConfirmar } from "../../core/DialogoConfirmar";
import MenuFila, { type AccionMenu } from "../../core/MenuFila";
import { useAviso } from "../../core/Aviso";
import { bs, fechaCorta, hoyISO } from "../../core/formato";
import { enRango } from "../../core/periodo";
import { usePeriodo } from "../../core/PeriodoContext";
import SelectorPeriodo from "../../core/SelectorPeriodo";
import { textoAnulado } from "../../core/tipos";
import { useAnular } from "../../core/useAnular";
import { Boton, Campo, Cargando, ErrorCaja, Interruptor, SinDatosPeriodo, Tarjeta, Titulo, Vacio, claseInput, useCarga } from "../../core/ui";
import { useAuth } from "../auth/AuthContext";
import DialogoCompartir, { type PedidoCompartir } from "../privacidad/DialogoCompartir";
import { EtiquetaPrivacidad, NotaPrivados } from "../privacidad/Etiquetas";
import { puedeEditar, puedeRegistrarDevolucion } from "../privacidad/visibilidad";
import DialogoHistorial, { type PedidoHistorial } from "../historial/DialogoHistorial";
import {
  anularApoyo,
  anularDevolucion,
  consumirApoyo,
  devolverApoyo,
  editarDevolucion,
  listarApoyos,
  reabrirApoyo,
  reactivarApoyo,
  reactivarDevolucion,
  resumenApoyos,
  type Apoyo,
  type Beneficiario,
  type Devolucion,
  type EstadoApoyo,
} from "./api";

const ESTILO_ESTADO: Record<EstadoApoyo, string> = {
  Pendiente: "bg-apoyo-claro text-apoyo-texto",
  Saldado: "bg-arca-claro text-arca",
  Cerrado: "bg-stone-200 text-stone-700",
  Anulado: "bg-stone-200 text-stone-600",
};

export default function PaginaApoyos() {
  const avisar = useAviso();
  const navegar = useNavigate();
  const { usuario } = useAuth();
  const [verAnulados, setVerAnulados] = useState(false);
  const { periodo } = usePeriodo();
  const rango = { desde: periodo.desde, hasta: periodo.hasta };
  const { datos, error, cargando, sinConexion, recargar } = useCarga(
    async () => ({ resumen: await resumenApoyos(rango), apoyos: await listarApoyos(verAnulados) }),
    [verAnulados, periodo.desde, periodo.hasta],
    true,
  );
  const { pedirAnular, reactivarAhora, dialogo } = useAnular(recargar);
  const { confirmar, dialogo: dialogoConfirmar } = useConfirmar();
  const [devolviendo, setDevolviendo] = useState<Beneficiario | null>(null);
  const [monto, setMonto] = useState("");
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [editandoDev, setEditandoDev] = useState<{ apoyo: Apoyo; dev: Devolucion } | null>(null);
  const [historial, setHistorial] = useState<PedidoHistorial | null>(null);

  const [compartiendo, setCompartiendo] = useState<PedidoCompartir | null>(null);
  // Fase 17: el dueno edita lo suyo; el admin lo de la familia; lo compartido contigo es de solo lectura
  const puedeApoyo = (a: Apoyo) => puedeEditar(a, usuario);
  const puedeDev = (a: Apoyo, d: Devolucion) =>
    a.visibilidad && a.visibilidad !== "familia"
      ? a.usuario_id === usuario?.id
      : usuario?.rol === "admin" || (d.usuario_id ?? a.usuario_id) === usuario?.id;
  const puedeDevolver = (a: Apoyo) => puedeRegistrarDevolucion(a, usuario);

  const delBeneficiario = (b: string) =>
    (datos?.apoyos ?? []).filter((a) => a.beneficiario.toLowerCase() === b.toLowerCase());
  // Apoyos activos con saldo de un beneficiario, del mas antiguo al mas nuevo.
  const conSaldo = (b: Beneficiario): Apoyo[] =>
    delBeneficiario(b.beneficiario)
      .filter((a) => !a.anulado && a.pendiente > 0)
      .sort((x, y) => x.fecha.localeCompare(y.fecha) || x.id - y.id);
  // Las devoluciones solo se reparten entre los apoyos donde puedes registrarlas (los de la familia y los tuyos)
  const conSaldoDevolvible = (b: Beneficiario): Apoyo[] => conSaldo(b).filter(puedeDevolver);
  const pendienteDevolvible = (b: Beneficiario) => conSaldoDevolvible(b).reduce((s, a) => s + a.pendiente, 0);

  async function devolver() {
    if (!devolviendo) return;
    const total = Number(monto.replace(",", "."));
    if (!total || total <= 0) return setErrorAccion("Escribe un monto mayor a cero");
    if (Math.round(total * 100) / 100 !== total) return setErrorAccion("El monto admite hasta 2 decimales");
    const maximo = pendienteDevolvible(devolviendo);
    if (total > maximo + 0.001) return setErrorAccion(`No puede superar lo pendiente (${bs(maximo)})`);
    setOcupado(true);
    setErrorAccion(null);
    try {
      let resto = Math.round(total * 100);
      for (const a of conSaldoDevolvible(devolviendo)) {
        if (resto <= 0) break;
        const parte = Math.min(resto, Math.round(a.pendiente * 100));
        await devolverApoyo(a.id, parte / 100);
        resto -= parte;
      }
      avisar("Devolución registrada");
      setDevolviendo(null);
      setMonto("");
      recargar();
    } catch (e) {
      setErrorAccion((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  function consumir(b: Beneficiario) {
    const mios = conSaldo(b).filter(puedeApoyo);
    if (mios.length === 0) return avisar("Solo quien entregó el apoyo o un administrador puede marcarlo como consumido", "error");
    const suma = mios.reduce((s, a) => s + a.pendiente, 0);
    confirmar({
      titulo: "Marcar consumido",
      mensaje: `¿Marcar ${bs(suma)} de ${b.beneficiario} como consumido? Contará como gasto familiar. Puedes reabrirlo después.`,
      ejecutar: () => consumirAhora(mios),
    });
  }

  async function consumirAhora(mios: Apoyo[]) {
    setOcupado(true);
    try {
      for (const a of mios) await consumirApoyo(a.id);
      avisar("Marcado como consumido");
      recargar();
    } catch (e) {
      avisar((e as Error).message, "error");
    } finally {
      setOcupado(false);
    }
  }

  function menuApoyo(a: Apoyo): AccionMenu[] {
    const verHistorial: AccionMenu = {
      texto: "Ver historial del apoyo",
      alAccionar: () => setHistorial({ entidad: "apoyo", id: a.id, titulo: `${a.beneficiario} · ${bs(a.monto)}` }),
    };
    if (!puedeApoyo(a)) return [verHistorial];
    if (a.anulado) return [{ texto: "Reactivar", alAccionar: () => reactivarAhora(() => reactivarApoyo(a.id)) }, verHistorial];
    const acc: AccionMenu[] = [{ texto: "Editar apoyo", alAccionar: () => navegar(`/editar/apoyo/${a.id}`) }, verHistorial];
    if (a.usuario_id === usuario?.id)
      acc.push({
        texto: "Compartir...",
        alAccionar: () => setCompartiendo({ clase: "apoyo", id: a.id, titulo: `${a.beneficiario} · ${bs(a.monto)}`, registro: a }),
      });
    if (a.consumido > 0)
      acc.push({
        texto: "Reabrir apoyo",
        alAccionar: async () => {
          try {
            await reabrirApoyo(a.id);
            avisar("Apoyo reabierto: lo consumido volvió a pendiente");
            recargar();
          } catch (e) {
            avisar((e as Error).message, "error");
          }
        },
      });
    acc.push({
      texto: "Anular apoyo",
      peligro: true,
      alAccionar: () =>
        pedirAnular({
          titulo: "Anular apoyo",
          detalle: `${a.beneficiario} · ${bs(a.monto)}`,
          advertencia:
            a.devoluciones_activas > 0
              ? `Se anularán también ${a.devoluciones_activas} ${a.devoluciones_activas === 1 ? "devolución" : "devoluciones"}.`
              : undefined,
          anular: (m) => anularApoyo(a.id, m),
          reactivar: () => reactivarApoyo(a.id),
        }),
    });
    return acc;
  }

  function menuDev(a: Apoyo, d: Devolucion): AccionMenu[] {
    const verHistorial: AccionMenu = {
      texto: "Ver historial de la devolución",
      alAccionar: () => setHistorial({ entidad: "devolucion", id: d.id, titulo: `Devolución de ${a.beneficiario} · ${bs(d.monto)}` }),
    };
    if (!puedeDev(a, d) || a.anulado) return [verHistorial];
    if (d.anulado) return [{ texto: "Reactivar devolución", alAccionar: () => reactivarAhora(() => reactivarDevolucion(a.id, d.id)) }, verHistorial];
    return [
      { texto: "Editar devolución", alAccionar: () => setEditandoDev({ apoyo: a, dev: d }) },
      verHistorial,
      {
        texto: "Anular devolución",
        peligro: true,
        alAccionar: () =>
          pedirAnular({
            titulo: "Anular devolución",
            detalle: `${a.beneficiario} · ${bs(d.monto)}`,
            anular: (m) => anularDevolucion(a.id, d.id, m),
            reactivar: () => reactivarDevolucion(a.id, d.id),
          }),
      },
    ];
  }

  if (cargando && !datos) return <Cargando />;
  if (error && !datos)
    return (
      <div className="space-y-4">
        <Titulo>Apoyos</Titulo>
        <SelectorPeriodo />
        {sinConexion ? <SinDatosPeriodo /> : <ErrorCaja mensaje={error} />}
      </div>
    );
  const r = datos!.resumen;
  // Se muestran los apoyos entregados en el periodo o con alguna devolucion hecha en el. El pendiente NO se corta por periodo.
  const delPeriodo = (a: Apoyo) => enRango(a.fecha, rango) || a.devoluciones.some((d) => !d.anulado && enRango(d.fecha, rango));
  const anulados = (datos?.apoyos ?? []).filter((a) => a.anulado && delPeriodo(a));

  const filaApoyo = (a: Apoyo) => (
    <li key={a.id} data-testid="fila-apoyo" data-anulado={a.anulado} className={`py-1 ${a.anulado ? "text-stone-600" : "text-stone-700"}`}>
      <div className="flex items-center justify-between gap-1">
        <p className={`monto text-sm min-w-0 ${a.anulado ? "line-through" : ""}`}>
          {fechaCorta(a.fecha)} · {bs(a.monto)} entregado por {a.usuario_nombre}
          {a.consumido > 0 && ` · consumido ${bs(a.consumido)}`}
          <span className="ml-1 align-middle"><EtiquetaPrivacidad registro={a} /></span>
          {(a.sinSincronizar || a.enConflicto) && (
            <span className="ml-1 inline-flex flex-wrap gap-1.5 align-middle"><EtiquetaSync sinSincronizar={a.sinSincronizar} enConflicto={a.enConflicto} /></span>
          )}
        </p>
        <MenuFila acciones={menuApoyo(a)} etiqueta={`Acciones del apoyo ${bs(a.monto)}`} />
      </div>
      {a.anulado && <p className="text-xs text-red-700">{textoAnulado(a)}</p>}
      {a.devoluciones.length > 0 && (
        <ul className="ml-3 border-l-2 border-stone-200 pl-3">
          {a.devoluciones.map((d) => (
            <li key={d.id} data-testid="fila-devolucion" data-anulado={d.anulado} className={d.anulado ? "text-stone-600" : ""}>
              <div className="flex items-center justify-between gap-1">
                <p className={`monto text-sm ${d.anulado ? "line-through" : ""}`}>
                  Devolución {bs(d.monto)} · {fechaCorta(d.fecha)}
                  {d.usuario_nombre ? ` · ${d.usuario_nombre}` : ""}
                  {(d.sinSincronizar || d.enConflicto) && (
                    <span className="ml-1 inline-flex flex-wrap gap-1.5 align-middle"><EtiquetaSync sinSincronizar={d.sinSincronizar} enConflicto={d.enConflicto} /></span>
                  )}
                </p>
                <MenuFila acciones={menuDev(a, d)} etiqueta={`Acciones de la devolución ${bs(d.monto)}`} />
              </div>
              {d.anulado && <p className="text-xs text-red-700">{textoAnulado(d)}</p>}
            </li>
          ))}
        </ul>
      )}
    </li>
  );

  return (
    <div className="space-y-4">
      <Titulo>Apoyos</Titulo>
      <p className="text-sm text-stone-600 -mt-2">Dinero entregado a familiares. No es gasto ni préstamo.</p>
      <SelectorPeriodo />

      <div className="grid grid-cols-2 gap-2">
        <Tarjeta className="col-span-2 !bg-apoyo-claro border-apoyo/30">
          <p className="text-xs text-apoyo-texto">Pendiente total</p>
          <p className="monto font-titulo text-2xl font-bold text-apoyo-texto" data-testid="pendiente-total">{bs(r.total_pendiente)}</p>
          <p className="text-xs text-apoyo-texto" data-testid="nota-pendiente-total">Pendiente total, no depende del periodo</p>
          <NotaPrivados n={r.incluye_privados} className="text-apoyo-texto mt-1" />
        </Tarjeta>
        <Tarjeta>
          <p className="text-xs text-stone-600">Entregado en el periodo</p>
          <p className="monto font-titulo text-xl font-bold" data-testid="entregado-periodo">{bs(r.total_entregado_periodo)}</p>
        </Tarjeta>
        <Tarjeta>
          <p className="text-xs text-stone-600">Devuelto en el periodo</p>
          <p className="monto font-titulo text-xl font-bold text-arca" data-testid="devuelto-periodo">{bs(r.total_devuelto_periodo)}</p>
        </Tarjeta>
        <Tarjeta className="col-span-2">
          <p className="text-xs text-stone-600">Consumido (acumulado)</p>
          <p className="monto font-titulo text-xl font-bold">{bs(r.total_consumido)}</p>
        </Tarjeta>
      </div>

      <Tarjeta className="!py-1">
        <Interruptor etiqueta="Ver anulados" activo={verAnulados} alCambiar={setVerAnulados} />
      </Tarjeta>

      {r.beneficiarios.length === 0 && anulados.length === 0 && <Vacio icono="🤝" texto="No hay apoyos pendientes ni apoyos de este periodo. Registra uno con el botón +." accion={{ texto: "Registrar un apoyo", a: "/nuevo" }} />}

      {r.beneficiarios.map((b) => {
        const avance = b.entregado ? Math.min(100, ((b.devuelto + b.consumido) / b.entregado) * 100) : 0;
        const activos = delBeneficiario(b.beneficiario).filter((a) => !a.anulado && delPeriodo(a));
        const puedeConsumir = conSaldo(b).some(puedeApoyo);
        return (
          <Tarjeta key={b.beneficiario} className="space-y-3">
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-titulo text-lg font-bold">{b.beneficiario}</h2>
              <span className={`shrink-0 text-sm font-bold px-3 py-1.5 rounded-full ${ESTILO_ESTADO[b.estado]}`}>{b.estado}</span>
            </div>
            {/* a todo el ancho de la tarjeta (no en la columna angosta junto al estado) y con cada monto sin partirse en dos lineas */}
            <div className="!mt-1">
              <p className="monto text-xs text-stone-600">
                {b.cantidad_apoyos} {b.cantidad_apoyos === 1 ? "apoyo" : "apoyos"} · <span className="whitespace-nowrap">entregado {bs(b.entregado)}</span>
              </p>
              <p className="monto text-sm text-stone-600" data-testid="en-el-periodo">
                {b.entregado_periodo === 0 && b.devuelto_periodo === 0 ? (
                  "Sin entregas ni devoluciones en este periodo"
                ) : (
                  <>
                    En el periodo: <span className="whitespace-nowrap">entregado {bs(b.entregado_periodo)}</span> ·{" "}
                    <span className="whitespace-nowrap">devuelto {bs(b.devuelto_periodo)}</span>
                  </>
                )}
              </p>
            </div>

            <div>
              <div className="h-3.5 rounded-full bg-stone-200 overflow-hidden flex" role="progressbar" aria-valuenow={Math.round(avance)} aria-valuemin={0} aria-valuemax={100}>
                <div className="bg-arca h-full" style={{ width: `${b.entregado ? (b.devuelto / b.entregado) * 100 : 0}%` }} />
                <div className="bg-stone-500 h-full" style={{ width: `${b.entregado ? (b.consumido / b.entregado) * 100 : 0}%` }} />
              </div>
              {/* etiqueta arriba y monto abajo: el monto nunca se parte en dos lineas (el texto es el mismo: "Devuelto Bs 200.00") */}
              <div className="monto grid grid-cols-3 gap-2 text-xs mt-1 text-stone-600">
                <span>Devuelto{" "}<span className="block whitespace-nowrap">{bs(b.devuelto)}</span></span>
                <span className="text-center">Consumido{" "}<span className="block whitespace-nowrap">{bs(b.consumido)}</span></span>
                <span className="text-right font-semibold text-apoyo-texto">Pendiente{" "}<span className="block whitespace-nowrap">{bs(b.pendiente)}</span></span>
              </div>
            </div>

            {b.pendiente > 0 && (
              <div className={`grid gap-2 ${puedeConsumir && pendienteDevolvible(b) > 0 ? "grid-cols-2" : "grid-cols-1"}`}>
                {pendienteDevolvible(b) > 0 && (
                  <Boton variante="suave" disabled={ocupado} onClick={() => { setDevolviendo(b); setMonto(String(pendienteDevolvible(b))); setErrorAccion(null); }}>
                    Registrar devolución
                  </Boton>
                )}
                {puedeConsumir && (
                  <Boton variante="apoyo" disabled={ocupado} onClick={() => consumir(b)}>
                    Marcar consumido
                  </Boton>
                )}
              </div>
            )}

            {devolviendo?.beneficiario === b.beneficiario && (
              <div className="rounded-xl bg-stone-50 border border-stone-200 p-3 space-y-2">
                <label className="block text-sm font-medium">
                  Monto devuelto (Bs)
                  <input className={`${claseInput} mt-1`} inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value.replace(/[^0-9.,]/g, ""))} autoFocus />
                </label>
                <ErrorCaja mensaje={errorAccion} />
                <div className="grid grid-cols-2 gap-2">
                  <Boton variante="suave" onClick={() => setDevolviendo(null)}>Cancelar</Boton>
                  <Boton onClick={devolver} disabled={ocupado}>Guardar</Boton>
                </div>
              </div>
            )}

            <ul className="divide-y divide-stone-100">{activos.map(filaApoyo)}</ul>
          </Tarjeta>
        );
      })}

      {verAnulados && anulados.length > 0 && (
        <Tarjeta className="space-y-1 !bg-stone-100">
          <h2 className="font-titulo font-bold text-stone-600">Apoyos anulados</h2>
          <ul>{anulados.map((a) => <div key={a.id}><p className="text-xs text-stone-600 mt-2">{a.beneficiario}</p>{filaApoyo(a)}</div>)}</ul>
        </Tarjeta>
      )}

      {editandoDev && (
        <EditarDevolucion
          apoyo={editandoDev.apoyo}
          dev={editandoDev.dev}
          alCerrar={() => setEditandoDev(null)}
          alGuardar={() => {
            setEditandoDev(null);
            avisar("Devolución actualizada");
            recargar();
          }}
        />
      )}
      {dialogo}
      {dialogoConfirmar}
      {historial && <DialogoHistorial pedido={historial} alCerrar={() => setHistorial(null)} />}
      {compartiendo && <DialogoCompartir pedido={compartiendo} alCerrar={() => setCompartiendo(null)} alGuardar={recargar} />}
    </div>
  );
}

function EditarDevolucion({ apoyo, dev, alCerrar, alGuardar }: { apoyo: Apoyo; dev: Devolucion; alCerrar: () => void; alGuardar: () => void }) {
  const [monto, setMonto] = useState(String(dev.monto));
  const [fecha, setFecha] = useState(dev.fecha);
  const [nota, setNota] = useState(dev.nota ?? "");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function guardar() {
    const valor = Number(monto.replace(",", "."));
    if (!valor || valor <= 0) return setError("Escribe un monto mayor a cero");
    if (Math.round(valor * 100) / 100 !== valor) return setError("El monto admite hasta 2 decimales");
    setOcupado(true);
    setError(null);
    try {
      await editarDevolucion(apoyo.id, dev.id, { monto: valor, fecha, nota: nota.trim() || null });
      alGuardar();
    } catch (e) {
      setError((e as Error).message);
      setOcupado(false);
    }
  }

  return (
    <Fondo alCerrar={alCerrar} sinGuardar={monto !== String(dev.monto) || fecha !== dev.fecha || nota !== (dev.nota ?? "")}>
      <div role="dialog" aria-modal="true" aria-label="Editar devolución" className="bg-white rounded-2xl p-5 w-full max-w-[400px] max-h-[calc(100dvh-2rem)] overflow-y-auto space-y-3">
        <h2 className="font-titulo text-xl font-bold">Editar devolución</h2>
        <p className="text-sm text-stone-600">{apoyo.beneficiario} · apoyo de {bs(apoyo.monto)}</p>
        <Campo etiqueta="Monto (Bs)">
          <input className={claseInput} inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value.replace(/[^0-9.,]/g, ""))} autoFocus />
        </Campo>
        <Campo etiqueta="Fecha">
          <input className={claseInput} type="date" value={fecha} max={hoyISO()} onChange={(e) => setFecha(e.target.value || dev.fecha)} />
        </Campo>
        <Campo etiqueta="Nota (opcional)">
          <input className={claseInput} value={nota} onChange={(e) => setNota(e.target.value)} maxLength={500} />
        </Campo>
        <ErrorCaja mensaje={error} />
        <div className="grid grid-cols-2 gap-2">
          <Boton variante="suave" onClick={alCerrar} disabled={ocupado}>Cancelar</Boton>
          <Boton onClick={guardar} disabled={ocupado}>Guardar</Boton>
        </div>
      </div>
    </Fondo>
  );
}
