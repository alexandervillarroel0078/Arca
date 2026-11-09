import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { admin } from "../../test/ayudas";
import type { Yo } from "../auth/api";
import * as familia from "../familia/api";
import * as api from "./api";
import PaginaActividadFamilia from "./PaginaActividadFamilia";

const sesion = vi.hoisted(() => ({ usuario: null as Yo | null }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => sesion }));
vi.mock("../familia/api", () => ({ listarMiembros: vi.fn() }));
vi.mock("./api", () => ({ cadenaHistorial: vi.fn(), actividadFamilia: vi.fn() }));
const A = vi.mocked(api);

const entrada: api.EntradaHistorial = {
  id: 1, entidad: "movimiento", entidad_id: 7, accion: "editar", usuario_id: 1, usuario_nombre: "Ana Admin",
  fecha: new Date(2026, 10, 3, 14, 5).toISOString(), cambios: {}, motivo: null, etiqueta: "Gasto: Almuerzo (Bs 45.00)",
};

beforeEach(() => {
  sesion.usuario = admin;
  A.actividadFamilia.mockResolvedValue({ items: [entrada], total: 1, hay_mas: false });
  vi.mocked(familia.listarMiembros).mockResolvedValue([
    { usuario_id: 1, nombre: "Ana Admin", email: "a@t.com", rol: "admin", activo: true },
    { usuario_id: 2, nombre: "Beto Miembro", email: "b@t.com", rol: "miembro", activo: true },
  ]);
});

const abrir = () => render(<MemoryRouter><PaginaActividadFamilia /></MemoryRouter>);
const filtros = () => screen.getByRole("group", { name: "Filtros" });

describe("Actividad de la familia: filtros como chips", () => {
  it("ya no hay <select> nativos: son tres chips con su valor actual", async () => {
    abrir();
    await screen.findByTestId("entrada-historial");
    expect(document.querySelector("select")).toBeNull();
    expect(within(filtros()).getAllByRole("button").map((b) => b.textContent?.replace(/\s+/g, " ").trim())).toEqual([
      "Qué: Todo ▾",
      "Acción: Todas las acciones ▾",
      "Quién: Toda la familia ▾",
    ]);
  });

  it("el texto no se corta: los chips no se parten ni se recortan y se acomodan en varias filas (flex-wrap)", async () => {
    abrir();
    await screen.findByTestId("entrada-historial");
    expect(filtros().className).toMatch(/flex-wrap/);
    for (const b of within(filtros()).getAllByRole("button")) {
      expect(b.className).toMatch(/whitespace-nowrap/);
      expect(b.className).not.toMatch(/truncate|overflow-hidden|text-ellipsis/);
      expect(b.className).toMatch(/min-h-\[44px\]/);
    }
  });

  it("cada chip abre su hoja de opciones; 'Quien' lista a los miembros", async () => {
    const u = userEvent.setup();
    abrir();
    await screen.findByTestId("entrada-historial");
    await u.click(screen.getByRole("button", { name: /^Qué:/ }));
    const que = screen.getByRole("dialog", { name: "Qué" });
    expect(within(que).getAllByRole("radio").map((r) => r.textContent?.replace("✓", "").trim())).toEqual([
      "Todo", "Movimientos", "Apoyos", "Devoluciones", "Categorías", "Miembros", "Usuarios",
    ]);
    await u.keyboard("{Escape}");
    await u.click(screen.getByRole("button", { name: /^Quién:/ }));
    expect(within(screen.getByRole("dialog", { name: "Quién" })).getAllByRole("radio").map((r) => r.textContent?.replace("✓", "").trim())).toEqual([
      "Toda la familia", "Ana Admin", "Beto Miembro",
    ]);
  });

  it("elegir una opcion cierra la hoja, vuelve a pedir desde el principio y el chip muestra (y marca) lo elegido", async () => {
    const u = userEvent.setup();
    abrir();
    await screen.findByTestId("entrada-historial");
    const chip = () => screen.getByRole("button", { name: /^Acción:/ });
    expect(chip().className).not.toMatch(/bg-arca-claro/);
    await u.click(chip());
    await u.click(within(screen.getByRole("dialog", { name: "Acción" })).getByRole("radio", { name: "Marcó como consumido" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(A.actividadFamilia).toHaveBeenLastCalledWith({ entidad: "", accion: "consumir", usuario: "" }, 0, 20));
    expect(chip()).toHaveTextContent("Acción: Marcó como consumido");
    expect(chip().className).toMatch(/bg-arca-claro/); // activo
    // volver a "todas" lo desactiva
    await u.click(chip());
    await u.click(within(screen.getByRole("dialog", { name: "Acción" })).getByRole("radio", { name: "Todas las acciones" }));
    await waitFor(() => expect(A.actividadFamilia).toHaveBeenLastCalledWith({ entidad: "", accion: "", usuario: "" }, 0, 20));
    expect(chip().className).not.toMatch(/bg-arca-claro/);
  });

  it("Escape cierra la hoja sin cambiar el filtro y el foco vuelve al chip", async () => {
    const u = userEvent.setup();
    abrir();
    await screen.findByTestId("entrada-historial");
    const chip = screen.getByRole("button", { name: /^Qué:/ });
    await u.click(chip);
    await u.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(chip).toHaveFocus();
    expect(A.actividadFamilia).toHaveBeenCalledTimes(1);
  });

  it("un miembro (no admin) sigue sin ver la pantalla", () => {
    sesion.usuario = { ...admin, rol: "miembro" };
    abrir();
    expect(screen.queryByRole("group", { name: "Filtros" })).not.toBeInTheDocument();
  });
});
