import { useEffect, useMemo, useState } from "react";
import { ErrorRed } from "../../core/api";
import { ChipFiltro, ChipInterruptor } from "../../core/ChipFiltro";
import Encabezado from "../../core/Encabezado";
import HojaOpciones, { type Opcion } from "../../core/HojaOpciones";
import { bs } from "../../core/formato";
import { hoyLaPaz } from "../../core/periodo";
import { usePeriodo } from "../../core/PeriodoContext";
import SelectorPeriodo from "../../core/SelectorPeriodo";
import { Boton, Cargando, ErrorCaja, SinDatosPeriodo, Tarjeta, Vacio } from "../../core/ui";
import { listarCategorias, listarMiembros, type Categoria, type MiembroFamilia } from "../familia/api";
import { listarActividad, type FiltrosActividad, type ItemActividad } from "./actividad";
import { agruparPorDia } from "./agrupar";
import FilaActividad, { useAccionesFila } from "./FilaActividad";

const TAMANO = 20;
type Filtro = "usuario" | "tipo" | "categoria";

const TIPOS: Opcion[] = [
  { valor: "", texto: "Todos los tipos" },
  { valor: "gasto", texto: "Gastos" },
  { valor: "ingreso", texto: "Ingresos" },
  { valor: "apoyo", texto: "Apoyos" },
];

