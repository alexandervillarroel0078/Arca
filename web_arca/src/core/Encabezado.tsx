import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/**
 * "Volver": regresa a la pantalla anterior si el usuario llego navegando dentro de la app; si abrio la ruta directamente
 * (recargo la pagina o uso un enlace) va a `fallback`, asi nunca saca al usuario de la app.
 */
export function useVolver(fallback: string) {
  const navegar = useNavigate();
  const { key } = useLocation();
  return () => (key !== "default" ? navegar(-1) : navegar(fallback, { replace: true }));
}

/** Encabezado de las pantallas internas: "‹ Volver" y el titulo. */
export default function Encabezado({ titulo, volverA, derecha }: { titulo: string; volverA: string; derecha?: ReactNode }) {
  const volver = useVolver(volverA);
  return (
    <header className="space-y-1">
      <button
        type="button"
        onClick={volver}
        aria-label="Volver"
        className="-ml-2 min-h-[44px] px-2 flex items-center gap-1 text-arca font-semibold rounded-xl active:bg-arca-claro"
      >
        <span aria-hidden className="text-2xl leading-none">‹</span> Volver
      </button>
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-titulo text-2xl font-bold">{titulo}</h1>
        {derecha}
      </div>
    </header>
  );
}

/** Boton principal fijo abajo (encima de la barra de navegacion). Deja un espacio al final para no tapar el contenido. */
export function AccionFija({ children }: { children: ReactNode }) {
  return (
    <>
      <div aria-hidden className="h-24" />
      <div className="fixed inset-x-0 z-30 flex justify-center px-4 pb-5 pt-6 bg-gradient-to-t from-stone-50 via-stone-50 to-transparent pointer-events-none" style={{ bottom: "calc(72px + env(safe-area-inset-bottom))" }}>
        <div className="w-full max-w-[480px] pointer-events-auto">{children}</div>
      </div>
    </>
  );
}
