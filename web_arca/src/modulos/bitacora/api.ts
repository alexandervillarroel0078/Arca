import { ErrorApi, ErrorRed, api, token, urlApi } from "../../core/api";

export type OrigenBitacora = "acceso" | "datos";
export type ResultadoBitacora = "ok" | "fallo";

export interface EntradaBitacora {
  clave: string; // "acceso-12" | "datos-30"
  origen: OrigenBitacora;
  evento: string;
  etiqueta: string;
  titulo: string;
  resultado: ResultadoBitacora;
  fecha: string; // cuando quedo registrado en el servidor
  fecha_real: string; // cuando ocurrio la accion (sin internet: la del aparato del usuario)
  fecha_sincronizacion: string | null; // solo si se hizo sin internet
  usuario_id: number | null;
  usuario_nombre: string | null;
  correo_intentado: string | null;
  ip: string | null;
  dispositivo: string | null;
  detalle: string[];
  motivo: string | null;
  entidad: string | null;
  entidad_id: number | null;
}

export interface PaginaBitacora {
  items: EntradaBitacora[];
  hay_mas: boolean;
  siguiente: string | null;
}

export interface FiltrosBitacora {
  origen: "" | OrigenBitacora;
  evento: string;
  resultado: "" | ResultadoBitacora;
  persona: string; // id de usuario
  desde: string; // fecha-hora ISO (inicio del dia local) o ""
  hasta: string; // fecha-hora ISO (inicio del dia local siguiente) o ""
}

export const FILTROS_VACIOS: FiltrosBitacora = { origen: "", evento: "", resultado: "", persona: "", desde: "", hasta: "" };

export interface ResumenBitacora {
  ultimos_accesos: {
    usuario_id: number;
    nombre: string;
    rol: string;
    activo: boolean;
    ultimo_login: string | null;
    ip: string | null;
    dispositivo: string | null;
  }[];
  fallos_login_7d: number;
  bloqueos_login_7d: number;
  fallos_por_usuario: { usuario_id: number; nombre: string; fallos: number }[];
  novedades: { usuario_id: number; nombre: string; tipo: "ip" | "dispositivo"; valor: string; primera_vez: string }[];
}

function consulta(f: FiltrosBitacora): URLSearchParams {
  const q = new URLSearchParams();
  if (f.origen) q.set("origen", f.origen);
  if (f.evento) q.set("evento", f.evento);
  if (f.resultado) q.set("resultado", f.resultado);
  if (f.persona) q.set("persona", f.persona);
  if (f.desde) q.set("desde", f.desde);
  if (f.hasta) q.set("hasta", f.hasta);
  return q;
}

/** Una pagina de la bitacora unificada (solo admin). La paginacion es por cursor: sin repetidos ni saltos. */
export function listarBitacora(f: FiltrosBitacora, cursor: string | null, limite = 20) {
  const q = consulta(f);
  q.set("limite", String(limite));
  if (cursor) q.set("cursor", cursor);
  return api<PaginaBitacora>(`/bitacora?${q.toString()}`);
}

export const resumenBitacora = () => api<ResumenBitacora>("/bitacora/resumen");

/** Descarga el CSV con los mismos filtros (hasta 5000 filas). */
export async function exportarCsv(f: FiltrosBitacora): Promise<void> {
  const t = token.leer();
  let resp: Response;
  try {
    resp = await fetch(`${urlApi()}/api/bitacora/exportar.csv?${consulta(f).toString()}`, {
      headers: t ? { Authorization: `Bearer ${t}` } : {},
    });
  } catch {
    throw new ErrorRed();
  }
  if (!resp.ok) {
    if (resp.status === 401 && t) window.dispatchEvent(new Event("arca-sesion-expirada"));
    throw new ErrorApi(resp.status, resp.status === 403 ? "Solo un administrador puede exportar" : "No se pudo exportar");
  }
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "bitacora.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
