import { ICONOS_DISPONIBLES, iconoDe } from "../../core/formato";

/** Rejilla de iconos para elegir el de una categoria (cada uno de 44px o mas). */
export default function SelectorIcono({ valor, alCambiar }: { valor: string; alCambiar: (i: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Icono">
      {ICONOS_DISPONIBLES.map((i) => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={valor === i}
          aria-label={i}
          onClick={() => alCambiar(i)}
          className={`w-12 h-12 rounded-xl text-2xl border-2 ${valor === i ? "border-arca bg-arca-claro" : "border-stone-200 bg-white"}`}
        >
          {iconoDe(i)}
        </button>
      ))}
    </div>
  );
}
