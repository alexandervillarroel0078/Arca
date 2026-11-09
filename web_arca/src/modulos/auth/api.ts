import { api } from "../../core/api";

export interface Yo {
  id: number;
  nombre: string;
  email: string;
  familia_id: number;
  familia_nombre: string;
  rol: "admin" | "miembro";
  visibilidad_defecto?: "solo_yo" | "familia"; // Fase 17: lo que heredan tus registros nuevos
  dia_inicio_mes?: number; // desde que dia empieza el "mes" de los periodos (1 = mes calendario)
}
export interface RespuestaToken {
  access_token: string;
  usuario: Yo;
}

export const login = (email: string, password: string) =>
  api<RespuestaToken>("/auth/login", { cuerpo: { email, password } });

export const registro = (nombre: string, email: string, password: string, nombre_familia: string) =>
  api<RespuestaToken>("/auth/registro", {
    cuerpo: { nombre, email, password, nombre_familia: nombre_familia || null },
  });

export const yo = () => api<Yo>("/auth/yo");

export const cambiarNombre = (nombre: string) => api<Yo>("/auth/yo", { metodo: "PATCH", cuerpo: { nombre } });
export const cambiarClave = (clave_actual: string, clave_nueva: string) =>
  api<void>("/auth/cambiar-clave", { cuerpo: { clave_actual, clave_nueva } });

/** Deja constancia en la bitacora de que se cerro la sesion (el token vence solo). Se llama sin esperar y sin fallar. */
export const logout = () => api<void>("/auth/logout", { metodo: "POST" });
