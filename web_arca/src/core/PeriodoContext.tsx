// Periodo elegido, compartido por Inicio, Lista, Reportes y Apoyos. Vive por encima de las pantallas, asi se
// conserva al navegar entre ellas; se reinicia a "Mes actual" al cerrar sesion (cambia `sesion`).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SELECCION_INICIAL, hoyLaPaz, resolverPeriodo, seleccionActual, type Periodo, type Seleccion, type TipoPeriodo } from "./periodo";

interface PeriodoCtx {
  seleccion: Seleccion;
  periodo: Periodo;
  diaInicioMes: number;
  /** "Hoy", "Semana", "Mes", "Anio": el periodo actual de ese tipo. */
  elegirTipo: (tipo: Exclude<TipoPeriodo, "rango">) => void;
  elegirRango: (desde: string, hasta: string) => void;
  ir: (s: Seleccion) => void;
  alAnterior: () => void;
  alSiguiente: () => void;
  reiniciar: () => void;
}

const Ctx = createContext<PeriodoCtx | null>(null);

export function usePeriodo(): PeriodoCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("usePeriodo fuera de PeriodoProvider");
  return c;
}

export function PeriodoProvider({
  children,
  diaInicioMes = 1,
  sesion = null,
  inicial = SELECCION_INICIAL,
  hoy = hoyLaPaz,
}: {
  children: ReactNode;
  diaInicioMes?: number;
  /** Identifica la sesion: al cambiar (cerrar sesion o entrar otra cuenta) vuelve a "Mes actual". */
  sesion?: number | null;
  inicial?: Seleccion;
  hoy?: () => string;
}) {
  const [seleccion, setSeleccion] = useState<Seleccion>(inicial);
  const reiniciar = useCallback(() => setSeleccion(SELECCION_INICIAL), []);
  const sesionAnterior = useRef(sesion);
  useEffect(() => {
    if (sesionAnterior.current === sesion) return; // al montar no se pisa la seleccion inicial
    sesionAnterior.current = sesion;
    reiniciar();
  }, [sesion, reiniciar]);

  const valor = useMemo<PeriodoCtx>(() => {
    const periodo = resolverPeriodo(seleccion, diaInicioMes, hoy());
    return {
      seleccion,
      periodo,
      diaInicioMes,
      elegirTipo: (tipo) => setSeleccion(seleccionActual(tipo)),
      elegirRango: (desde, hasta) => setSeleccion({ tipo: "rango", referencia: null, desde, hasta }),
      ir: setSeleccion,
      alAnterior: () => setSeleccion(periodo.anterior),
      alSiguiente: () => !periodo.esActual && setSeleccion(periodo.siguiente),
      reiniciar,
    };
  }, [seleccion, diaInicioMes, hoy, reiniciar]);

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}
