import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { ChipFiltro } from "../../core/ChipFiltro";
import Encabezado from "../../core/Encabezado";
import HojaOpciones, { type Opcion } from "../../core/HojaOpciones";
import { Boton, Cargando, ErrorCaja, Tarjeta, Vacio } from "../../core/ui";
import { useAuth } from "../auth/AuthContext";
import { listarMiembros, type MiembroFamilia } from "../familia/api";
import { actividadFamilia, type EntradaHistorial, type FiltrosActividadFamilia } from "./api";
import EntradaHistorialVista, { ACCIONES } from "./EntradaHistorialVista";

const TAMANO = 20;
const ENTIDADES: [string, string][] = [
  ["movimiento", "Movimientos"], ["apoyo", "Apoyos"], ["devolucion", "Devoluciones"],
  ["categoria", "Categorías"], ["miembro", "Miembros"], ["usuario", "Usuarios"],
];

type Filtro = "entidad" | "accion" | "usuario";

/** Actividad global de la familia: todo lo que se hizo, quien y cuando. Solo para administradores. */
export default function PaginaActividadFamilia() {
  const { usuario } = useAuth();
  const [filtros, setFiltros] = useState<FiltrosActividadFamilia>({ entidad: "", accion: "", usuario: "" });
  const [items, setItems] = useState<EntradaHistorial[]>([]);
  const [total, setTotal] = useState(0);
  const [hayMas, setHayMas] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [miembros, setMiembros] = useState<MiembroFamilia[]>([]);
  const [eligiendo, setEligiendo] = useState<Filtro | null>(null);
  const esAdmin = usuario?.rol === "admin";

  useEffect(() => {
    if (esAdmin) listarMiembros().then(setMiembros).catch(() => {});
  }, [esAdmin]);

  useEffect(() => {
    if (!esAdmin) return;
    let vivo = true;
    setCargando(true);
    actividadFamilia(filtros, 0, TAMANO)
      .then((p) => {
        if (!vivo) return;
        setItems(p.items);
        setTotal(p.total);
        setHayMas(p.hay_mas);
        setError(null);
      })
      .catch((e: Error) => vivo && setError(e.message))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [filtros, esAdmin]);

  async function cargarMas() {
    setCargandoMas(true);
    try {
      const p = await actividadFamilia(filtros, items.length, TAMANO);
      setItems((x) => [...x, ...p.items]);
      setTotal(p.total);
      setHayMas(p.hay_mas);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargandoMas(false);
    }
  }

  if (!esAdmin) return <Navigate to="/familia" replace />;

  const cambiar = (c: Partial<FiltrosActividadFamilia>) => {
    setItems([]);
    setFiltros((f) => ({ ...f, ...c }));
  };

  const opcionesDe: Record<Filtro, { etiqueta: string; opciones: Opcion[] }> = {
    entidad: { etiqueta: "Qué", opciones: [{ valor: "", texto: "Todo" }, ...ENTIDADES.map(([valor, texto]) => ({ valor, texto }))] },
    accion: { etiqueta: "Acción", opciones: [{ valor: "", texto: "Todas las acciones" }, ...Object.entries(ACCIONES).map(([valor, texto]) => ({ valor, texto }))] },
    usuario: {
      etiqueta: "Quién",
      opciones: [{ valor: "", texto: "Toda la familia" }, ...miembros.map((m) => ({ valor: String(m.usuario_id), texto: m.nombre }))],
    },
  };
  const textoDe = (f: Filtro) => opcionesDe[f].opciones.find((o) => o.valor === filtros[f])?.texto ?? opcionesDe[f].opciones[0].texto;

  return (
    <div className="space-y-4">
      <Encabezado titulo="Actividad de la familia" volverA="/familia" />
      <p className="text-sm text-stone-600">Todo lo que se hizo, quién lo hizo y cuándo. Solo se agrega: nunca se edita ni se borra.</p>

      {/* chips que abren una hoja de opciones (como en la lista y la bitacora): todo el texto se ve, nada se corta */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtros">
        {(["entidad", "accion", "usuario"] as const).map((f) => (
          <ChipFiltro key={f} etiqueta={opcionesDe[f].etiqueta} texto={textoDe(f)} activo={!!filtros[f]} alAbrir={() => setEligiendo(f)} />
        ))}
      </div>

      {error && <ErrorCaja mensaje={error} />}
      {cargando && items.length === 0 && <Cargando />}
      {!cargando && !error && items.length === 0 && <Vacio icono="🕑" texto="No hay actividad con estos filtros." />}
      {items.length > 0 && (
        <>
          <p className="text-sm text-stone-500" data-testid="total-actividad">{total} {total === 1 ? "entrada" : "entradas"}</p>
          <Tarjeta className="!py-0">
            <ul className="divide-y divide-stone-100">
              {items.map((e) => <EntradaHistorialVista key={e.id} e={e} mostrarEtiqueta />)}
            </ul>
          </Tarjeta>
          {hayMas && (
            <Boton variante="suave" className="w-full" onClick={cargarMas} disabled={cargandoMas}>
              {cargandoMas ? "Cargando..." : "Cargar más"}
            </Boton>
          )}
        </>
      )}
      {eligiendo && (
        <HojaOpciones
          titulo={opcionesDe[eligiendo].etiqueta}
          opciones={opcionesDe[eligiendo].opciones}
          valor={filtros[eligiendo]}
          alElegir={(v) => {
            cambiar({ [eligiendo]: v } as Partial<FiltrosActividadFamilia>);
            setEligiendo(null);
          }}
          alCerrar={() => setEligiendo(null)}
        />
      )}
    </div>
  );
}
