// Lo último que usaste al registrar un movimiento (para no repetirlo). Solo IDS y el tipo de persona: nunca nombres de
// "otra persona", montos ni saldos. Se borra al cerrar sesión.
import type { PersonaTipo } from "./api";

const CLAVE = "arca-cuentas-ultimo";

export interface Ultimo {
  cuenta_id?: number;
  persona_tipo?: PersonaTipo;
  persona_usuario_id?: number; // solo si la persona era un miembro de la familia
}

export function leerUltimo(): Ultimo {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE) ?? "null") as Ultimo | null;
    if (!v || typeof v !== "object") return {};
    return {
      cuenta_id: typeof v.cuenta_id === "number" ? v.cuenta_id : undefined,
      persona_tipo: v.persona_tipo === "miembro" || v.persona_tipo === "otra" || v.persona_tipo === "sin_identificar" ? v.persona_tipo : undefined,
      persona_usuario_id: typeof v.persona_usuario_id === "number" ? v.persona_usuario_id : undefined,
    };
  } catch {
    return {};
  }
}

export function guardarUltimo(u: Ultimo): void {
  try {
    const limpio: Ultimo = { cuenta_id: u.cuenta_id, persona_tipo: u.persona_tipo };
    if (u.persona_tipo === "miembro") limpio.persona_usuario_id = u.persona_usuario_id;
    localStorage.setItem(CLAVE, JSON.stringify(limpio));
  } catch {
    /* sin almacenamiento: simplemente no se recuerda */
  }
}

export function olvidarUltimo(): void {
  try {
    localStorage.removeItem(CLAVE);
  } catch {
    /* nada que borrar */
  }
}
