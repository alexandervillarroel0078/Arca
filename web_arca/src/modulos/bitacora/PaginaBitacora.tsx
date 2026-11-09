import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import Encabezado from "../../core/Encabezado";
import HojaOpciones, { type Opcion } from "../../core/HojaOpciones";
import { useDialogo } from "../../core/useDialogo";
import { fechaHora } from "../../core/tipos";
import { Boton, Cargando, ErrorCaja, Tarjeta, Vacio, claseInput } from "../../core/ui";
import { useAuth } from "../auth/AuthContext";
import { listarMiembros, type MiembroFamilia } from "../familia/api";
import {
  FILTROS_VACIOS, exportarCsv, listarBitacora, resumenBitacora,
  type EntradaBitacora, type FiltrosBitacora, type ResumenBitacora,
} from "./api";
import EntradaBitacoraVista from "./EntradaBitacoraVista";
import { resumenDispositivo } from "./dispositivo";

const TAMANO = 20;

const EVENTOS_ACCESO: Opcion[] = [
  { valor: "login_ok", texto: "Entrada" },
  { valor: "login_fallido", texto: "Entrada fallida" },
  { valor: "login_bloqueado", texto: "Entrada bloqueada" },
  { valor: "logout", texto: "Salida" },
  { valor: "registro", texto: "Registro" },
  { valor: "cambio_clave_ok", texto: "Clave cambiada" },
  { valor: "cambio_clave_fallido", texto: "Cambio de clave fallido" },
  { valor: "usuario_desactivado", texto: "Usuario desactivado" },
  { valor: "usuario_reactivado", texto: "Usuario reactivado" },
  { valor: "cambio_rol", texto: "Cambio de rol" },
  { valor: "acceso_denegado", texto: "Acceso denegado" },
  { valor: "token_invalido", texto: "Sesión inválida" },
  { valor: "sincronizacion_rechazada", texto: "Sincronización rechazada" },
];
const EVENTOS_DATOS: Opcion[] = [
  { valor: "crear", texto: "Creado" },
  { valor: "editar", texto: "Editado" },
  { valor: "anular", texto: "Anulado" },
  { valor: "reactivar", texto: "Reactivado" },
  { valor: "consumir", texto: "Consumido" },
  { valor: "reabrir", texto: "Reabierto" },
  { valor: "cambiar_rol", texto: "Cambio de rol" },
  { valor: "desactivar", texto: "Desactivado" },
  { valor: "cambiar_clave", texto: "Clave cambiada" },
];
const CLAVE_RESTABLECIDA: Opcion = { valor: "restablecer_clave", texto: "Clave restablecida" }; // existe en los dos origenes

export function opcionesDeEvento(origen: FiltrosBitacora["origen"]): Opcion[] {
  const todos = { valor: "", texto: "Todos los eventos" };
  if (origen === "acceso") return [todos, ...EVENTOS_ACCESO, CLAVE_RESTABLECIDA];
  if (origen === "datos") return [todos, ...EVENTOS_DATOS, CLAVE_RESTABLECIDA];
  return [
    todos,
    ...EVENTOS_ACCESO.map((o) => ({ ...o, texto: `Acceso · ${o.texto}` })),
    ...EVENTOS_DATOS.map((o) => ({ ...o, texto: `Datos · ${o.texto}` })),
    CLAVE_RESTABLECIDA,
  ];
}

const RESULTADOS: Opcion[] = [
  { valor: "", texto: "Todos" },
  { valor: "ok", texto: "Correcto" },
  { valor: "fallo", texto: "Con fallo" },
];

const ORIGENES: { valor: FiltrosBitacora["origen"]; texto: string }[] = [
  { valor: "", texto: "Todo" },
  { valor: "acceso", texto: "Accesos" },
  { valor: "datos", texto: "Datos" },
];

