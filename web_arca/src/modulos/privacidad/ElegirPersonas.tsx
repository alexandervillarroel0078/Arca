import { useState } from "react";
import { Boton, Cargando, ErrorCaja, Vacio, useCarga } from "../../core/ui";
import { useDialogo } from "../../core/useDialogo";
import { listarMiembros } from "../familia/api";
import { useUsuarioOpcional } from "../auth/AuthContext";

/** Pantalla para elegir con quien compartir: los miembros ACTIVOS de la familia (menos tu). */
export default function ElegirPersonas({
  elegidas,
  alListo,
  alCancelar,
}: {
  elegidas: number[];
  alListo: (ids: number[]) => void;
  alCancelar: () => void;
}) {
  // Escape cierra (= Volver), el foco entra al abrir y vuelve a quien abrio, Tab no sale de la pantalla.
  const ref = useDialogo<HTMLDivElement>({ alCerrar: alCancelar });
  const usuario = useUsuarioOpcional();
  const { datos, error, cargando } = useCarga(() => listarMiembros(), []);
  const [sel, setSel] = useState<number[]>(elegidas);
  const posibles = (datos ?? []).filter((m) => m.activo && m.usuario_id !== usuario?.id);
  const alternar = (id: number) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Elegir personas" className="fixed inset-0 !m-0 z-[60] bg-stone-50 overflow-y-auto">
      <div className="max-w-[480px] mx-auto px-4 pt-4 pb-32 space-y-4">
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Volver" onClick={alCancelar} className="min-h-[44px] min-w-[44px] text-2xl text-arca">‹</button>
          <h1 className="font-titulo text-2xl font-bold">¿Con quién lo compartes?</h1>
        </div>
        <p className="text-sm text-stone-600">Solo ellas podrán verlo, sin poder cambiarlo. Nadie más, tampoco el administrador.</p>
        {cargando && !datos && <Cargando />}
        <ErrorCaja mensaje={error} />
        {datos && posibles.length === 0 && <Vacio icono="👥" texto="No hay otras personas activas en tu familia para compartir." />}
        <ul className="space-y-2" aria-label="Personas">
          {posibles.map((m) => {
            const activa = sel.includes(m.usuario_id);
            return (
              <li key={m.usuario_id}>
                <label
                  className={`flex items-center gap-3 min-h-[56px] px-4 rounded-tarjeta border-2 cursor-pointer ${activa ? "border-arca bg-arca-claro" : "border-stone-200 bg-white"}`}
                >
                  <input
                    type="checkbox"
                    className="w-6 h-6 accent-[#0E6B58]"
                    checked={activa}
                    onChange={() => alternar(m.usuario_id)}
                    aria-label={m.nombre}
                  />
                  <span className="font-medium break-words min-w-0">{m.nombre}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="fixed bottom-0 inset-x-0 bg-white/95 border-t border-stone-200 p-4">
        <div className="max-w-[480px] mx-auto">
          <Boton className="w-full min-h-[56px] text-lg" disabled={sel.length === 0} onClick={() => alListo(sel)}>
            {sel.length === 0 ? "Elige al menos una persona" : `Listo (${sel.length})`}
          </Boton>
        </div>
      </div>
    </div>
  );
}
