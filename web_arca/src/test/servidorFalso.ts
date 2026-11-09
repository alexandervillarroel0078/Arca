import { vi } from "vitest";

export interface Llamada {
  metodo: string;
  ruta: string;
  cuerpo: any;
  cabeceras: Record<string, string>;
}
export type Respuesta = { estado: number; cuerpo: unknown } | "red";

/** Reemplaza `fetch` por un servidor falso: cada prueba decide que responde. */
export function instalarServidorFalso() {
  const sv = {
    llamadas: [] as Llamada[],
    /** Consultas de "que sigue siendo visible" (Fase 17): van aparte para no contar como operaciones de la cola. */
    visibles: [] as Llamada[],
    responder: (_l: Llamada): Respuesta => ({ estado: 200, cuerpo: {} }),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const l: Llamada = {
        metodo: init.method ?? "GET",
        ruta: String(url).replace(/^.*\/api/, ""),
        cuerpo: init.body ? JSON.parse(String(init.body)) : undefined,
        cabeceras: (init.headers ?? {}) as Record<string, string>,
      };
      (l.ruta.startsWith("/sincronizacion/visibles") ? sv.visibles : sv.llamadas).push(l);
      const r = sv.responder(l);
      if (r === "red") throw new TypeError("Failed to fetch");
      return { ok: r.estado < 400, status: r.estado, json: async () => r.cuerpo } as Response;
    }),
  );
  return sv;
}

export const movServidor = (id: number, c: Record<string, unknown> = {}) => ({
  id, tipo: "gasto", monto: 10, fecha: "2026-11-07", categoria_id: 2, categoria_nombre: "Comida", categoria_icono: "utensils", nota: null,
  usuario_id: 1, usuario_nombre: "Ana", version: 1, uuid_cliente: null, anulado: false, anulado_por_nombre: null, anulado_en: null,
  motivo_anulacion: null, editado_por_nombre: null, editado_en: null, ...c,
});

export const conflictoServidor = (actual: unknown, version_actual = 2) => ({
  estado: 409,
  cuerpo: { detail: { codigo: "conflicto_version", mensaje: "El movimiento cambio en el servidor mientras tanto", version_actual, version_base: 1, actual } },
});
