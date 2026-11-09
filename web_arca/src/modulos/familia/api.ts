import { api } from "../../core/api";
import { leerPantalla } from "../sync/lecturas";

export interface Categoria {
  id: number;
  nombre: string;
  icono: string;
  activa: boolean;
}
export interface MiembroFamilia {
  usuario_id: number;
  nombre: string;
  email: string;
  rol: "admin" | "miembro";
  activo: boolean;
}

export const listarCategorias = () => leerPantalla("categorias", () => api<Categoria[]>("/categorias"));
export const crearCategoria = (nombre: string, icono: string) =>
  api<Categoria>("/categorias", { cuerpo: { nombre, icono } });
export const editarCategoria = (id: number, cambios: Partial<Pick<Categoria, "nombre" | "icono" | "activa">>) =>
  api<Categoria>(`/categorias/${id}`, { metodo: "PATCH", cuerpo: cambios });

export const listarMiembros = () => leerPantalla("miembros", () => api<MiembroFamilia[]>("/familia/miembros"));
export const invitar = (nombre: string, email: string, password: string, rol: "admin" | "miembro") =>
  api<MiembroFamilia>("/familia/invitar", { cuerpo: { nombre, email, password, rol } });

export const editarMiembro = (usuarioId: number, cambios: Partial<{ rol: "admin" | "miembro"; activo: boolean }>) =>
  api<MiembroFamilia>(`/familia/miembros/${usuarioId}`, { metodo: "PATCH", cuerpo: cambios });
export const restablecerClave = (usuarioId: number) =>
  api<{ clave_temporal: string }>(`/familia/miembros/${usuarioId}/restablecer-clave`, { metodo: "POST", cuerpo: {} });

export interface Familia {
  id: number;
  nombre: string;
  dia_inicio_mes: number; // 1 a 28; 1 = mes calendario
}
export const obtenerFamilia = () => api<Familia>("/familia");
/** Solo el administrador. Cambia unicamente la VISTA de los periodos; no mueve ni cierra ningun dato. */
export const cambiarDiaInicioMes = (dia: number) => api<Familia>("/familia", { metodo: "PATCH", cuerpo: { dia_inicio_mes: dia } });
