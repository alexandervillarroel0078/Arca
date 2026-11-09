import { api } from "../../core/api";
import type { Preferencia } from "./visibilidad";

export interface Privacidad {
  visibilidad_defecto: Preferencia;
  /** Tus registros que hoy NO tienen tu preferencia: los que cambiaria "Aplicar a mis registros anteriores". */
  registros_distintos: number;
}

export const obtenerPrivacidad = () => api<Privacidad>("/privacidad");
export const cambiarPreferencia = (visibilidad_defecto: Preferencia) =>
  api<Privacidad>("/privacidad", { metodo: "PATCH", cuerpo: { visibilidad_defecto } });
export const aplicarPreferencia = (cantidad: number) =>
  api<{ afectados: number; visibilidad: Preferencia }>("/privacidad/aplicar-defecto", {
    metodo: "POST",
    cuerpo: { confirmar: true, cantidad },
  });
