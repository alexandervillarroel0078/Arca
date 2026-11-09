// Aviso de "version nueva" de la app (service worker). Sin esto los usuarios quedan pegados a la version vieja:
// el service worker nuevo se descarga en segundo plano y espera; el usuario decide cuando recargar (no se pierde nada:
// la cola sin enviar vive en IndexedDB).

export const EVENTO_ACTUALIZACION = "arca-actualizacion-cambio";

/** Cada cuanto se pregunta al servidor si hay una version nueva mientras la app esta abierta. */
export const INTERVALO_BUSCAR_VERSION_MS = 60 * 60_000;
/** Al volver a la app (pestana visible) se busca de nuevo, pero no mas seguido que esto. */
export const MINIMO_ENTRE_BUSQUEDAS_MS = 5 * 60_000;

let aplicar: (() => Promise<void> | void) | null = null;

/** La app registra aqui como activar la version nueva (en main.tsx: `updateSW(true)`). */
export function marcarVersionNueva(activar: () => Promise<void> | void) {
  aplicar = activar;
  window.dispatchEvent(new Event(EVENTO_ACTUALIZACION));
}

export const hayVersionNueva = () => aplicar !== null;

/** Activa la version nueva: el service worker nuevo toma el control y la pagina se recarga. */
export async function actualizarAhora() {
  await aplicar?.();
}

export const alCambiarActualizacion = (f: () => void) => {
  window.addEventListener(EVENTO_ACTUALIZACION, f);
  return () => window.removeEventListener(EVENTO_ACTUALIZACION, f);
};

/** Pide al navegador que busque un service worker nuevo: al abrir, cada hora y al volver a la app. */
export function buscarVersionesNuevas(registro: { update: () => Promise<unknown> }) {
  let ultima = Date.now();
  const buscar = () => {
    ultima = Date.now();
    registro.update().catch(() => {}); // sin conexion falla: no pasa nada, se reintenta despues
  };
  const t = setInterval(buscar, INTERVALO_BUSCAR_VERSION_MS);
  const alVolver = () => {
    if (document.visibilityState === "visible" && Date.now() - ultima >= MINIMO_ENTRE_BUSQUEDAS_MS) buscar();
  };
  document.addEventListener("visibilitychange", alVolver);
  window.addEventListener("online", buscar);
  return () => {
    clearInterval(t);
    document.removeEventListener("visibilitychange", alVolver);
    window.removeEventListener("online", buscar);
  };
}

/** Solo para pruebas. */
export function reiniciarActualizacion() {
  aplicar = null;
}