/** Lista completa de movimientos y apoyos. Filtros como chips que abren una lista de opciones. Desde aqui se edita, anula y reactiva. */
export default function PaginaLista() {
  const { periodo } = usePeriodo();
  const [otros, setOtros] = useState({ usuario: "", tipo: "", categoria: "", verAnulados: false });
  // el periodo viene del selector comun; los demas filtros son de esta pantalla
  const filtros = useMemo<FiltrosActividad>(
    () => ({ desde: periodo.desde, hasta: periodo.hasta, ...otros }),
    [periodo.desde, periodo.hasta, otros],
  );
  const [items, setItems] = useState<ItemActividad[]>([]);
  const [total, setTotal] = useState(0);
  const [hayMas, setHayMas] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sinConexion, setSinConexion] = useState(false);
  const [version, setVersion] = useState(0);
  const [miembros, setMiembros] = useState<MiembroFamilia[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [eligiendo, setEligiendo] = useState<Filtro | null>(null);

  // al cambiar de periodo se empieza de cero (no se muestra la lista de otro periodo)
  const clavePeriodo = `${periodo.desde}_${periodo.hasta}`;
  const [periodoVisto, setPeriodoVisto] = useState(clavePeriodo);
  if (periodoVisto !== clavePeriodo) {
    setPeriodoVisto(clavePeriodo);
    setItems([]);
    setTotal(0);
    setHayMas(false);
    setError(null);
    setSinConexion(false);
  }

  const recargar = () => setVersion((v) => v + 1);
  const { acciones, dialogos } = useAccionesFila(recargar);
  // al terminar de sincronizar (o resolver un conflicto) se vuelve a leer la lista
  useEffect(() => {
    window.addEventListener("arca-datos-nuevos", recargar);
    return () => window.removeEventListener("arca-datos-nuevos", recargar);
  }, []);

  useEffect(() => {
    listarMiembros().then(setMiembros).catch(() => {});
    listarCategorias().then(setCategorias).catch(() => {});
  }, []);

  // Primera pagina (o recarga conservando lo ya cargado) cada vez que cambian los filtros o hay un cambio.
  useEffect(() => {
    let vivo = true;
    setCargando(true);
    listarActividad(filtros, 0, Math.min(100, Math.max(TAMANO, items.length)))
      .then((p) => {
        if (!vivo) return;
        setItems(p.items);
        setTotal(p.total);
        setHayMas(p.hay_mas);
        setError(null);
        setSinConexion(false);
      })
      .catch((e: Error) => vivo && (setError(e.message), setSinConexion(e instanceof ErrorRed)))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtros, version]);

  async function cargarMas() {
    setCargandoMas(true);
    try {
      const p = await listarActividad(filtros, items.length, TAMANO);
      setItems((x) => [...x, ...p.items]);
      setTotal(p.total);
      setHayMas(p.hay_mas);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargandoMas(false);
    }
  }

  const cambiar = (c: Partial<typeof otros>) => {
    setItems([]); // al cambiar un filtro se empieza de cero
    setOtros((f) => ({ ...f, ...c }));
  };

  const sinCategoria = filtros.tipo === "apoyo" || filtros.tipo === "ingreso";
  const personas: Opcion[] = [{ valor: "", texto: "Toda la familia" }, ...miembros.map((m) => ({ valor: String(m.usuario_id), texto: m.nombre }))];
  const cats: Opcion[] = [
    { valor: "", texto: "Todas las categorías" },
    ...categorias.map((c) => ({ valor: String(c.id), texto: `${c.nombre}${c.activa ? "" : " (desactivada)"}` })),
  ];
  const opcionesDe: Record<Filtro, { titulo: string; opciones: Opcion[]; valor: string }> = {
    usuario: { titulo: "Persona", opciones: personas, valor: filtros.usuario },
    tipo: { titulo: "Tipo", opciones: TIPOS, valor: filtros.tipo },
    categoria: { titulo: "Categoría", opciones: cats, valor: filtros.categoria },
  };
  const textoDe = (f: Filtro) => opcionesDe[f].opciones.find((o) => o.valor === opcionesDe[f].valor)?.texto ?? opcionesDe[f].opciones[0].texto;
  // dias con sus filas y su total; "hoy" es el de los periodos (La Paz)
  const grupos = useMemo(() => agruparPorDia(items, hoyLaPaz(), hayMas), [items, hayMas]);
  const hayFiltros = !!filtros.usuario || !!filtros.tipo || !!filtros.categoria || filtros.verAnulados;
  const quitarFiltros = () => cambiar({ usuario: "", tipo: "", categoria: "", verAnulados: false });

  function elegir(f: Filtro, valor: string) {
    if (f === "tipo") cambiar({ tipo: valor, categoria: valor === "gasto" || valor === "" ? filtros.categoria : "" });
    else cambiar({ [f]: valor } as Partial<typeof otros>);
    setEligiendo(null);
  }

  const chips: { f: Filtro; etiqueta: string; desactivado?: boolean; activo: boolean }[] = [
    { f: "usuario", etiqueta: "Persona", activo: !!filtros.usuario },
    { f: "tipo", etiqueta: "Tipo", activo: !!filtros.tipo },
    { f: "categoria", etiqueta: "Categoría", activo: !!filtros.categoria, desactivado: sinCategoria },
  ];

  return (
    <div className="space-y-4">
      <Encabezado titulo="Todos los movimientos" volverA="/" />
      <SelectorPeriodo />

      <div className="-mx-4 px-4 flex gap-2 overflow-x-auto pb-1 snap-x scroll-pl-4" role="group" aria-label="Filtros">
        <ChipInterruptor etiqueta="Ver anulados" activo={filtros.verAnulados} alCambiar={(v) => cambiar({ verAnulados: v })} />
        {chips.map((c) => (
          <ChipFiltro
            key={c.f}
            etiqueta={c.etiqueta}
            texto={textoDe(c.f)}
            activo={c.activo}
            desactivado={c.desactivado}
            alAbrir={() => setEligiendo(c.f)}
          />
        ))}
      </div>

      {error && items.length === 0 && sinConexion ? <SinDatosPeriodo /> : error && <ErrorCaja mensaje={error} />}
      {cargando && items.length === 0 && <Cargando />}
      {!cargando && !error && items.length === 0 && (
        <Vacio
          icono="🔎"
          texto={hayFiltros ? "No hay movimientos con estos filtros en este periodo." : "No hay movimientos en este periodo."}
          accion={hayFiltros ? { texto: "Quitar filtros", alClic: quitarFiltros } : { texto: "Registrar un movimiento", a: "/nuevo" }}
        />
      )}

      {items.length > 0 && (
        <>
          <p className="text-sm text-stone-600" data-testid="total-lista">{total} {total === 1 ? "registro" : "registros"}</p>
          <div className="space-y-4">
            {grupos.map((g) => (
              <section key={g.fecha} aria-label={`Movimientos de ${g.titulo}`}>
                <div data-testid="encabezado-dia" className="mb-1.5 flex items-baseline justify-between gap-2 px-1">
                  <h2 className="font-titulo font-bold text-stone-800">{g.titulo}</h2>
                  {g.total !== null && (
                    <p data-testid="total-dia" className={`monto text-sm font-semibold ${g.total > 0 ? "text-arca" : "text-stone-700"}`}>
                      <span className="solo-lectores">Total del día: </span>
                      {g.total > 0 ? "+" : ""}{bs(g.total)}
                    </p>
                  )}
                </div>
                <Tarjeta className="!p-0 divide-y divide-stone-100">
                  {g.items.map((i) => (
                    // el dia ya esta en el encabezado: la fecha de la fila solo queda para lectores de pantalla.
                    // Con una sola persona filtrada, su nombre sobra: tambien solo para lectores de pantalla.
                    <FilaActividad key={`${i.clase}-${i.id}`} item={i} acciones={acciones(i)} mostrarFecha={false} mostrarAutor={!filtros.usuario} />
                  ))}
                </Tarjeta>
              </section>
            ))}
          </div>
          {hayMas && (
            <Boton variante="suave" className="w-full" onClick={cargarMas} disabled={cargandoMas}>
              {cargandoMas ? "Cargando..." : "Cargar más"}
            </Boton>
          )}
        </>
      )}
      {dialogos}
      {eligiendo && (
        <HojaOpciones
          titulo={opcionesDe[eligiendo].titulo}
          opciones={opcionesDe[eligiendo].opciones}
          valor={opcionesDe[eligiendo].valor}
          alElegir={(v) => elegir(eligiendo, v)}
          alCerrar={() => setEligiendo(null)}
        />
      )}
    </div>
  );
}
