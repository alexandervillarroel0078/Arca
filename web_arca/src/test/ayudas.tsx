import { render } from "@testing-library/react";
import { StrictMode, type ReactElement } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { AvisoProvider } from "../core/Aviso";
import { PeriodoProvider } from "../core/PeriodoContext";
import type { Seleccion } from "../core/periodo";
import type { Auditoria } from "../core/tipos";
import type { Yo } from "../modulos/auth/api";
import type { Apoyo, Devolucion } from "../modulos/apoyos/api";
import type { ItemActividad } from "../modulos/movimientos/actividad";

export const admin: Yo = { id: 1, nombre: "Ana Admin", email: "ana@t.com", familia_id: 1, familia_nombre: "Familia Prueba", rol: "admin" };
export const miembro: Yo = { id: 2, nombre: "Beto Miembro", email: "beto@t.com", familia_id: 1, familia_nombre: "Familia Prueba", rol: "miembro" };

export const sinAuditoria: Auditoria = {
  version: 1, uuid_cliente: null, anulado: false, anulado_por_nombre: null, anulado_en: null, motivo_anulacion: null, editado_por_nombre: null, editado_en: null,
};

export function apoyoDe(c: Partial<Apoyo> = {}): Apoyo {
  return {
    id: 1, beneficiario: "Tia Rosa", monto: 300, fecha: "2026-11-01", nota: null, usuario_id: 1, usuario_nombre: "Ana Admin",
    devuelto: 0, consumido: 0, pendiente: 300, estado: "Pendiente", devoluciones: [], devoluciones_activas: 0, ...sinAuditoria, ...c,
  };
}

export function devolucionDe(c: Partial<Devolucion> = {}): Devolucion {
  return {
    id: 10, apoyo_id: 1, monto: 100, fecha: "2026-11-02", nota: null, usuario_id: 1, usuario_nombre: "Ana Admin",
    anulada_con_apoyo: false, ...sinAuditoria, ...c,
  };
}

export function itemDe(c: Partial<ItemActividad> = {}): ItemActividad {
  return {
    clase: "movimiento", id: 1, tipo: "gasto", titulo: "Almuerzo", monto: 45, fecha: "2026-11-03", nota: "Almuerzo",
    usuario_id: 1, usuario_nombre: "Ana Admin", categoria_id: 2, categoria_nombre: "Comida", categoria_icono: "utensils",
    beneficiario: null, estado: null, pendiente: null, devoluciones_activas: null, ...sinAuditoria, ...c,
  };
}

/** Muestra la ruta actual para poder comprobar a donde navego la pantalla. */
function RutaActual() {
  const l = useLocation();
  return <div data-testid="ruta-actual">{l.pathname}</div>;
}

/** Renderiza una pantalla con router en memoria y los avisos activos. `ruta` es la URL inicial; `patron` la ruta que casa. */
export function renderPantalla(
  ui: ReactElement,
  opciones: { ruta?: string; patron?: string; estricto?: boolean; hoy?: string; diaInicioMes?: number; periodo?: Seleccion } = {},
) {
  const ruta = opciones.ruta ?? "/";
  const patron = opciones.patron ?? ruta;
  const pantalla = (
    <AvisoProvider>
      <PeriodoProvider
        diaInicioMes={opciones.diaInicioMes ?? 1}
        inicial={opciones.periodo}
        hoy={opciones.hoy ? () => opciones.hoy! : undefined}
      >
        <MemoryRouter initialEntries={[ruta]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            <Route path={patron} element={ui} />
            <Route path="*" element={<div data-testid="otra-pantalla" />} />
          </Routes>
          <RutaActual />
        </MemoryRouter>
      </PeriodoProvider>
    </AvisoProvider>
  );
  // estricto = como en desarrollo (main.tsx usa StrictMode: los efectos se ejecutan dos veces al montar)
  return render(opciones.estricto ? <StrictMode>{pantalla}</StrictMode> : pantalla);
}
