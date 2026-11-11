import { bs } from "../../core/formato";
import { fechaHora } from "../../core/tipos";
import type { EntradaHistorial } from "./api";

export const ACCIONES: Record<string, string> = {
  crear: "Creó",
  editar: "Editó",
  anular: "Anuló",
  reactivar: "Reactivó",
  consumir: "Marcó como consumido",
  reabrir: "Reabrió",
  cambiar_rol: "Cambió el rol",
  desactivar: "Desactivó",
  restablecer_clave: "Restableció la clave",
  cambiar_clave: "Cambió su clave",
};

const CAMPOS: Record<string, string> = {
  tipo: "Tipo", monto: "Monto", fecha: "Fecha", categoria: "Categoría", nota: "Nota", beneficiario: "Beneficiario",
  monto_consumido: "Consumido", anulado: "Anulado", nombre: "Nombre", email: "Correo", icono: "Icono",
  activa: "Activa", rol: "Rol", activo: "Activo", clave: "Clave",
  // Cuentas: los montos ya llegan con su moneda ("100.00 USD"); los nombres de cuenta los resuelve el servidor para quien lee
  moneda: "Moneda", banco: "Banco", banco_otro: "Otro banco", saldo_inicial: "Saldo inicial", comision: "Comisión de red",
  sentido: "Sentido", saldo_previo: "Saldo antes", saldo_declarado: "Saldo contado", cuenta: "Cuenta",
  cuenta_destino: "Cuenta destino", persona: "Persona", encargado: "Encargado", visibilidad: "Quién lo ve",
};
const VALORES: Record<string, string> = {
  deposito: "Depósito", retiro: "Retiro", traspaso: "Traspaso", ajuste: "Ajuste por conteo", ahorro: "Caja de ahorro",
  corriente: "Cuenta corriente", cripto: "Cripto", efectivo: "Efectivo", entrada: "Entrada", salida: "Salida",
  solo_yo: "Solo yo", familia: "Familia", elegidas: "Personas elegidas",
};
const CAMPOS_DINERO = new Set(["monto", "monto_consumido"]);
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function valorLegible(campo: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "(vacío)";
  if (typeof v === "boolean") return v ? "Si" : "No";
  if (CAMPOS_DINERO.has(campo)) return bs(Number(v));
  if (campo === "fecha" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [a, m, d] = v.split("-").map(Number);
    return `${d} ${MESES[m - 1]} ${a}`;
  }
  if (campo === "tipo") return v === "gasto" ? "Gasto" : v === "ingreso" ? "Ingreso" : VALORES[String(v)] ?? String(v);
  if ((campo === "sentido" || campo === "visibilidad") && typeof v === "string") return VALORES[v] ?? v;
  if (campo === "rol") return v === "admin" ? "Admin" : v === "miembro" ? "Miembro" : String(v);
  return String(v);
}

/** Una linea por campo: "Monto: Bs 45.00 → Bs 60.00" (o solo el valor al crear). */
export function lineasDeCambios(e: EntradaHistorial): string[] {
  return Object.entries(e.cambios).map(([campo, c]) => {
    const nombre = CAMPOS[campo] ?? campo;
    if (typeof c === "string") return `${nombre}: ${c}`; // ej. "Clave: clave cambiada"
    if (e.accion === "crear" || (c.antes === null && c.despues !== null && e.accion !== "editar")) {
      return `${nombre}: ${valorLegible(campo, c.despues)}`;
    }
    return `${nombre}: ${valorLegible(campo, c.antes)} → ${valorLegible(campo, c.despues)}`;
  });
}

/** Hecho sin internet: la accion ocurrio bastante antes de llegar al servidor (mas de 1 minuto de diferencia). */
export function fueSinConexion(e: EntradaHistorial): boolean {
  return !!e.fecha_cliente && Math.abs(new Date(e.fecha).getTime() - new Date(e.fecha_cliente).getTime()) > 60_000;
}

/** Una entrada del historial: quien, cuando, que hizo y que cambio (de X a Y). */
export default function EntradaHistorialVista({ e, mostrarEtiqueta = false }: { e: EntradaHistorial; mostrarEtiqueta?: boolean }) {
  const lineas = lineasDeCambios(e);
  return (
    <li data-testid="entrada-historial" data-accion={e.accion} className="py-3">
      {mostrarEtiqueta && e.etiqueta && <p className="text-sm font-semibold">{e.etiqueta}</p>}
      <p className="text-sm">
        <span className="font-semibold text-arca">{ACCIONES[e.accion] ?? e.accion}</span>
        <span className="text-stone-600"> · {e.usuario_nombre} · {fechaHora(fueSinConexion(e) ? e.fecha_cliente! : e.fecha)}</span>
      </p>
      {fueSinConexion(e) && (
        <p className="text-xs text-stone-500" data-testid="sincronizado-en">Hecho sin conexión · sincronizado {fechaHora(e.fecha)}</p>
      )}
      {e.motivo && <p className="text-xs text-stone-600 mt-0.5">Motivo: {e.motivo}</p>}
      {lineas.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs text-stone-700 border-l-2 border-stone-200 pl-2">
          {lineas.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
    </li>
  );
}
