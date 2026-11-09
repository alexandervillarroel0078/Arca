// Tipos de la cola de operaciones sin internet (Fase 12).

export type Entidad = "movimiento" | "apoyo" | "devolucion";
export type Accion = "crear" | "editar" | "anular" | "reactivar";

/** Lo que paso en el servidor cuando el registro cambio mientras el usuario estaba sin conexion. */
export interface Conflicto {
  mensaje: string;
  versionActual: number;
  /** El registro tal como esta ahora en el servidor (movimiento, apoyo o devolucion). */
  actual: unknown;
}

/**
 * Una operacion del usuario (crear, editar, anular o reactivar) guardada en el telefono hasta enviarse.
 * Cada una tiene su propio UUID (`id`): el servidor ignora una operacion que ya aplico (idempotencia).
 */
export interface Operacion {
  /** Orden de la cola (la asigna IndexedDB). Tambien da el id temporal `-seq` del registro creado sin internet. */
  seq: number;
  id: string;
  entidad: Entidad;
  accion: Accion;
  /** UUID del registro: siempre en `crear`; en las demas solo si el registro aun no existe en el servidor. */
  uuid: string | null;
  /** Id del servidor del registro (null mientras solo existe en el telefono). */
  entidadId: number | null;
  /** Devoluciones: el apoyo al que pertenecen (por id del servidor o, si se creo sin internet, por UUID). */
  apoyoId: number | null;
  apoyoUuid: string | null;
  /** crear: el cuerpo completo; editar: solo los campos cambiados; anular: {motivo}. */
  datos: Record<string, unknown>;
  /** Version del registro en la que se baso el usuario. */
  versionBase: number | null;
  /** Hay otra operacion pendiente sobre el mismo registro: su version base es la que deje la anterior al aplicarse. */
  encadenada: boolean;
  /** Cuando el usuario hizo la accion (queda en el historial aparte de la fecha de sincronizacion). */
  fechaCliente: string;
  estado: "pendiente" | "conflicto";
  intentos: number;
  conflicto?: Conflicto;
}

/** Una operacion que el servidor rechazo (permisos, regla de negocio...). Ya se revirtio localmente. */
export interface Rechazo {
  id: string;
  operacion: Operacion;
  motivo: string;
  estado: number;
  fecha: string;
}

export type DatosOperacion = Record<string, unknown>;

export interface NuevaOperacion {
  entidad: Entidad;
  accion: Accion;
  uuid?: string | null;
  entidadId?: number | null;
  apoyoId?: number | null;
  apoyoUuid?: string | null;
  datos?: DatosOperacion;
  versionBase?: number | null;
}

export interface ResultadoPasada {
  enviados: number;
  conflictos: number;
  rechazados: number;
  quedan: number;
  sinConexion: boolean;
  sesionVencida: boolean;
}

/** Lo que paso con UNA operacion al intentar enviarla. */
export type ResultadoOperacion =
  | { tipo: "aplicada"; respuesta: unknown }
  | { tipo: "pendiente" }
  | { tipo: "conflicto"; mensaje: string }
  | { tipo: "rechazada"; estado: number; motivo: string };
