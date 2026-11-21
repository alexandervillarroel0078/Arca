// Fuente de pago (0010) en los reportes: calculos puros (fuera de api.ts para usarlos aunque la API este simulada).
export type ConFuente = { saldo: number; saldo_efectivo?: number; gastos_banco?: number; apoyos_banco?: number; ingresos_banco?: number };
/** "Te queda" / "Saldo de efectivo": solo lo registrado en Efectivo (sin dato: respuestas guardadas antes = saldo). */
export const saldoEfectivo = (r: ConFuente) => r.saldo_efectivo ?? r.saldo;
/** Lo pagado con banco (gastos y apoyos): incluido en gastos/apoyos, NO sale del efectivo. */
export const pagadoConBanco = (r: ConFuente) => (r.gastos_banco ?? 0) + (r.apoyos_banco ?? 0);
export const ingresadoAlBanco = (r: ConFuente) => r.ingresos_banco ?? 0;
