// Datos de ejemplo de Cuentas para las pruebas.
import type { Cuenta, MovimientoCuenta } from "../modulos/cuentas/api";
import { sinAuditoria } from "./ayudas";

export function mov(c: Partial<MovimientoCuenta> = {}): MovimientoCuenta {
  return {
    id: 1, tipo: "deposito", moneda: "BS", monto: "10.00", comision: null, sentido: null, saldo_previo: null, saldo_declarado: null,
    fecha: "2026-11-03", nota: null, cuenta_id: 1, cuenta_nombre: "Caja", cuenta_destino_id: null, cuenta_destino_nombre: null,
    persona_tipo: "sin_identificar", persona_usuario_id: null, persona_nombre: null, usuario_id: 1, usuario_nombre: "Ana",
    puede_registrar: true, efecto: "10.00", saldo_resultante: null, deja_saldo_negativo: null, ...sinAuditoria, ...c,
  };
}

export function cuentaDe(c: Partial<Cuenta> = {}): Cuenta {
  return {
    id: 1, nombre: "Caja", tipo: "efectivo", banco: null, banco_otro: null, moneda: "BS", ultimos4: null, saldo_inicial: "0.00",
    saldo: "0.00", saldo_negativo: false, visibilidad: "familia", compartido_con: [], usuario_id: 1, usuario_nombre: "Ana",
    encargado_id: null, encargado_nombre: null, es_dueno: true, puede_registrar: true, ...sinAuditoria, ...c,
  };
}
