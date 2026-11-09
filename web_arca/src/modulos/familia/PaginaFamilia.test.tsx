// Familia es un MENU de opciones; cada una abre su propia pantalla (ver tambien Pantallas.test.tsx).
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nuevoUuid } from "../../core/uuid";
import { admin, miembro, renderPantalla } from "../../test/ayudas";
import type { Yo } from "../auth/api";
import { encolar } from "../sync/cola";
import PaginaFamilia from "./PaginaFamilia";

const sesion = vi.hoisted(() => ({ usuario: null as Yo | null, salir: vi.fn(), actualizarUsuario: vi.fn() }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => sesion }));

const abrir = (usuario: Yo = admin) => {
  sesion.usuario = usuario;
  return renderPantalla(<PaginaFamilia />, { ruta: "/familia" });
};
const pendiente = () =>
  encolar({ entidad: "movimiento", accion: "crear", uuid: nuevoUuid(), datos: { tipo: "gasto", monto: 5, fecha: "2026-11-07", categoria_id: 2, nota: null } });

beforeEach(() => sesion.salir.mockReset());

describe("Familia: menu de opciones", () => {
  it("el admin ve las 7 opciones, cada una con icono, titulo, descripcion y flecha", async () => {
    abrir(admin);
    const menu = screen.getByRole("navigation", { name: "Opciones de Familia" });
    const ids = within(menu).getAllByTestId(/^opcion-familia-/).map((e) => e.getAttribute("data-testid"));
    expect(ids).toEqual(["opcion-familia-mi-familia", "opcion-familia-miembros", "opcion-familia-categorias", "opcion-familia-actividad", "opcion-familia-bitacora", "opcion-familia-perfil", "opcion-familia-salir"]);
    const miembros = screen.getByTestId("opcion-familia-miembros");
    expect(miembros).toHaveTextContent("Miembros");
    expect(miembros).toHaveTextContent("Quiénes forman tu familia");
    expect(miembros).toHaveTextContent("›");
    expect(miembros.querySelector("[aria-hidden]")).not.toBeNull(); // icono
  });

  it("cada opcion lleva a su ruta propia", () => {
    abrir(admin);
    expect(screen.getByTestId("opcion-familia-mi-familia")).toHaveAttribute("href", "/familia/mi-familia");
    expect(screen.getByTestId("opcion-familia-miembros")).toHaveAttribute("href", "/familia/miembros");
    expect(screen.getByTestId("opcion-familia-categorias")).toHaveAttribute("href", "/familia/categorias");
    expect(screen.getByTestId("opcion-familia-actividad")).toHaveAttribute("href", "/familia/actividad");
    expect(screen.getByTestId("opcion-familia-bitacora")).toHaveAttribute("href", "/familia/bitacora");
    expect(screen.getByTestId("opcion-familia-perfil")).toHaveAttribute("href", "/familia/perfil");
  });

  it("'Bitacora' es solo del admin: al miembro la opcion NO le aparece", () => {
    abrir(miembro);
    expect(screen.queryByTestId("opcion-familia-bitacora")).not.toBeInTheDocument();
    expect(screen.queryByText("Bitácora")).not.toBeInTheDocument();
  });

  it("'Actividad de la familia' es solo del admin: al miembro la opcion NO le aparece", () => {
    abrir(miembro);
    expect(screen.queryByTestId("opcion-familia-actividad")).not.toBeInTheDocument();
    expect(screen.queryByText("Actividad de la familia")).not.toBeInTheDocument();
    expect(screen.getAllByTestId(/^opcion-familia-/)).toHaveLength(5);
    expect(screen.getByText(/solo un administrador puede cambiar categorías y miembros/)).toBeInTheDocument();
  });

  it("las opciones miden 44px o mas (76px) y no hay formularios en el menu", () => {
    abrir(admin);
    for (const o of screen.getAllByTestId(/^opcion-familia-/)) expect(o.className).toContain("min-h-[76px]");
    expect(document.querySelector("form")).toBeNull();
    expect(screen.queryByLabelText("Mi nombre")).not.toBeInTheDocument();
  });
});

describe("Familia: cerrar sesion", () => {
  it("pide confirmacion: si se cancela no sale", async () => {
    const u = userEvent.setup();
    abrir();
    await u.click(screen.getByTestId("opcion-familia-salir"));
    const d = await screen.findByRole("dialog", { name: "Cerrar sesión" });
    await u.click(within(d).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(sesion.salir).not.toHaveBeenCalled();
  });

  it("al confirmar sale", async () => {
    const u = userEvent.setup();
    abrir();
    await u.click(screen.getByTestId("opcion-familia-salir"));
    const d = await screen.findByRole("dialog", { name: "Cerrar sesión" });
    expect(within(d).queryByRole("alert")).not.toBeInTheDocument(); // sin pendientes: sin advertencia
    await u.click(within(d).getByRole("button", { name: "Cerrar sesión" }));
    expect(sesion.salir).toHaveBeenCalledTimes(1);
  });

  it("con registros sin enviar lo advierte (se pierden al salir)", async () => {
    const u = userEvent.setup();
    await pendiente();
    abrir();
    await u.click(screen.getByTestId("opcion-familia-salir"));
    const d = await screen.findByRole("dialog", { name: "Cerrar sesión" });
    expect(await within(d).findByRole("alert")).toHaveTextContent("Hay 1 registro(s) sin enviar. Si sales ahora se perderán.");
    await waitFor(() => expect(sesion.salir).not.toHaveBeenCalled());
    await u.click(within(d).getByRole("button", { name: "Cancelar" }));
    expect(sesion.salir).not.toHaveBeenCalled();
  });
});
