import { useCallback, useEffect } from "react";
import { useAviso } from "../../core/Aviso";
import { listarOperaciones, sincronizar } from "./cola";
import type { ResultadoPasada } from "./tipos";
import { reconciliarVisibles } from "./visibles";

/** Cada cuanto se reintenta enviar la cola mientras haya cambios pendientes. */
export const INTERVALO_REINTENTO_MS = 30_000;

/** Avisos del resultado de un envio. `manual` = el usuario toco "Sincronizar ahora" (tambien se avisa si no habia nada que decir). */
export function useAvisarResultado() {
  const avisar = useAviso();
  return useCallback(
    (r: ResultadoPasada, manual = false) => {
      if (r.enviados > 0) avisar(`Se sincronizaron ${r.enviados} registro${r.enviados === 1 ? "" : "s"}`);
      if (r.rechazados > 0) avisar(`${r.rechazados} registro(s) fueron rechazados por el servidor`, "error");
      if (r.conflictos > 0) avisar(`${r.conflictos} cambio(s) en conflicto: elige cuál conservar`, "error");
      if (manual && r.sinConexion) avisar("Sin conexión: no se pudo enviar. Se reintentará solo.", "info");
      if (manual && r.sesionVencida) avisar("Tu sesión venció: entra de nuevo para enviar los cambios", "error");
    },
    [avisar],
  );
}

/** Sin interfaz: intenta sincronizar al abrir la app, al volver la conexion y cada 30 s si hay cambios pendientes. */
export default function Sincronizador() {
  const avisarResultado = useAvisarResultado();

  useEffect(() => {
    let vivo = true;
    // Fase 17: olvidar lo que dejo de ser visible (sin avisar de nada: si falla, se reintenta en el siguiente ciclo)
    async function reconciliar() {
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      try {
        await reconciliarVisibles();
      } catch {
        /* sin conexion o servidor ocupado */
      }
    }
    async function intentar() {
      // las operaciones en conflicto esperan la decision del usuario: no hay nada que reintentar con ellas
      const hay = (await listarOperaciones()).some((o) => o.estado === "pendiente");
      if (hay && vivo) avisarResultado(await sincronizar());
      if (vivo) await reconciliar();
    }
    void intentar();
    const alVolver = () => void intentar();
    const alVerse = () => {
      if (document.visibilityState === "visible") void intentar();
    };
    window.addEventListener("online", alVolver);
    document.addEventListener("visibilitychange", alVerse);
    const t = setInterval(() => void intentar(), INTERVALO_REINTENTO_MS);
    return () => {
      vivo = false;
      window.removeEventListener("online", alVolver);
      document.removeEventListener("visibilitychange", alVerse);
      clearInterval(t);
    };
  }, [avisarResultado]);

  return null;
}
