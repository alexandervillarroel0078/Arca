import { useEffect, useRef, useState } from "react";
import { Fondo } from "../../core/DialogoAnular";
import { Boton } from "../../core/ui";
import { fechaHora } from "../../core/tipos";
import type { Categoria } from "../familia/api";
import { alCambiarCache, datosDeCache, haceCuanto, leerCache } from "./cache";
import { descartarRechazo, resolverConflicto, sincronizar } from "./cola";
import { compararConflicto, describirOperacion } from "./describir";
import { useAvisarResultado } from "./Sincronizador";
import { reconciliarVisibles } from "./visibles";
import type { Operacion, Rechazo } from "./tipos";
import { useSync } from "./useSync";

function useDatosDeCache(): number | null {
  const [desde, setDesde] = useState<number | null>(datosDeCache());
  const [, tic] = useState(0);
  useEffect(() => alCambiarCache(() => setDesde(datosDeCache())), []);
  useEffect(() => {
    const t = setInterval(() => tic((x) => x + 1), 30000); // "hace 5 min" se va actualizando
    return () => clearInterval(t);
  }, []);
  return desde;
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/**
 * "Todo sincronizado": sale `demora` ms despues de quedar sin cambios (el aviso "Se sincronizaron N registros" ya dura 3,5 s en la
 * parte de arriba de la pantalla y taparia este mensaje; asi salen uno despues del otro) y dura `duracion` ms.
 * Es un objeto para poder acortar los tiempos en las pruebas.
 */
export const TIEMPOS_TODO_SINCRONIZADO = { demora: 3600, duracion: 3500 };

/**
 * Estado de sincronizacion siempre visible arriba, en UNA fila compacta: contador y estado a la izquierda, boton de
 * sincronizar (icono, mismo nombre accesible "Sincronizar ahora") y "Ver detalle" (abre la lista de cambios, rechazos y
 * conflictos) a la derecha. Los rechazos y los conflictos se ven de inmediato (aviso rojo / fila roja).
 */
export default function BarraSync() {
  const s = useSync();
  const desdeCache = useDatosDeCache();
  const avisarResultado = useAvisarResultado();
  const [panel, setPanel] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const n = s.operaciones.length;
  const conflictos = s.operaciones.filter((o) => o.estado === "conflicto").length;
  const rechazos = s.rechazos.length;
  const estado = s.sincronizando
    ? "Sincronizando..."
    : !s.enLinea
      ? "Sin conexión: se enviarán al volver la conexión"
      : conflictos === n
        ? "Esperando tu decisión"
        : "Se reintentará solo en unos segundos";

  // "Todo sincronizado": una sola vez, al pasar de tener cambios pendientes a ninguno (y sin rechazos pendientes de ver).
  // No sale al abrir la app ni al recargar datos: solo en esa transicion.
  const [reciente, setReciente] = useState(false);
  const anterior = useRef(0);
  const temporizadores = useRef<ReturnType<typeof setTimeout>[]>([]);
  const detener = () => {
    temporizadores.current.forEach(clearTimeout);
    temporizadores.current = [];
  };
  useEffect(() => detener, []);
  useEffect(() => {
    if (anterior.current > 0 && n === 0 && rechazos === 0 && s.enLinea) {
      detener();
      temporizadores.current = [
        setTimeout(() => {
          setReciente(true);
          temporizadores.current.push(setTimeout(() => setReciente(false), TIEMPOS_TODO_SINCRONIZADO.duracion));
        }, TIEMPOS_TODO_SINCRONIZADO.demora),
      ];
    } else if (n > 0) {
      detener(); // llegaron cambios nuevos: ya no esta todo sincronizado
      setReciente(false);
    }
    anterior.current = n;
  }, [n, rechazos, s.enLinea]);

  async function ahora() {
    setOcupado(true);
    try {
      avisarResultado(await sincronizar(), true);
      await reconciliarVisibles().catch(() => {}); // y se olvida lo que dejo de verse
    } finally {
      setOcupado(false);
    }
  }

  if (desdeCache === null && n === 0 && rechazos === 0 && s.enLinea && !reciente) return null;

  const enviando = ocupado || s.sincronizando;
  return (
    <div className="sticky top-0 z-30 -mx-4 px-4 pt-2 pb-1 space-y-2 bg-stone-50" aria-label="Estado de sincronización" role="region">
      {desdeCache !== null && (
        <p role="status" data-testid="datos-viejos" className="rounded-xl bg-stone-800 text-white text-sm px-4 py-2">
          📴 Datos de {haceCuanto(desdeCache)}, sin conexión
        </p>
      )}
      {n > 0 && (
        <div
          data-testid="barra-sync"
          className={`flex items-center gap-1 rounded-xl border py-1 pl-3 pr-1 min-h-[52px] ${
            conflictos > 0 ? "border-red-300 bg-red-50" : "border-apoyo/40 bg-apoyo-claro"
          }`}
        >
          <div className="min-w-0 flex-1 leading-tight">
            <p className={`text-sm font-semibold ${conflictos > 0 ? "text-red-800" : "text-apoyo"}`} data-testid="cambios-pendientes">
              {plural(n, "cambio pendiente", "cambios pendientes")}
              {conflictos > 0 && ` · ${conflictos} en conflicto`}
            </p>
            <p className="text-xs text-stone-600" data-testid="estado-sync">{estado}</p>
          </div>
          <button
            type="button"
            aria-label="Sincronizar ahora"
            title="Sincronizar ahora"
            onClick={ahora}
            disabled={enviando}
            className="shrink-0 min-h-[44px] min-w-[44px] rounded-xl text-2xl leading-none text-arca active:bg-white/60 disabled:opacity-50"
          >
            <span aria-hidden className={`inline-block ${enviando ? "motion-safe:animate-spin" : ""}`}>↻</span>
          </button>
          <button
            type="button"
            onClick={() => setPanel(true)}
            className="shrink-0 min-h-[44px] rounded-xl px-2.5 text-sm font-semibold text-arca active:bg-white/60"
          >
            Ver detalle
          </button>
        </div>
      )}
      {reciente && n === 0 && (
        <p role="status" data-testid="todo-sincronizado" className="rounded-xl border border-arca/30 bg-arca-claro px-3 py-2 text-sm font-semibold text-arca">
          ✓ Todo sincronizado
        </p>
      )}
      {n === 0 && !s.enLinea && desdeCache === null && (
        <p role="status" className="rounded-xl bg-stone-800 text-white text-sm px-4 py-2">📴 Sin conexión</p>
      )}
      {rechazos > 0 && (
        <button
          type="button"
          onClick={() => setPanel(true)}
          data-testid="aviso-rechazos"
          className="w-full min-h-[44px] rounded-xl border border-red-300 bg-red-50 text-red-800 text-sm font-semibold px-3 py-2 text-left"
        >
          ⚠ No se pudo sincronizar {plural(rechazos, "cambio", "cambios")}. Toca para ver el motivo.
        </button>
      )}
      {panel && <PanelSync operaciones={s.operaciones} rechazos={s.rechazos} alCerrar={() => setPanel(false)} />}
    </div>
  );
}

function PanelSync({ operaciones, rechazos, alCerrar }: { operaciones: Operacion[]; rechazos: Rechazo[]; alCerrar: () => void }) {
  const [textos, setTextos] = useState<Record<string, string>>({});
  const [categorias, setCategorias] = useState<Categoria[]>([]);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const t: Record<string, string> = {};
      for (const o of operaciones) t[o.id] = await describirOperacion(o);
      for (const r of rechazos) t[r.id] = await describirOperacion(r.operacion);
      const cats = (await leerCache<Categoria[]>("categorias"))?.datos ?? [];
      if (vivo) {
        setTextos(t);
        setCategorias(cats);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [operaciones, rechazos]);

  const enConflicto = operaciones.filter((o) => o.estado === "conflicto");
  const pendientes = operaciones.filter((o) => o.estado !== "conflicto");

  return (
    <Fondo alCerrar={alCerrar}>
      <div role="dialog" aria-modal="true" aria-label="Cambios pendientes" className="bg-white rounded-2xl p-5 w-full max-w-[440px] max-h-[85vh] overflow-y-auto space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-titulo text-xl font-bold">Cambios pendientes</h2>
          <button type="button" aria-label="Cerrar" onClick={alCerrar} className="min-h-[44px] min-w-[44px] text-stone-500">✕</button>
        </div>

        {enConflicto.length > 0 && (
          <section className="space-y-3" aria-label="En conflicto">
            <h3 className="font-semibold text-red-800">En conflicto</h3>
            {enConflicto.map((o) => (
              <div key={o.id} data-testid="conflicto" className="rounded-xl border border-red-300 bg-red-50 p-3 space-y-2">
                <p className="font-medium text-sm">{textos[o.id] ?? "Cambio"}</p>
                <p className="text-sm text-red-800">{o.conflicto?.mensaje}. Elige cuál conservar; no se pierde nada hasta que decidas.</p>
                <div className="grid grid-cols-[auto_1fr_1fr] gap-x-3 gap-y-1 text-sm items-baseline">
                  <span />
                  <span className="font-semibold">La mía</span>
                  <span className="font-semibold">La del servidor</span>
                  {compararConflicto(o, categorias).map((f) => (
                    <FilaVersiones key={f.campo} fila={f} />
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Boton onClick={() => resolverConflicto(o.id, "mia")}>Usar la mía</Boton>
                  <Boton variante="suave" onClick={() => resolverConflicto(o.id, "servidor")}>Usar la del servidor</Boton>
                </div>
              </div>
            ))}
          </section>
        )}

        {rechazos.length > 0 && (
          <section className="space-y-2" aria-label="No se pudo sincronizar">
            <h3 className="font-semibold text-red-800">No se pudo sincronizar</h3>
            <p className="text-sm text-stone-600">El servidor rechazó estos cambios y ya se deshicieron en el teléfono.</p>
            {rechazos.map((r) => (
              <div key={r.id} data-testid="rechazo" className="rounded-xl border border-stone-200 p-3 space-y-1">
                <p className="font-medium text-sm">{textos[r.id] ?? "Cambio"}</p>
                <p className="text-sm text-red-800">{r.motivo}</p>
                <p className="text-xs text-stone-500">Hecho el {fechaHora(r.operacion.fechaCliente)}</p>
                <Boton variante="suave" className="w-full" onClick={() => descartarRechazo(r.id)}>Entendido</Boton>
              </div>
            ))}
          </section>
        )}

        {pendientes.length > 0 && (
          <section className="space-y-1" aria-label="Pendientes">
            <h3 className="font-semibold">Esperando enviarse</h3>
            <ul className="text-sm divide-y divide-stone-100">
              {pendientes.map((o) => (
                <li key={o.id} className="py-2" data-testid="operacion-pendiente">
                  {textos[o.id] ?? "Cambio"}
                  <span className="block text-xs text-stone-500">Hecho el {fechaHora(o.fechaCliente)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {operaciones.length === 0 && rechazos.length === 0 && <p className="text-stone-600">Todo está sincronizado.</p>}
        <Boton variante="suave" className="w-full" onClick={alCerrar}>Cerrar</Boton>
      </div>
    </Fondo>
  );
}

function FilaVersiones({ fila }: { fila: { campo: string; mia: string; servidor: string } }) {
  return (
    <>
      <span className="text-stone-600">{fila.campo}</span>
      <span className="font-medium break-words">{fila.mia}</span>
      <span className="font-medium break-words">{fila.servidor}</span>
    </>
  );
}

