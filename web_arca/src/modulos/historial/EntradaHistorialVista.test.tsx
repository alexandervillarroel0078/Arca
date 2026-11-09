import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import EntradaHistorialVista, { ACCIONES, lineasDeCambios } from "./EntradaHistorialVista";
import type { EntradaHistorial } from "./api";

const entrada = (c: Partial<EntradaHistorial> = {}): EntradaHistorial => ({
  id: 1, entidad: "movimiento", entidad_id: 7, accion: "editar", usuario_id: 1, usuario_nombre: "Ana",
  fecha: new Date(2026, 10, 3, 14, 5).toISOString(), cambios: {}, motivo: null, etiqueta: "Gasto: Almuerzo (Bs 45.00)", ...c,
});

describe("lineasDeCambios", () => {
  it("al editar muestra de X a Y; el dinero con formato Bs", () => {
    const e = entrada({ cambios: { monto: { antes: "45.00", despues: "60.00" }, nota: { antes: "a", despues: "b" } } });
    expect(lineasDeCambios(e)).toEqual(["Monto: Bs 45.00 → Bs 60.00", "Nota: a → b"]);
  });

  it("al crear muestra solo el valor", () => {
    const e = entrada({
      accion: "crear",
      cambios: { monto: { antes: null, despues: "45.00" }, tipo: { antes: null, despues: "gasto" }, categoria: { antes: null, despues: "Comida" } },
    });
    expect(lineasDeCambios(e)).toEqual(["Monto: Bs 45.00", "Tipo: Gasto", "Categoría: Comida"]);
  });

  it("valores vacios, booleanos, roles y fechas se leen en espanol", () => {
    const e = entrada({
      cambios: {
        nota: { antes: "algo", despues: null },
        anulado: { antes: false, despues: true },
        rol: { antes: "miembro", despues: "admin" },
        fecha: { antes: "2026-11-01", despues: "2026-11-03" },
        monto_consumido: { antes: "0.00", despues: "300.00" },
      },
    });
    expect(lineasDeCambios(e)).toEqual([
      "Nota: algo → (vacío)",
      "Anulado: No → Si",
      "Rol: Miembro → Admin",
      "Fecha: 1 nov 2026 → 3 nov 2026",
      "Consumido: Bs 0.00 → Bs 300.00",
    ]);
  });

  it("en cambios de clave solo aparece el texto fijo, nunca un valor", () => {
    const e = entrada({ accion: "cambiar_clave", entidad: "usuario", cambios: { clave: "clave cambiada" } });
    expect(lineasDeCambios(e)).toEqual(["Clave: clave cambiada"]);
  });

  it("un campo desconocido se muestra con su nombre tecnico", () => {
    expect(lineasDeCambios(entrada({ cambios: { raro: { antes: 1, despues: 2 } } }))).toEqual(["raro: 1 → 2"]);
  });
});

describe("EntradaHistorialVista", () => {
  it("muestra accion, quien, cuando, motivo y cambios", () => {
    render(
      <ul>
        <EntradaHistorialVista e={entrada({ accion: "anular", motivo: "Duplicado", cambios: { anulado: { antes: false, despues: true } } })} />
      </ul>,
    );
    const li = screen.getByTestId("entrada-historial");
    expect(li).toHaveAttribute("data-accion", "anular");
    expect(li).toHaveTextContent("Anuló");
    expect(li).toHaveTextContent("Ana");
    expect(li).toHaveTextContent("3 nov 14:05");
    expect(li).toHaveTextContent("Motivo: Duplicado");
    expect(li).toHaveTextContent("Anulado: No → Si");
    expect(screen.queryByText("Gasto: Almuerzo (Bs 45.00)")).not.toBeInTheDocument();
  });

  it("en la actividad global muestra ademas el nombre del registro", () => {
    render(<ul><EntradaHistorialVista e={entrada()} mostrarEtiqueta /></ul>);
    expect(screen.getByText("Gasto: Almuerzo (Bs 45.00)")).toBeInTheDocument();
  });

  it("todas las acciones del backend tienen texto en espanol", () => {
    for (const a of ["crear", "editar", "anular", "reactivar", "consumir", "reabrir", "cambiar_rol", "desactivar", "restablecer_clave", "cambiar_clave"]) {
      expect(ACCIONES[a]).toBeTruthy();
    }
  });
});

describe("fecha real de la accion (Fase 12)", () => {
  it("si se hizo sin conexion muestra cuando la hizo el usuario y, aparte, cuando se sincronizo", () => {
    render(<ul><EntradaHistorialVista e={entrada({ fecha: new Date(2026, 10, 3, 18, 0).toISOString(), fecha_cliente: new Date(2026, 10, 3, 14, 5).toISOString() })} /></ul>);
    expect(screen.getByTestId("entrada-historial")).toHaveTextContent("3 nov 14:05"); // la hora real
    expect(screen.getByTestId("sincronizado-en")).toHaveTextContent("Hecho sin conexión · sincronizado 3 nov 18:00");
  });

  it("si la diferencia es de segundos (con conexion) no agrega nada", () => {
    render(<ul><EntradaHistorialVista e={entrada({ fecha: new Date(2026, 10, 3, 14, 5, 30).toISOString(), fecha_cliente: new Date(2026, 10, 3, 14, 5, 29).toISOString() })} /></ul>);
    expect(screen.queryByTestId("sincronizado-en")).not.toBeInTheDocument();
  });

  it("entradas antiguas sin fecha_cliente se muestran como siempre", () => {
    render(<ul><EntradaHistorialVista e={entrada({})} /></ul>);
    expect(screen.getByTestId("entrada-historial")).toHaveTextContent("3 nov 14:05");
    expect(screen.queryByTestId("sincronizado-en")).not.toBeInTheDocument();
  });
});

