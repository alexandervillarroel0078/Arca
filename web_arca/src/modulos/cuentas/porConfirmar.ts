// Contador "Por confirmar" del menú y avisos de pagos rechazados. Vive SOLO en memoria (Cuentas no guarda nada en el
// aparato): se lee al abrir la app, al volver a ella y después de confirmar, rechazar o registrar. Sin push.
import { useSyncExternalStore } from "react";
import { resumenPorConfirmar, type ResumenPorConfirmar } from "./api";

const VACIO: ResumenPorConfirmar = { cantidad: 0, rechazos: [] };
let actual: ResumenPorConfirmar = VACIO;
const oyentes = new Set<() => void>();

function avisar() {
  for (const f of oyentes) f();
}

/** Vuelve a leer el resumen del servidor (sin conexión o con error se queda con lo que había). */
export async function refrescarPorConfirmar(): Promise<void> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  try {
    actual = await resumenPorConfirmar();
    avisar();
  } catch {
    /* sin servidor: el contador queda como estaba */
  }
}

/** Al cerrar sesión: nada de la sesión anterior queda en memoria. */
export function olvidarPorConfirmar(): void {
  actual = VACIO;
  avisar();
}

export function usePorConfirmar(): ResumenPorConfirmar {
  return useSyncExternalStore(
    (f) => {
      oyentes.add(f);
      return () => oyentes.delete(f);
    },
    () => actual,
    () => actual,
  );
}
