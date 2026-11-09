/** Chip de filtro que abre una hoja de opciones (`HojaOpciones`): "Persona: Toda la familia ▾". Lo usan Lista y Actividad. */
export function ChipFiltro({
  etiqueta,
  texto,
  activo,
  desactivado = false,
  alAbrir,
}: {
  etiqueta: string;
  texto: string;
  activo: boolean;
  desactivado?: boolean;
  alAbrir: () => void;
}) {
  return (
    <button
      type="button"
      disabled={desactivado}
      onClick={alAbrir}
      aria-haspopup="dialog"
      className={`snap-start shrink-0 min-h-[44px] px-4 rounded-full border-[1.5px] font-semibold text-sm whitespace-nowrap disabled:opacity-40 ${
        activo ? "bg-arca-claro border-arca text-arca" : "bg-white border-stone-300 text-stone-800"
      }`}
    >
      {etiqueta}: {texto} <span aria-hidden>▾</span>
    </button>
  );
}

/**
 * Filtro de si/no con aspecto de chip ("Ver anulados"). Por dentro es un interruptor de verdad (`<input type="checkbox" role="switch">`)
 * que cubre todo el chip: funciona con teclado y lectores y se activa tocando el chip entero. Activo se ve con borde, fondo y una marca ✓.
 */
export function ChipInterruptor({ etiqueta, activo, alCambiar }: { etiqueta: string; activo: boolean; alCambiar: (v: boolean) => void }) {
  return (
    <label className="relative inline-flex shrink-0 snap-start cursor-pointer">
      <input
        type="checkbox"
        role="switch"
        checked={activo}
        onChange={(e) => alCambiar(e.target.checked)}
        className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
      <span
        className={`inline-flex min-h-[44px] items-center gap-1 rounded-full border-[1.5px] px-4 text-sm font-semibold whitespace-nowrap peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-arca ${
          activo ? "border-arca bg-arca-claro text-arca" : "border-stone-300 bg-white text-stone-800"
        }`}
      >
        {activo && <span aria-hidden>✓</span>}
        {etiqueta}
      </span>
    </label>
  );
}
