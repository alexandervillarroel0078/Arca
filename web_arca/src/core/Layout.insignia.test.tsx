import { act, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { encolar } from "../modulos/sync/cola";
import { AvisoProvider } from "./Aviso";
import Layout from "./Layout";

const gasto = (n: number) =>
  encolar({ entidad: "movimiento", accion: "crear", uuid: `u-${n}`, datos: { tipo: "gasto", monto: n, fecha: "2026-11-07", categoria_id: 2, nota: null } });

function abrir(ruta = "/") {
  return render(
    <AvisoProvider>
      <MemoryRouter initialEntries={[ruta]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<div>inicio</div>} />
            <Route path="apoyos" element={<div>apoyos</div>} />
            <Route path="nuevo" element={<div>nuevo</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AvisoProvider>,
  );
}
const barra = () => screen.getByRole("navigation", { name: "Navegación principal" });
const insignia = () => within(barra()).queryByTestId("insignia-pendientes");

describe("Layout: insignia de cambios sin enviar en la pestana Inicio", () => {
  it("sin cambios pendientes no hay insignia", async () => {
    abrir();
    await act(async () => {});
    expect(insignia()).not.toBeInTheDocument();
  });

  it("con 1 cambio: muestra 1 y se lee '1 cambio sin enviar'", async () => {
    await gasto(10);
    abrir();
    await waitFor(() => expect(insignia()).toBeInTheDocument());
    expect(insignia()).toHaveTextContent("1");
    expect(screen.getByRole("img", { name: "1 cambio sin enviar" })).toBe(insignia());
  });

  it("con varios: muestra el numero y el nombre en plural", async () => {
    await gasto(10);
    await gasto(20);
    await gasto(30);
    abrir();
    await waitFor(() => expect(insignia()).toHaveTextContent("3"));
    expect(screen.getByRole("img", { name: "3 cambios sin enviar" })).toBeInTheDocument();
  });

  it("de 10 en adelante muestra 9+ pero el nombre accesible lleva la cuenta exacta", async () => {
    for (let i = 1; i <= 11; i++) await gasto(i);
    abrir();
    await waitFor(() => expect(insignia()).toHaveTextContent("9+"));
    expect(screen.getByRole("img", { name: "11 cambios sin enviar" })).toBeInTheDocument();
  });

  it("aparece y desaparece al cambiar la cola (no hace falta recargar)", async () => {
    abrir();
    await act(async () => {});
    expect(insignia()).not.toBeInTheDocument();
    await act(async () => { await gasto(5); });
    await waitFor(() => expect(insignia()).toHaveTextContent("1"));
  });

  it("no cambia el nombre de la pestana Inicio (sigue siendo exactamente 'Inicio') porque va FUERA del enlace", async () => {
    await gasto(10);
    abrir();
    await waitFor(() => expect(insignia()).toBeInTheDocument());
    const inicio = within(barra()).getByRole("link", { name: "Inicio" });
    expect(inicio).toHaveAccessibleName("Inicio");
    expect(inicio).not.toContainElement(insignia());
  });

  it("no mueve el layout ni toca el '+': posicion absoluta, sin eventos de puntero, solo en la pestana Inicio", async () => {
    await gasto(10);
    abrir();
    await waitFor(() => expect(insignia()).toBeInTheDocument());
    expect(insignia()!.className).toMatch(/\babsolute\b/);
    expect(insignia()!.className).toMatch(/pointer-events-none/);
    expect(insignia()!.parentElement!.className).toMatch(/\brelative\b/);
    expect(within(barra()).getAllByTestId("insignia-pendientes")).toHaveLength(1);
    expect(within(barra()).getByRole("link", { name: "Nuevo movimiento" })).not.toContainElement(insignia());
    expect(within(barra()).getAllByRole("listitem")).toHaveLength(5); // la barra sigue siendo 2 + "+" + 2
  });

  it("se ve en cualquier pantalla con barra (no solo en Inicio)", async () => {
    await gasto(10);
    abrir("/apoyos");
    await waitFor(() => expect(insignia()).toBeInTheDocument());
  });
});
