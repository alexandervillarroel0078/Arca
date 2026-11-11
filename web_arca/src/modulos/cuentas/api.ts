// Cliente de /api/cuentas. SOLO EN LINEA: se usa `api()` directo, sin pasar por la cola ni por el cache de pantallas
// de lectura ni la cola de envíos: ninguna respuesta de cuentas se guarda en el aparato.
import { api } from "../../core/api";
import type { Auditoria } from "../../core/tipos";
import type { Visibilidad } from "../privacidad/visibilidad";
import type { TipoCuenta } from "./matriz";
import type { Moneda } from "./montos";

export interface Cuenta extends Auditoria {
  id: number;
  nombre: string;
  tipo: TipoCuenta;
  banco: string | null;
  banco_otro: string | null;
  moneda: Moneda;
  ultimos4: string | null;
  saldo_inicial: string;
  saldo: string; // calculado por el servidor
  saldo_negativo: boolean;
  visibilidad: Visibilidad;
  compartido_con: number[];
  usuario_id: number;
  usuario_nombre: string;
  encargado_id: number | null;
  encargado_nombre: string | null;
  es_dueno: boolean;
  puede_registrar: boolean;
}

export interface TotalMoneda {
  moneda: Moneda;
  total: string;
  cuentas: number;
  hay_negativas: boolean;
}
export interface Cuentas {
  cuentas: Cuenta[];
  totales: TotalMoneda[];
  privadas_propias: number;
}

export type TipoMovimiento = "deposito" | "retiro" | "traspaso" | "ajuste";
export type PersonaTipo = "miembro" | "otra" | "sin_identificar";

export interface MovimientoCuenta extends Auditoria {
  id: number;
  tipo: TipoMovimiento;
  moneda: Moneda;
  monto: string;
  comision: string | null;
  sentido: "entrada" | "salida" | null;
  saldo_previo: string | null;
  saldo_declarado: string | null;
  fecha: string;
  nota: string | null;
  cuenta_id: number | null; // nulo: una cuenta que no ves ("otra cuenta")
  cuenta_nombre: string;
  cuenta_destino_id: number | null;
  cuenta_destino_nombre: string | null;
  persona_tipo: PersonaTipo;
  persona_usuario_id: number | null;
  persona_nombre: string | null;
  usuario_id: number;
  usuario_nombre: string;
  puede_registrar: boolean;
  efecto: string | null; // solo en la lista de una cuenta
  saldo_resultante: string | null; // solo al crear o reactivar
  deja_saldo_negativo: boolean | null;
}

export interface Catalogo {
  monedas: Record<string, number>;
  monedas_por_tipo: Record<string, string[]>;
  bancos: string[];
  plataformas: string[];
  aviso_nota: string;
}

export interface Persona {
  persona_tipo: PersonaTipo;
  persona_usuario_id?: number;
  persona_nombre?: string;
}

export const listarCuentas = (verAnuladas = false) => api<Cuentas>(`/cuentas${verAnuladas ? "?ver_anuladas=true" : ""}`);
export const obtenerCuenta = (id: number) => api<Cuenta>(`/cuentas/${id}`);
export const catalogo = () => api<Catalogo>("/cuentas/catalogo");

export interface CuentaNueva {
  nombre: string;
  tipo: TipoCuenta;
  moneda: Moneda;
  banco?: string;
  banco_otro?: string;
  ultimos4?: string;
  saldo_inicial: string;
  encargado_id?: number;
  visibilidad: Visibilidad;
  compartido_con?: number[];
  uuid_cliente?: string;
}
export const crearCuenta = (c: CuentaNueva) => api<Cuenta>("/cuentas", { metodo: "POST", cuerpo: c });
export const editarCuenta = (id: number, cambios: Record<string, unknown>) =>
  api<Cuenta>(`/cuentas/${id}`, { metodo: "PATCH", cuerpo: cambios });
export const anularCuenta = (c: Cuenta, motivo: string) =>
  api<Cuenta>(`/cuentas/${c.id}/anular`, { metodo: "POST", cuerpo: { motivo: motivo || null, version_base: c.version } });
export const reactivarCuenta = (c: Cuenta) =>
  api<Cuenta>(`/cuentas/${c.id}/reactivar`, { metodo: "POST", cuerpo: { version_base: c.version } });

export interface FiltrosMovimientos {
  cuenta?: number;
  desde?: string;
  hasta?: string;
  verAnulados?: boolean;
  limite?: number;
}
export function listarMovimientosCuentas(f: FiltrosMovimientos = {}) {
  const q = new URLSearchParams({ limite: String(f.limite ?? 200) });
  if (f.desde) q.set("desde", f.desde);
  if (f.hasta) q.set("hasta", f.hasta);
  if (f.verAnulados) q.set("ver_anulados", "true");
  const base = f.cuenta !== undefined ? `/cuentas/${f.cuenta}/movimientos` : "/cuentas/movimientos";
  return api<MovimientoCuenta[]>(`${base}?${q.toString()}`);
}

interface Comun extends Persona {
  fecha: string;
  nota?: string;
  uuid_cliente?: string;
}
export const registrarDeposito = (cuenta: number, d: Comun & { monto: string }) =>
  api<MovimientoCuenta>(`/cuentas/${cuenta}/depositos`, { metodo: "POST", cuerpo: d });
export const registrarRetiro = (cuenta: number, d: Comun & { monto: string; comision?: string }) =>
  api<MovimientoCuenta>(`/cuentas/${cuenta}/retiros`, { metodo: "POST", cuerpo: d });
export const registrarAjuste = (cuenta: number, d: Comun & { saldo_declarado: string }) =>
  api<MovimientoCuenta>(`/cuentas/${cuenta}/ajustes`, { metodo: "POST", cuerpo: d });
export const registrarTraspaso = (d: Comun & { cuenta_id: number; cuenta_destino_id: number; monto: string }) =>
  api<MovimientoCuenta>("/cuentas/traspasos", { metodo: "POST", cuerpo: d });

export const anularMovimientoCuenta = (m: MovimientoCuenta, motivo: string) =>
  api<MovimientoCuenta>(`/cuentas/movimientos/${m.id}/anular`, { metodo: "POST", cuerpo: { motivo: motivo || null, version_base: m.version } });
export const reactivarMovimientoCuenta = (m: MovimientoCuenta) =>
  api<MovimientoCuenta>(`/cuentas/movimientos/${m.id}/reactivar`, { metodo: "POST", cuerpo: { version_base: m.version } });
