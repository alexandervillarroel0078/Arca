// Selector de periodo comun (Inicio, Lista, Reportes y Apoyos): chips Hoy | Semana | Mes | Anio | Rango,
// flechas anterior/siguiente y la etiqueta del periodo. La flecha siguiente se desactiva si el periodo contiene hoy.
import { useNavigate } from "react-router-dom";
import { usePeriodo } from "./PeriodoContext";
import type { TipoPeriodo } from "./periodo";

const CHIPS: { tipo: TipoPeriodo; texto: string }[] = [
  { tipo: "dia", texto: "Hoy" },
  { tipo: "semana", texto: "Semana" },
  { tipo: "mes", texto: "Mes" },
  { tipo: "anio", texto: "Año" },
  { tipo: "rango", texto: "Rango" },
];

export default function SelectorPeriodo() {
  const { seleccion, periodo, elegirTipo, alAnterior, alSiguiente } = usePeriodo();
  const navegar = useNavigate();

  return (
    <section aria-label="Periodo" data-testid="selector-periodo" className="space-y-2">
      <div role="group" aria-label="Tipo de periodo" className="grid grid-cols-5 gap-1.5">
        {CHIPS.map((c) => {
          const activo = seleccion.tipo === c.tipo;
          return (
            <button
              key={c.tipo}
              type="button"
              aria-pressed={activo}
              onClick={() => (c.tipo === "rango" ? navegar("/periodo/rango") : elegirTipo(c.tipo))}
              className={`min-h-[44px] px-1 rounded-full border-[1.5px] text-sm font-semibold ${
                activo ? "bg-arca-claro border-arca text-arca" : "bg-white border-stone-300 text-stone-800 active:bg-stone-100"
              }`}
            >
              {c.texto}
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between bg-white rounded-2xl border border-stone-200">
        <button type="button" className="min-h-[44px] min-w-[44px] text-xl" aria-label="Periodo anterior" onClick={alAnterior}>
          ‹
        </button>
        <span className="font-titulo font-bold text-center px-1" data-testid="etiqueta-periodo" aria-live="polite">
          {periodo.etiqueta}
        </span>
        <button
          type="button"
          className="min-h-[44px] min-w-[44px] text-xl disabled:opacity-30"
          aria-label="Periodo siguiente"
          disabled={periodo.esActual}
          onClick={alSiguiente}
        >
          ›
        </button>
      </div>
    </section>
  );
}
