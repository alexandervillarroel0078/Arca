// Cliente HTTP del backend. Guarda el token en localStorage.
import { esperaMaxima, seguirPeticion } from "./servidor";

/** Falta VITE_API_URL en una app compilada: no se intenta adivinar ninguna URL. */
export class ErrorConfiguracion extends Error {}

/** URL del backend: SIEMPRE de VITE_API_URL. Solo en desarrollo (npm run dev) se usa el puerto 8000 del mismo equipo. */
export function urlApi(): string {
  const v = (import.meta.env.VITE_API_URL as string | undefined)?.trim().replace(/\/$/, "");
  if (v) return v;
  if (import.meta.env.DEV) return `http://${window.location.hostname}:8000`;
  throw new ErrorConfiguracion("Falta configurar VITE_API_URL (la dirección del servidor) al compilar la app");
}

export function apiConfigurada(): boolean {
  try {
    urlApi();
    return true;
  } catch {
    return false;
  }
}

const CLAVE_TOKEN = "arca-token";

export const token = {
  leer: () => localStorage.getItem(CLAVE_TOKEN),
  guardar: (t: string) => localStorage.setItem(CLAVE_TOKEN, t),
  borrar: () => localStorage.removeItem(CLAVE_TOKEN),
};

/** Error de red (sin internet o servidor caido). Sirve para decidir si se guarda en la cola offline. */
export class ErrorRed extends Error {
  constructor(mensaje = "Sin conexión con el servidor") {
    super(mensaje);
  }
}

/** El servidor no contesto a tiempo (p. ej. se esta despertando). Es un error de RED: la cola offline lo reintenta, no es un rechazo. */
export class ErrorTiempo extends ErrorRed {
  constructor() {
    super("El servidor tarda demasiado en responder. Intenta de nuevo en un momento");
  }
}

export class ErrorApi extends Error {
  /** `detalle` es el `detail` crudo del servidor (en un 409 trae la version actual del registro). */
  constructor(public estado: number, mensaje: string, public detalle?: unknown) {
    super(mensaje);
  }
}

function mensajeDe(datos: unknown, estado: number): string {
  const d = (datos as { detail?: unknown } | null)?.detail;
  if (typeof d === "string") return d;
  if (d && typeof d === "object" && !Array.isArray(d) && typeof (d as { mensaje?: unknown }).mensaje === "string")
    return (d as { mensaje: string }).mensaje;
  if (Array.isArray(d) && d.length) {
    const primero = d[0] as { loc?: unknown[]; msg?: string };
    const campo = primero.loc?.[primero.loc.length - 1];
    return `Dato inválido${campo ? ` (${String(campo)})` : ""}`;
  }
  if (estado === 429) return "Demasiados intentos. Espera unos minutos";
  return estado >= 500 ? "Error del servidor" : "No se pudo completar la acción";
}

export async function api<T>(
  ruta: string,
  opciones: { metodo?: string; cuerpo?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const base = urlApi();
  const headers: Record<string, string> = { ...opciones.headers };
  const t = token.leer();
  if (t) headers.Authorization = `Bearer ${t}`;
  if (opciones.cuerpo !== undefined) headers["Content-Type"] = "application/json";

  // Arranque en frio: la primera peticion espera hasta 90 s; si pasa de 5 s se muestra "Despertando el servidor..."
  const seguimiento = seguirPeticion();
  const control = new AbortController();
  let sinTiempo = false;
  const reloj = setTimeout(() => {
    sinTiempo = true;
    control.abort();
  }, esperaMaxima());

  let resp: Response;
  let datos: unknown = null;
  try {
    resp = await fetch(`${base}/api${ruta}`, {
      method: opciones.metodo ?? (opciones.cuerpo !== undefined ? "POST" : "GET"),
      headers,
      body: opciones.cuerpo !== undefined ? JSON.stringify(opciones.cuerpo) : undefined,
      signal: control.signal,
    });
    seguimiento.respondio();
    if (resp.status !== 204) datos = await resp.json().catch(() => null);
  } catch {
    seguimiento.fallo();
    throw sinTiempo ? new ErrorTiempo() : new ErrorRed();
  } finally {
    clearTimeout(reloj);
  }

  if (resp.status === 204) return undefined as T;
  if (!resp.ok) {
    if (resp.status === 401 && t) window.dispatchEvent(new Event("arca-sesion-expirada"));
    throw new ErrorApi(resp.status, mensajeDe(datos, resp.status), (datos as { detail?: unknown } | null)?.detail);
  }
  return datos as T;
}
