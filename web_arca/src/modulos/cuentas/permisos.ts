// Qué botones se muestran. SOLO se usa lo que devuelve la API (es_dueno, puede_registrar): el servidor es quien manda y,
// si una acción se rechaza, la pantalla se refresca. Aquí no se deduce nada de roles (el admin no es excepción).
import type { Cuenta, MovimientoCuenta } from "./api";

export interface QueSePuede {
  registrar: boolean; // "Registrar en esta cuenta"
  editar: boolean; // editar, anular o reactivar la cuenta, cambiar quién la ve
}

export function permisosDeCuenta(c: Pick<Cuenta, "puede_registrar" | "es_dueno" | "anulado">): QueSePuede {
  return { registrar: c.puede_registrar && !c.anulado, editar: c.es_dueno };
}

/** Anular o reactivar un movimiento: la API dice si eres dueño o encargado de TODAS las cuentas que toca. */
export const puedeAnularMovimiento = (m: Pick<MovimientoCuenta, "puede_registrar">) => m.puede_registrar;

/** Cambiar la fecha: lo único que se corrige de un movimiento. Nunca en un ajuste por conteo ni en uno anulado. */
export const puedeCambiarFecha = (m: Pick<MovimientoCuenta, "puede_registrar" | "anulado" | "tipo">) =>
  m.puede_registrar && !m.anulado && m.tipo !== "ajuste";

/** Cuentas donde se puede registrar algo (no anuladas). */
export const cuentasRegistrables = (cuentas: Cuenta[]) => cuentas.filter((c) => c.puede_registrar && !c.anulado);

/** Destinos válidos de un traspaso: otra cuenta de la MISMA moneda donde también puedas registrar. */
export const destinosDeTraspaso = (origen: Cuenta | undefined, cuentas: Cuenta[]) =>
  origen ? cuentasRegistrables(cuentas).filter((c) => c.id !== origen.id && c.moneda === origen.moneda) : [];
