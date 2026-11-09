import { useEffect, useRef, useState, type KeyboardEvent } from "react";

export interface AccionMenu {
  texto: string;
  alAccionar: () => void;
  peligro?: boolean;
}

/**
 * Boton "..." de cada fila con un menu corto de acciones (44px o mas, facil con el dedo).
 * Teclado: al abrir el foco va a la primera accion; flechas arriba/abajo (y Inicio/Fin) se mueven entre ellas;
 * Escape (o Tab) cierra y el foco vuelve al boton "...".
 */
export default function MenuFila({ acciones, etiqueta = "Acciones" }: { acciones: AccionMenu[]; etiqueta?: string }) {
  const [abierto, setAbierto] = useState(false);
  const boton = useRef<HTMLButtonElement>(null);
  const lista = useRef<HTMLUListElement>(null);
  const items = () => Array.from(lista.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  function cerrar() {
    setAbierto(false);
    boton.current?.focus({ preventScroll: true });
  }

  // al abrir: foco a la primera accion
  useEffect(() => {
    if (abierto) items()[0]?.focus({ preventScroll: true });
  }, [abierto]);

  // Escape cierra estando el foco donde este
  useEffect(() => {
    if (!abierto) return;
    const f = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      cerrar();
    };
    document.addEventListener("keydown", f);
    return () => document.removeEventListener("keydown", f);
  }, [abierto]);

  function alTeclear(e: KeyboardEvent<HTMLUListElement>) {
    const todos = items();
    const i = todos.indexOf(document.activeElement as HTMLElement);
    const ir = (n: number) => {
      e.preventDefault();
      todos[(n + todos.length) % todos.length]?.focus({ preventScroll: true });
    };
    if (e.key === "ArrowDown") ir(i + 1);
    else if (e.key === "ArrowUp") ir(i < 0 ? todos.length - 1 : i - 1);
    else if (e.key === "Home") ir(0);
    else if (e.key === "End") ir(todos.length - 1);
    else if (e.key === "Tab") {
      e.preventDefault();
      cerrar();
    }
  }

  if (acciones.length === 0) return null;
  return (
    <div className="relative">
      <button
        ref={boton}
        type="button"
        aria-label={etiqueta}
        aria-haspopup="menu"
        aria-expanded={abierto}
        onClick={() => (abierto ? cerrar() : setAbierto(true))}
        className="min-h-[44px] min-w-[44px] text-xl text-stone-500 rounded-xl active:bg-stone-100"
      >
        ⋯
      </button>
      {abierto && (
        <>
          <button className="fixed inset-0 z-40 cursor-default" tabIndex={-1} aria-label="Cerrar menu" onClick={cerrar} />
          <ul ref={lista} role="menu" onKeyDown={alTeclear} className="absolute right-0 top-11 z-50 min-w-[190px] bg-white rounded-xl border border-stone-200 shadow-lg py-1">
            {acciones.map((a) => (
              <li key={a.texto} role="none">
                <button
                  role="menuitem"
                  className={`w-full text-left min-h-[44px] px-4 font-medium active:bg-stone-100 ${a.peligro ? "text-red-700" : "text-stone-800"}`}
                  onClick={() => {
                    cerrar(); // el foco vuelve a "..." antes de abrir lo que sigue (un dialogo recordara este boton)
                    a.alAccionar();
                  }}
                >
                  {a.texto}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
