// Dictado de movimientos: ÚNICA parte que toca la API de reconocimiento de voz del navegador (SpeechRecognition o
// webkitSpeechRecognition). El audio lo procesa el servicio de voz del navegador, que es un servicio EXTERNO a Arca:
// Arca no lo recibe ni lo guarda. Aquí la transcripción vive solo en variables locales y en el estado de este hook y se
// descarta al terminar: no se escribe en ningún almacén del navegador (ni el local, ni el de sesión, ni la base IndexedDB, ni la caché) ni en el historial, y no hay red propia ni registros en consola.
import { useCallback, useEffect, useRef, useState } from "react";

// Tipos mínimos: TypeScript no trae los de SpeechRecognition.
interface AlternativaVoz {
  transcript: string;
}
interface ResultadoVoz {
  isFinal: boolean;
  length: number;
  [i: number]: AlternativaVoz;
}
interface EventoResultadoVoz {
  results: { length: number; [i: number]: ResultadoVoz };
}
export interface Reconocedor {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: EventoResultadoVoz) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type ConstructorVoz = new () => Reconocedor;

/** El constructor que ofrece el navegador, o null si no ofrece reconocimiento de voz (p. ej. Firefox). */
export function constructorDeVoz(): ConstructorVoz | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: ConstructorVoz; webkitSpeechRecognition?: ConstructorVoz };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Primero español de Bolivia; si el navegador no lo conoce, español latinoamericano. */
export const IDIOMAS_DICTADO = ["es-BO", "es-419"] as const;

export type SoporteVoz = "disponible" | "sin_soporte" | "sin_conexion";

export const EXPLICACION_SIN_SOPORTE = "Tu navegador no permite dictar. Prueba con Chrome o Edge.";
export const EXPLICACION_SIN_CONEXION = "Necesitas conexión a internet para dictar.";

const MENSAJES_ERROR: Record<string, string> = {
  "not-allowed": "No tengo permiso para usar el micrófono. Actívalo en los permisos del sitio de tu navegador.",
  "service-not-allowed": "No tengo permiso para usar el micrófono. Actívalo en los permisos del sitio de tu navegador.",
  "audio-capture": "No encontré un micrófono para dictar.",
  network: "El servicio de voz de tu navegador no responde. Revisa tu conexión.",
  "no-speech": "No te escuché. Inténtalo otra vez.",
  "language-not-supported": "Tu navegador no sabe dictar en español.",
};
const MENSAJE_GENERICO = "No pude dictar. Inténtalo otra vez.";

export interface Dictado {
  soporte: SoporteVoz;
  escuchando: boolean;
  /** Lo que va entendiendo mientras hablas (solo en pantalla; se borra al terminar). */
  parcial: string;
  error: string | null;
  iniciar: () => void;
  /** Termina de escuchar y entrega lo que alcanzó a entender. */
  detener: () => void;
}

/** `alTerminar` recibe las alternativas del reconocedor (la primera es la más probable) y luego se olvidan. */
export function useDictado(alTerminar: (alternativas: string[]) => void): Dictado {
  const [enLinea, setEnLinea] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [escuchando, setEscuchando] = useState(false);
  const [parcial, setParcial] = useState("");
  const [error, setError] = useState<string | null>(null);
  const activo = useRef<Reconocedor | null>(null);
  const vivo = useRef(true);
  const callback = useRef(alTerminar);
  callback.current = alTerminar;

  useEffect(() => {
    const f = () => setEnLinea(navigator.onLine);
    window.addEventListener("online", f);
    window.addEventListener("offline", f);
    return () => {
      window.removeEventListener("online", f);
      window.removeEventListener("offline", f);
    };
  }, []);

  const soltar = useCallback(() => {
    const r = activo.current;
    activo.current = null;
    if (!r) return;
    r.onresult = null;
    r.onerror = null;
    r.onend = null;
    try {
      r.abort();
    } catch {
      /* ya estaba detenido */
    }
  }, []);

  // al salir de la pantalla o al perder la conexión, se corta sin entregar nada
  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
      soltar();
    };
  }, [soltar]);
  useEffect(() => {
    if (!enLinea && activo.current) {
      soltar();
      setEscuchando(false);
      setParcial("");
    }
  }, [enLinea, soltar]);

  const iniciar = useCallback(() => {
    const Ctor = constructorDeVoz();
    if (!Ctor || activo.current) return;
    setError(null);
    setParcial("");
    let intento = 0;
    let final: string[] | null = null;
    let fallo = false;
    let cambiarIdioma = false;

    const crear = (): Reconocedor => {
      const r = new Ctor();
      r.lang = IDIOMAS_DICTADO[intento];
      r.continuous = false;
      r.interimResults = true;
      r.maxAlternatives = 3;
      r.onresult = (e) => {
        const res = e.results[e.results.length - 1];
        if (!res) return;
        if (res.isFinal) {
          final = [];
          for (let k = 0; k < res.length; k++) final.push(res[k].transcript);
        } else if (vivo.current) setParcial(res[0]?.transcript ?? "");
      };
      r.onerror = (e) => {
        if (e.error === "aborted") return;
        if (e.error === "language-not-supported" && intento < IDIOMAS_DICTADO.length - 1) {
          cambiarIdioma = true;
          return;
        }
        fallo = true;
        if (vivo.current) setError(MENSAJES_ERROR[e.error] ?? MENSAJE_GENERICO);
      };
      r.onend = () => {
        if (cambiarIdioma) {
          cambiarIdioma = false;
          intento++;
          const siguiente = crear();
          activo.current = siguiente;
          try {
            siguiente.start();
          } catch {
            activo.current = null;
            if (vivo.current) {
              setEscuchando(false);
              setError(MENSAJE_GENERICO);
            }
          }
          return;
        }
        activo.current = null;
        const entendido = final;
        final = null; // la transcripción no se conserva
        if (!vivo.current) return;
        setEscuchando(false);
        setParcial("");
        if (entendido && entendido.length > 0) callback.current(entendido);
        else if (!fallo) setError(MENSAJES_ERROR["no-speech"]);
      };
      return r;
    };

    const r = crear();
    activo.current = r;
    try {
      r.start();
      setEscuchando(true);
    } catch {
      activo.current = null;
      setError(MENSAJE_GENERICO);
    }
  }, []);

  const detener = useCallback(() => {
    try {
      activo.current?.stop(); // entrega lo entendido y llama a onend
    } catch {
      /* ya estaba detenido */
    }
  }, []);

  const soporte: SoporteVoz = constructorDeVoz() === null ? "sin_soporte" : !enLinea ? "sin_conexion" : "disponible";
  return { soporte, escuchando, parcial, error, iniciar, detener };
}
