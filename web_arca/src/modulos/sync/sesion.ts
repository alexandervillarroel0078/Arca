// Seguridad de lo guardado en el aparato (Fase 12): el cache y la cola se borran al cerrar sesion.
import * as almacen from "../../core/almacen";
import { listarOperaciones } from "./cola";

const CLAVE_PROPIETARIO = "propietario";

/** Cerrar sesion: se borra TODO lo guardado (cache, registros conocidos, cola y rechazos). */
export async function borrarTodoLocal(): Promise<void> {
  await almacen.vaciarTodo();
  try {
    localStorage.removeItem("arca-cola"); // cola de versiones anteriores de la app
  } catch {
    /* sin localStorage */
  }
}

/**
 * La sesion vencio (no fue el usuario quien salio): se borra el cache, pero la cola se CONSERVA, porque tiene cambios
 * que el usuario hizo y todavia no llegaron al servidor. Se enviaran cuando la misma persona vuelva a entrar.
 */
export async function olvidarCacheDeSesionVencida(): Promise<void> {
  await almacen.vaciar("cache");
  await almacen.vaciar("entidades");
}

/**
 * Al entrar: la cola es de una persona. Si quien entra no es el dueno de lo que quedo guardado, se borra todo
 * (nunca se mandan cambios de otra cuenta). Devuelve cuantos cambios pendientes de la otra cuenta se descartaron.
 */
export async function prepararSesion(usuarioId: number): Promise<number> {
  const previo = await almacen.obtener<{ clave: string; valor: number }>("meta", CLAVE_PROPIETARIO);
  let descartados = 0;
  if (previo && previo.valor !== usuarioId) {
    descartados = (await listarOperaciones()).length;
    await almacen.vaciarTodo();
  }
  await almacen.poner("meta", { clave: CLAVE_PROPIETARIO, valor: usuarioId });
  return descartados;
}