// ------------------------------------------------------------------ fechas
export type Rango = { clave: "" | "hoy" | "7" | "30" | "otro"; desde: string; hasta: string }; // desde/hasta: AAAA-MM-DD

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const inicioDelDia = (s: string) => {
  const [a, m, d] = s.split("-").map(Number);
  return new Date(a, m - 1, d, 0, 0, 0, 0).toISOString();
};
const finDelDia = (s: string) => {
  const [a, m, d] = s.split("-").map(Number);
  return new Date(a, m - 1, d, 23, 59, 59, 999).toISOString();
};

/** Dias elegidos (en la hora del aparato) -> instantes ISO que entiende el servidor. */
export function rangoAFiltro(r: Rango, hoy = new Date()): { desde: string; hasta: string } {
  if (r.clave === "hoy") return { desde: inicioDelDia(ymd(hoy)), hasta: finDelDia(ymd(hoy)) };
  if (r.clave === "7" || r.clave === "30") {
    const ini = new Date(hoy);
    ini.setDate(ini.getDate() - (r.clave === "7" ? 6 : 29));
    return { desde: inicioDelDia(ymd(ini)), hasta: finDelDia(ymd(hoy)) };
  }
  if (r.clave === "otro") return { desde: r.desde ? inicioDelDia(r.desde) : "", hasta: r.hasta ? finDelDia(r.hasta) : "" };
  return { desde: "", hasta: "" };
}

const PRESETS: { valor: Rango["clave"]; texto: string }[] = [
  { valor: "", texto: "Cualquier fecha" },
  { valor: "hoy", texto: "Hoy" },
  { valor: "7", texto: "Últimos 7 días" },
  { valor: "30", texto: "Últimos 30 días" },
];

function textoDeRango(r: Rango): string {
  if (r.clave === "otro") return [r.desde || "...", r.hasta || "..."].join(" a ");
  return PRESETS.find((p) => p.valor === r.clave)?.texto ?? "Cualquier fecha";
}

function HojaFechas({ rango, alElegir, alCerrar }: { rango: Rango; alElegir: (r: Rango) => void; alCerrar: () => void }) {
  const [desde, setDesde] = useState(rango.clave === "otro" ? rango.desde : "");
  const [hasta, setHasta] = useState(rango.clave === "otro" ? rango.hasta : "");
  const invalido = !!desde && !!hasta && desde > hasta;
  const ref = useDialogo<HTMLDivElement>({ alCerrar });
  const sinGuardar = desde !== (rango.clave === "otro" ? rango.desde : "") || hasta !== (rango.clave === "otro" ? rango.hasta : "");
  return (
    <div ref={ref} className="fixed inset-0 !m-0 z-[55] bg-black/40 flex items-end justify-center">
      <button type="button" aria-label="Cerrar opciones" tabIndex={-1} className="absolute inset-0 cursor-default" onClick={() => !sinGuardar && alCerrar()} />
      <div role="dialog" aria-modal="true" aria-label="Fechas" className="relative w-full max-w-[480px] bg-white rounded-t-3xl p-5 pb-8 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-titulo text-xl font-bold">Fechas</h2>
          <button type="button" aria-label="Cerrar hoja" onClick={alCerrar} className="min-h-[44px] min-w-[44px] text-xl text-stone-500">✕</button>
        </div>
        <div role="radiogroup" aria-label="Periodo" className="divide-y divide-stone-100">
          {PRESETS.map((p) => (
            <button
              key={p.valor}
              type="button"
              role="radio"
              aria-checked={rango.clave === p.valor}
              onClick={() => alElegir({ clave: p.valor, desde: "", hasta: "" })}
              className={`w-full min-h-[52px] flex items-center justify-between text-left px-1 font-medium ${rango.clave === p.valor ? "text-arca" : ""}`}
            >
              <span>{p.texto}</span>
              {rango.clave === p.valor && <span aria-hidden className="text-xl">✓</span>}
            </button>
          ))}
        </div>
        <div className="mt-4 space-y-3">
          <p className="text-sm font-semibold text-stone-600">O elige un rango</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm font-semibold text-stone-600">
              Desde
              <input type="date" aria-label="Desde" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} className={`${claseInput} mt-1`} />
            </label>
            <label className="block text-sm font-semibold text-stone-600">
              Hasta
              <input type="date" aria-label="Hasta" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} className={`${claseInput} mt-1`} />
            </label>
          </div>
          {invalido && (
            <p role="alert" className="text-sm font-medium text-red-700 before:content-['⚠'] before:mr-1.5">
              La fecha "Desde" no puede ser posterior a "Hasta".
            </p>
          )}
          <Boton disabled={invalido || (!desde && !hasta)} onClick={() => alElegir({ clave: "otro", desde, hasta })}>Aplicar rango</Boton>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ resumen
