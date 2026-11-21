import { useEffect, useState } from "react";
import { useDialogo } from "../../core/useDialogo";
import { listarFuentes, type CuentaFuente } from "../cuentas/api";
import { descripcionCuenta } from "../cuentas/componentes";
import { leerUltimaFuente } from "../cuentas/recordar";
import { enLinea, type FuenteElegida } from "./fuente";

/**
 * Hoja que sube desde abajo sobre la pantalla actual al tocar "+" (o el chip "Pagado con"): "Efectivo" o "Banco". Banco se
 * despliega ahí mismo con las cuentas en Bs que ves, cada una con su marca: "Se registra directo" (eres dueño o encargado)
 * o "Requiere confirmación de <dueño>". Sin conexión, Banco queda deshabilitado (solo Efectivo).
 */
export default function HojaFuente({
  alElegir,
  alCerrar,
  actual,
}: {
  alElegir: (f: FuenteElegida | null) => void;
  alCerrar: () => void;
  /** Fuente ya elegida (al cambiarla desde el chip): "efectivo" o el id de la cuenta. */
  actual?: "efectivo" | number | null;
}) {
  const ref = useDialogo<HTMLDivElement>({ alCerrar });
  const conexion = enLinea();
  const ultima = actual ?? leerUltimaFuente();
  const [abierto, setAbierto] = useState(conexion && typeof ultima === "number");
  const [cuentas, setCuentas] = useState<CuentaFuente[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!abierto || cuentas) return;
    let vivo = true;
    listarFuentes()
      .then((c) => vivo && setCuentas(c))
      .catch((e: Error) => vivo && setError(e.message));
    return () => {
      vivo = false;
    };
  }, [abierto, cuentas]);

  const opcion = "w-full min-h-[60px] flex items-center gap-3 rounded-2xl border-2 px-4 text-left font-semibold";
  return (
    <div ref={ref} className="fixed inset-0 !m-0 z-[55] bg-black/40 flex items-end justify-center">
      <button type="button" aria-label="Cerrar" tabIndex={-1} className="absolute inset-0 cursor-default" onClick={alCerrar} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="¿Efectivo o Banco?"
        data-testid="hoja-fuente"
        className="relative w-full max-w-[480px] bg-white rounded-t-3xl p-5 pb-[calc(env(safe-area-inset-bottom)+2rem)] max-h-[80vh] overflow-y-auto space-y-3"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-titulo text-xl font-bold">¿Efectivo o Banco?</h2>
          <button type="button" aria-label="Cerrar hoja" onClick={alCerrar} className="min-h-[44px] min-w-[44px] text-xl text-stone-500">✕</button>
        </div>

        <button
          type="button"
          data-autofoco=""
          onClick={() => alElegir(null)}
          className={`${opcion} ${ultima === "efectivo" ? "border-arca bg-arca-claro" : "border-stone-200 bg-white active:bg-stone-100"}`}
        >
          <span aria-hidden className="text-2xl">💵</span>
          <span className="flex-1">Efectivo</span>
          {ultima === "efectivo" && <span className="text-xs font-semibold text-arca">{actual ? "Actual" : "Última usada"}</span>}
        </button>

        <button
          type="button"
          aria-expanded={abierto}
          disabled={!conexion}
          onClick={() => setAbierto((a) => !a)}
          className={`${opcion} ${abierto ? "border-arca" : "border-stone-200"} bg-white disabled:opacity-60 active:bg-stone-100`}
        >
          <span aria-hidden className="text-2xl">🏦</span>
          <span className="flex-1">
            Banco
            {!conexion && <span className="block text-xs font-medium text-stone-600">Sin conexión: solo efectivo</span>}
          </span>
          {conexion && <span aria-hidden className="text-stone-500">{abierto ? "▲" : "▼"}</span>}
        </button>

        {abierto && (
          <div className="space-y-2 pl-2" role="group" aria-label="Cuentas de banco">
            {!cuentas && !error && <p className="text-sm text-stone-600 px-2">Cargando cuentas...</p>}
            {error && <p role="alert" className="text-sm text-red-700 px-2">{error}</p>}
            {cuentas && cuentas.length === 0 && (
              <p className="text-sm text-stone-600 px-2">No hay cuentas de banco en Bs que puedas usar. Créalas en Familia › Cuentas.</p>
            )}
            {cuentas?.map((c) => {
              const elegida = ultima === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  data-testid="opcion-cuenta"
                  onClick={() => alElegir({ id: c.id, nombre: c.nombre, directo: c.directo, confirma_nombre: c.confirma_nombre })}
                  className={`w-full min-h-[60px] rounded-2xl border-2 px-4 py-2 text-left ${elegida ? "border-arca bg-arca-claro" : "border-stone-200 bg-white active:bg-stone-100"}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-semibold break-words">{c.nombre}</span>
                    {elegida && <span className="text-xs font-semibold text-arca shrink-0">{actual ? "Actual" : "Última usada"}</span>}
                  </span>
                  <span className="block text-xs text-stone-600 break-words">{descripcionCuenta(c)}</span>
                  <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${c.directo ? "bg-arca-claro text-arca" : "bg-apoyo-claro text-apoyo-texto"}`}>
                    {c.directo ? "Se registra directo" : `Requiere confirmación de ${c.confirma_nombre ?? "su dueño"}`}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
