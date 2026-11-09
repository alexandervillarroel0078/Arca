import { useDialogo } from "./useDialogo";

export interface Opcion {
  valor: string;
  texto: string;
}

/** Lista de opciones para elegir una (se abre desde un chip de filtro). Hoja que sube desde abajo. */
export default function HojaOpciones({
  titulo,
  opciones,
  valor,
  alElegir,
  alCerrar,
}: {
  titulo: string;
  opciones: Opcion[];
  valor: string;
  alElegir: (v: string) => void;
  alCerrar: () => void;
}) {
  // Escape cierra, el foco va a la opcion elegida (o a la primera cosa util) y vuelve al chip al cerrar
  const ref = useDialogo<HTMLDivElement>({ alCerrar });
  return (
    <div ref={ref} className="fixed inset-0 !m-0 z-[55] bg-black/40 flex items-end justify-center">
      <button type="button" aria-label="Cerrar opciones" tabIndex={-1} className="absolute inset-0 cursor-default" onClick={alCerrar} />
      <div role="dialog" aria-modal="true" aria-label={titulo} className="relative w-full max-w-[480px] bg-white rounded-t-3xl p-5 pb-8 max-h-[75vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-titulo text-xl font-bold">{titulo}</h2>
          <button type="button" aria-label="Cerrar hoja" onClick={alCerrar} className="min-h-[44px] min-w-[44px] text-xl text-stone-500">✕</button>
        </div>
        <div role="radiogroup" aria-label={titulo} className="divide-y divide-stone-100">
          {opciones.map((o) => {
            const activa = o.valor === valor;
            return (
              <button
                key={o.valor}
                type="button"
                role="radio"
                aria-checked={activa}
                data-autofoco={activa ? "" : undefined}
                onClick={() => alElegir(o.valor)}
                className={`w-full min-h-[52px] flex items-center justify-between text-left px-1 font-medium ${activa ? "text-arca" : ""}`}
              >
                <span>{o.texto}</span>
                {activa && <span aria-hidden className="text-xl">✓</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
