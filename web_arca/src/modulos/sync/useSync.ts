import { useCallback, useEffect, useState } from "react";
import { alCambiarCola, estaSincronizando, listarOperaciones, listarRechazos } from "./cola";
import type { Operacion, Rechazo } from "./tipos";

export interface EstadoSync {
  operaciones: Operacion[];
  rechazos: Rechazo[];
  sincronizando: boolean;
  enLinea: boolean;
}

const VACIO: EstadoSync = { operaciones: [], rechazos: [], sincronizando: false, enLinea: true };

/** Estado de la cola de operaciones: pendientes, en conflicto, rechazadas y si se esta enviando. */
export function useSync(): EstadoSync {
  const [estado, setEstado] = useState<EstadoSync>({ ...VACIO, enLinea: typeof navigator === "undefined" ? true : navigator.onLine });

  const recargar = useCallback(async () => {
    const [operaciones, rechazos] = await Promise.all([listarOperaciones(), listarRechazos()]);
    setEstado({ operaciones, rechazos, sincronizando: estaSincronizando(), enLinea: navigator.onLine });
  }, []);

  useEffect(() => {
    let vivo = true;
    const f = () => {
      if (vivo) void recargar();
    };
    f();
    const quitar = alCambiarCola(f);
    window.addEventListener("online", f);
    window.addEventListener("offline", f);
    return () => {
      vivo = false;
      quitar();
      window.removeEventListener("online", f);
      window.removeEventListener("offline", f);
    };
  }, [recargar]);

  return estado;
}

/** Cuantas operaciones esperan en la cola (incluye las que estan en conflicto). */
export function useEnCola(): number {
  return useSync().operaciones.length;
}
