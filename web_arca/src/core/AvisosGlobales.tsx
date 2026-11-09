import { useEffect, useState } from "react";
import { actualizarAhora, alCambiarActualizacion, hayVersionNueva } from "./actualizacion";
import { alCambiarServidor, servidorDespertando } from "./servidor";

/** "Despertando el servidor..." cuando una peticion tarda mas de 5 s (arranque en frio del servidor gratuito). */
export function AvisoServidor() {
  const [despertando, setDespertando] = useState(servidorDespertando());
  useEffect(() => alCambiarServidor(() => setDespertando(servidorDespertando())), []);
  if (!despertando) return null;
  return (
    <div role="status" data-testid="aviso-servidor" className="fixed top-0 inset-x-0 z-[70] bg-stone-900 text-white text-sm font-medium text-center px-4 py-2">
      ⏳ Despertando el servidor... puede tardar hasta un minuto la primera vez
    </div>
  );
}

/** "Hay una version nueva, actualizar": el service worker nuevo ya esta descargado; el usuario elige cuando recargar. */
export function AvisoActualizacion() {
  const [hay, setHay] = useState(hayVersionNueva());
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => alCambiarActualizacion(() => setHay(hayVersionNueva())), []);
  if (!hay) return null;
  return (
    <div
      role="alert"
      data-testid="aviso-actualizacion"
      className="fixed bottom-36 inset-x-0 z-[65] flex justify-center px-4 pointer-events-none"
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="pointer-events-auto max-w-[480px] w-full bg-arca text-white rounded-2xl shadow-lg pl-4 pr-2 py-2 flex items-center gap-2">
        <span className="flex-1 text-sm font-medium">Hay una versión nueva, actualizar</span>
        <button
          type="button"
          disabled={ocupado}
          onClick={() => {
            setOcupado(true);
            void actualizarAhora();
          }}
          className="min-h-[44px] px-4 rounded-xl bg-white text-arca font-bold disabled:opacity-60"
        >
          {ocupado ? "Actualizando..." : "Actualizar"}
        </button>
      </div>
    </div>
  );
}

/** Pantalla cuando la app se compilo sin VITE_API_URL: dice exactamente que falta (en vez de fallar en silencio). */
export function ErrorConfiguracionPantalla() {
  return (
    <div role="alert" className="min-h-full flex items-center justify-center px-6 text-center">
      <div className="max-w-sm space-y-2">
        <h1 className="font-titulo text-xl font-bold">Falta configurar la app</h1>
        <p className="text-stone-600 text-sm">
          Esta versión se compiló sin la dirección del servidor (<b>VITE_API_URL</b>). Quien administra la app debe definirla y publicar de nuevo.
        </p>
      </div>
    </div>
  );
}
