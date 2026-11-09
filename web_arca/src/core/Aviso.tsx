import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

// Avisos breves ("Guardado", "Anulado. Reactivar") en la parte superior.
// Informativos (ok / info): region role="status" (se anuncian con calma) y se van solos a los 3,5 s (8 s con boton de accion).
// Errores: role="alert" (se anuncian de inmediato), duran 10 s y se pueden cerrar con el boton "Cerrar aviso".
export interface AccionAviso {
  texto: string;
  alAccionar: () => void;
}
type Aviso = { id: number; texto: string; tipo: "ok" | "info" | "error"; accion?: AccionAviso };
type Mostrar = (texto: string, tipo?: Aviso["tipo"], accion?: AccionAviso) => void;
const Ctx = createContext<Mostrar>(() => {});

export const useAviso = () => useContext(Ctx);

const DURACION_ERROR = 10000;

export function AvisoProvider({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const quitar = (id: number) => setAvisos((a) => a.filter((x) => x.id !== id));
  const mostrar = useCallback<Mostrar>((texto, tipo = "ok", accion) => {
    const id = Date.now() + Math.random();
    setAvisos([{ id, texto, tipo, accion }]); // solo se muestra el aviso mas reciente
    setTimeout(() => quitar(id), tipo === "error" ? DURACION_ERROR : accion ? 8000 : 3500); // un error se lee con calma
  }, []);
  const color = { ok: "bg-arca", info: "bg-stone-800", error: "bg-red-700" };
  const caja = "fixed top-2 inset-x-0 z-[60] flex flex-col items-center gap-2 px-4 pointer-events-none";

  const toast = (a: Aviso) => (
    <div
      key={a.id}
      role={a.tipo === "error" ? "alert" : undefined}
      className={`${color[a.tipo]} text-white text-sm font-medium pl-4 pr-2 py-1 rounded-xl shadow-lg flex items-center gap-2 pointer-events-auto`}
    >
      <span className="py-1">{a.texto}</span>
      {a.accion && (
        <button
          className="min-h-[44px] px-3 font-bold underline"
          onClick={() => {
            quitar(a.id);
            a.accion!.alAccionar();
          }}
        >
          {a.accion.texto}
        </button>
      )}
      {a.tipo === "error" && (
        <button type="button" aria-label="Cerrar aviso" onClick={() => quitar(a.id)} className="min-h-[44px] min-w-[44px] text-lg">
          ✕
        </button>
      )}
    </div>
  );

  const errores = avisos.filter((a) => a.tipo === "error");
  return (
    <Ctx.Provider value={mostrar}>
      {children}
      <div className={caja} role="status">
        {avisos.filter((a) => a.tipo !== "error").map(toast)}
      </div>
      {/* los errores van aparte y solo existen mientras hay uno: un role="alert" que aparece se anuncia de inmediato */}
      {errores.length > 0 && <div className={caja}>{errores.map(toast)}</div>}
    </Ctx.Provider>
  );
}
