// Arranque en frio del servidor (plan gratuito: se duerme y puede tardar hasta ~1 minuto en despertar).
//  - Mientras no haya confirmado que esta despierto, la primera peticion espera hasta 90 s (despues, 30 s).
//  - Si una peticion tarda mas de 5 s se avisa "Despertando el servidor...".
//  - Un servidor que lleva rato sin responder se vuelve a considerar dormido (Render lo duerme a los ~15 min).

export const UMBRAL_DESPERTANDO_MS = 5_000;
export const ESPERA_PRIMERA_PETICION_MS = 90_000;
export const ESPERA_NORMAL_MS = 30_000;
/** Pasado este tiempo sin ninguna respuesta se vuelve a esperar 90 s (el servidor pudo dormirse). */
export const OLVIDO_DESPIERTO_MS = 10 * 60_000;

/** Tiempos en uso (las pruebas los acortan para no esperar 90 s de verdad). */
export const tiempos = { primera: ESPERA_PRIMERA_PETICION_MS, normal: ESPERA_NORMAL_MS, umbral: UMBRAL_DESPERTANDO_MS };

export const EVENTO_SERVIDOR = "arca-servidor-cambio";

let ultimaRespuesta: number | null = null; // cuando respondio el servidor por ultima vez (ms)
let lentas = 0; // peticiones en curso que ya pasaron el umbral de 5 s

const avisar = () => window.dispatchEvent(new Event(EVENTO_SERVIDOR));

/** Cuanto esperar a la respuesta de una peticion que empieza ahora. */
export function esperaMaxima(ahora = Date.now()): number {
  const despierto = ultimaRespuesta !== null && ahora - ultimaRespuesta < OLVIDO_DESPIERTO_MS;
  return despierto ? tiempos.normal : tiempos.primera;
}

export interface Seguimiento {
  /** El servidor contesto (aunque sea con un error HTTP): esta despierto. */
  respondio: () => void;
  /** Termino sin respuesta (sin red o sin tiempo): ya no cuenta como "despertando". */
  fallo: () => void;
}

/** Marca el inicio de una peticion; si pasa del umbral se enciende el aviso "Despertando el servidor...". */
export function seguirPeticion(): Seguimiento {
  let esLenta = false;
  let cerrada = false;
  const t = setTimeout(() => {
    if (cerrada) return;
    esLenta = true;
    lentas++;
    avisar();
  }, tiempos.umbral);
  const cerrar = () => {
    if (cerrada) return;
    cerrada = true;
    clearTimeout(t);
    if (esLenta) {
      lentas--;
      avisar();
    }
  };
  return {
    respondio: () => {
      ultimaRespuesta = Date.now();
      cerrar();
    },
    fallo: cerrar,
  };
}

export const servidorDespertando = () => lentas > 0;
export const alCambiarServidor = (f: () => void) => {
  window.addEventListener(EVENTO_SERVIDOR, f);
  return () => window.removeEventListener(EVENTO_SERVIDOR, f);
};

/** Solo para pruebas. */
export function reiniciarServidor() {
  tiempos.primera = ESPERA_PRIMERA_PETICION_MS;
  tiempos.normal = ESPERA_NORMAL_MS;
  tiempos.umbral = UMBRAL_DESPERTANDO_MS;
  ultimaRespuesta = null;
  lentas = 0;
}