function ResumenTarjetas({ r }: { r: ResumenBitacora }) {
  return (
    <section aria-label="Resumen" className="space-y-3" data-testid="resumen-bitacora">
      <Tarjeta>
        <h2 className="font-titulo font-bold mb-2">Último acceso</h2>
        <ul className="divide-y divide-stone-100">
          {r.ultimos_accesos.map((u) => (
            <li key={u.usuario_id} className="py-2" data-testid="ultimo-acceso">
              <p className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="font-semibold">
                  {u.nombre}
                  {!u.activo && <span className="text-stone-500 font-normal"> (desactivado)</span>}
                </span>
                <span className="text-sm text-stone-700">{u.ultimo_login ? fechaHora(u.ultimo_login) : "Nunca entró"}</span>
              </p>
              {u.ultimo_login && (u.ip || u.dispositivo) && (
                <p className="text-xs text-stone-500 break-words">
                  {[u.ip && `IP ${u.ip}`, resumenDispositivo(u.dispositivo)].filter(Boolean).join(" · ")}
                </p>
              )}
            </li>
          ))}
        </ul>
      </Tarjeta>

      <Tarjeta className={r.fallos_login_7d > 0 ? "!border-red-200 !bg-red-50" : ""}>
        <h2 className="font-titulo font-bold">Fallos de la semana</h2>
        <p data-testid="fallos-semana" className={`text-sm mt-1 ${r.fallos_login_7d > 0 ? "text-red-800" : "text-stone-700"}`}>
          {r.fallos_login_7d === 0 && r.bloqueos_login_7d === 0 ? (
            <>
              <span aria-hidden>✓ </span>Sin intentos fallidos en los últimos 7 días
            </>
          ) : (
            <>
              <span className="font-titulo text-2xl font-bold">{r.fallos_login_7d}</span>{" "}
              {r.fallos_login_7d === 1 ? "intento fallido" : "intentos fallidos"} de entrada
              {r.bloqueos_login_7d > 0 && ` · ${r.bloqueos_login_7d} ${r.bloqueos_login_7d === 1 ? "bloqueo" : "bloqueos"}`}
            </>
          )}
        </p>
        {r.fallos_por_usuario.length > 0 && (
          <p className="text-xs text-red-800 mt-1">{r.fallos_por_usuario.map((f) => `${f.nombre}: ${f.fallos}`).join(" · ")}</p>
        )}
      </Tarjeta>

      {r.novedades.length > 0 && (
        <Tarjeta className="!border-apoyo/40 !bg-apoyo-claro">
          <h2 className="font-titulo font-bold text-apoyo-texto">IP o dispositivo nuevo</h2>
          <ul className="mt-1 space-y-0.5 text-sm text-apoyo-texto" data-testid="novedades">
            {r.novedades.slice(0, 5).map((n) => (
              <li key={`${n.usuario_id}-${n.tipo}-${n.valor}`} className="break-words">
                {n.nombre} entro por primera vez con {n.tipo === "ip" ? `la IP ${n.valor}` : resumenDispositivo(n.valor) || n.valor} ·{" "}
                {fechaHora(n.primera_vez)}
              </li>
            ))}
          </ul>
        </Tarjeta>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ pantalla
type Hoja = "evento" | "resultado" | "persona" | "fechas" | null;

/** Bitacora unificada: accesos y seguridad + cambios de datos, en orden cronologico. Solo administradores. */
export default function PaginaBitacora() {
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === "admin";
  const [filtros, setFiltros] = useState<FiltrosBitacora>(FILTROS_VACIOS);
  const [rango, setRango] = useState<Rango>({ clave: "", desde: "", hasta: "" });
  const [items, setItems] = useState<EntradaBitacora[]>([]);
  const [siguiente, setSiguiente] = useState<string | null>(null);
  const [hayMas, setHayMas] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumen, setResumen] = useState<ResumenBitacora | null>(null);
  const [miembros, setMiembros] = useState<MiembroFamilia[]>([]);
  const [hoja, setHoja] = useState<Hoja>(null);
  const [exportando, setExportando] = useState(false);
  const [errorExportar, setErrorExportar] = useState<string | null>(null);
  const pedido = useRef(0); // descarta respuestas viejas si se cambia de filtro mientras carga

  useEffect(() => {
    if (!esAdmin) return;
    resumenBitacora().then(setResumen).catch(() => {});
    listarMiembros().then(setMiembros).catch(() => {});
  }, [esAdmin]);

  useEffect(() => {
    if (!esAdmin) return;
    const mio = ++pedido.current;
    setCargando(true);
    listarBitacora(filtros, null, TAMANO)
      .then((p) => {
        if (mio !== pedido.current) return;
        setItems(p.items);
        setSiguiente(p.siguiente);
        setHayMas(p.hay_mas);
        setError(null);
      })
      .catch((e: Error) => {
        if (mio !== pedido.current) return;
        setItems([]);
        setError(e.message);
      })
      .finally(() => mio === pedido.current && setCargando(false));
  }, [filtros, esAdmin]);

  async function cargarMas() {
    const mio = pedido.current;
    setCargandoMas(true);
    try {
      const p = await listarBitacora(filtros, siguiente, TAMANO);
      if (mio !== pedido.current) return;
      setItems((x) => [...x, ...p.items]);
      setSiguiente(p.siguiente);
      setHayMas(p.hay_mas);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargandoMas(false);
    }
  }

  async function exportar() {
    setExportando(true);
    setErrorExportar(null);
    try {
      await exportarCsv(filtros);
    } catch (e) {
      setErrorExportar((e as Error).message);
    } finally {
      setExportando(false);
    }
  }

  const opcionesPersona = useMemo<Opcion[]>(
    () => [{ valor: "", texto: "Toda la familia" }, ...miembros.map((m) => ({ valor: String(m.usuario_id), texto: m.nombre }))],
    [miembros],
  );

  if (!esAdmin) return <Navigate to="/familia" replace />;

  const cambiar = (c: Partial<FiltrosBitacora>) => {
    setItems([]);
    setFiltros((f) => ({ ...f, ...c }));
  };
  const elegirOrigen = (origen: FiltrosBitacora["origen"]) => {
    // un evento de acceso no existe en "Datos" y al reves: se limpia si ya no corresponde
    const sigue = opcionesDeEvento(origen).some((o) => o.valor === filtros.evento);
    cambiar({ origen, evento: sigue ? filtros.evento : "" });
  };
  const elegirRango = (r: Rango) => {
    setRango(r);
    cambiar(rangoAFiltro(r));
    setHoja(null);
  };
  const quitarFiltros = () => {
    setRango({ clave: "", desde: "", hasta: "" });
    cambiar(FILTROS_VACIOS);
  };
  const hayFiltros = JSON.stringify(filtros) !== JSON.stringify(FILTROS_VACIOS);

  const eventos = opcionesDeEvento(filtros.origen);
  const textoDe = (ops: Opcion[], valor: string) => ops.find((o) => o.valor === valor)?.texto ?? ops[0].texto;
  const chips: { id: Exclude<Hoja, null>; etiqueta: string; texto: string; activo: boolean }[] = [
    { id: "evento", etiqueta: "Evento", texto: textoDe(eventos, filtros.evento), activo: !!filtros.evento },
    { id: "resultado", etiqueta: "Resultado", texto: textoDe(RESULTADOS, filtros.resultado), activo: !!filtros.resultado },
    { id: "persona", etiqueta: "Persona", texto: textoDe(opcionesPersona, filtros.persona), activo: !!filtros.persona },
    { id: "fechas", etiqueta: "Fechas", texto: textoDeRango(rango), activo: rango.clave !== "" },
  ];

  return (
    <div className="space-y-4">
      <Encabezado titulo="Bitácora" volverA="/familia" />
      <p className="text-sm text-stone-600">
        Quién entró, los intentos fallidos y los cambios que se hicieron, en orden. Solo se agrega: nunca se edita ni se borra.
      </p>

      {resumen && <ResumenTarjetas r={resumen} />}

      <div role="group" aria-label="Origen" className="grid grid-cols-3 gap-1 rounded-full bg-stone-200/70 p-1">
        {ORIGENES.map((o) => (
          <button
            key={o.valor}
            type="button"
            aria-pressed={filtros.origen === o.valor}
            onClick={() => elegirOrigen(o.valor)}
            className={`min-h-[44px] rounded-full font-semibold text-sm ${filtros.origen === o.valor ? "bg-white text-arca shadow-sm" : "text-stone-700"}`}
          >
            {o.texto}
          </button>
        ))}
      </div>

      <div className="-mx-4 px-4 flex gap-2 overflow-x-auto pb-1 snap-x scroll-pl-4" role="group" aria-label="Filtros">
        {chips.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setHoja(c.id)}
            aria-haspopup="dialog"
            className={`snap-start shrink-0 min-h-[44px] px-4 rounded-full border-[1.5px] font-semibold text-sm whitespace-nowrap ${
              c.activo ? "bg-arca-claro border-arca text-arca" : "bg-white border-stone-300 text-stone-800"
            }`}
          >
            {c.etiqueta}: {c.texto} <span aria-hidden>▾</span>
          </button>
        ))}
      </div>

      {error && <ErrorCaja mensaje={error} />}
      {cargando && items.length === 0 && <Cargando texto="Cargando la bitácora..." />}
      {!cargando && !error && items.length === 0 && (
        <Vacio
          icono="🛡️"
          texto={hayFiltros ? "No hay nada en la bitácora con estos filtros." : "Todavía no hay nada en la bitácora. Aquí aparecerán las entradas y los cambios."}
          accion={hayFiltros ? { texto: "Quitar filtros", alClic: quitarFiltros } : undefined}
        />
      )}

      {items.length > 0 && (
        <>
          <Tarjeta className="!py-0">
            <ul className="divide-y divide-stone-100" data-testid="lista-bitacora">
              {items.map((e) => <EntradaBitacoraVista key={e.clave} e={e} />)}
            </ul>
          </Tarjeta>
          {hayMas && (
            <Boton variante="suave" className="w-full" onClick={cargarMas} disabled={cargandoMas}>
              {cargandoMas ? "Cargando..." : "Cargar más"}
            </Boton>
          )}
        </>
      )}

      <div className="space-y-2">
        {errorExportar && <ErrorCaja mensaje={errorExportar} />}
        <Boton variante="suave" className="w-full" onClick={exportar} disabled={exportando}>
          {exportando ? "Exportando..." : "Exportar CSV"}
        </Boton>
        <p className="text-xs text-stone-500 text-center">Con los filtros elegidos, hasta 5000 filas.</p>
      </div>

      {hoja === "evento" && (
        <HojaOpciones titulo="Evento" opciones={eventos} valor={filtros.evento} alElegir={(v) => { cambiar({ evento: v }); setHoja(null); }} alCerrar={() => setHoja(null)} />
      )}
      {hoja === "resultado" && (
        <HojaOpciones titulo="Resultado" opciones={RESULTADOS} valor={filtros.resultado} alElegir={(v) => { cambiar({ resultado: v as FiltrosBitacora["resultado"] }); setHoja(null); }} alCerrar={() => setHoja(null)} />
      )}
      {hoja === "persona" && (
        <HojaOpciones titulo="Persona" opciones={opcionesPersona} valor={filtros.persona} alElegir={(v) => { cambiar({ persona: v }); setHoja(null); }} alCerrar={() => setHoja(null)} />
      )}
      {hoja === "fechas" && <HojaFechas rango={rango} alElegir={elegirRango} alCerrar={() => setHoja(null)} />}
    </div>
  );
}
