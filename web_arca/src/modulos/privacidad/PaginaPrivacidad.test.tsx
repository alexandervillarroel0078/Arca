// Fase 17: Familia > Mi perfil > Privacidad.
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorApi } from "../../core/api";
import { miembro, renderPantalla } from "../../test/ayudas";
import type { Yo } from "../auth/api";
import * as api from "./api";
import PaginaPrivacidad from "./PaginaPrivacidad";

const sesion = vi.hoisted(() => ({ usuario: null as Yo | null, actualizarUsuario: vi.fn() }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => sesion, useUsuarioOpcional: () => sesion.usuario }));
vi.mock("./api", () => ({ obtenerPrivacidad: vi.fn(), cambiarPreferencia: vi.fn(), aplicarPreferencia: vi.fn() }));

const A = vi.mocked(api);
const abrir = () => renderPantalla(<PaginaPrivacidad />, { ruta: "/familia/perfil/privacidad" });

beforeEach(() => {
  sesion.usuario = miembro;
  sesion.actualizarUsuario.mockReset();
  A.obtenerPrivacidad.mockReset();
  A.cambiarPreferencia.mockReset();
  A.aplicarPreferencia.mockReset();
  A.obtenerPrivacidad.mockResolvedValue({ visibilidad_defecto: "familia", registros_distintos: 0 });
});

describe("Privacidad: preferencia por defecto", () => {
  it("muestra la preferencia actual (Familia) y esqueleto mientras carga", async () => {
    abrir();
    expect(screen.getByText("Cargando...")).toBeInTheDocument(); // esqueleto de carga
    expect(await screen.findByRole("radio", { name: /Familia/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /Solo yo/ })).toHaveAttribute("aria-checked", "false");
  });

  it("cambiar a Solo yo guarda la preferencia, actualiza la sesion y avisa que vale hacia adelante", async () => {
    const u = userEvent.setup();
    A.cambiarPreferencia.mockResolvedValue({ visibilidad_defecto: "solo_yo", registros_distintos: 4 });
    abrir();
    await u.click(await screen.findByRole("radio", { name: /Solo yo/ }));
    await waitFor(() => expect(A.cambiarPreferencia).toHaveBeenCalledWith("solo_yo"));
    expect(sesion.actualizarUsuario).toHaveBeenCalledWith(expect.objectContaining({ id: 2, visibilidad_defecto: "solo_yo" }));
    expect(await screen.findByText(/desde ahora/)).toBeInTheDocument();
  });

  it("tocar la que ya esta elegida no llama al servidor", async () => {
    const u = userEvent.setup();
    abrir();
    await u.click(await screen.findByRole("radio", { name: /Familia/ }));
    expect(A.cambiarPreferencia).not.toHaveBeenCalled();
  });
});

describe("Privacidad: aplicar a mis registros anteriores", () => {
  it("sin registros distintos el boton esta desactivado y lo dice", async () => {
    abrir();
    expect(await screen.findByRole("button", { name: "Aplicar a mis registros anteriores" })).toBeDisabled();
    expect(screen.getByTestId("cuantos-afecta")).toHaveTextContent("ya tienen tu preferencia");
  });

  it("la confirmacion dice cuantos se afectan y recien al confirmar los cambia", async () => {
    const u = userEvent.setup();
    A.obtenerPrivacidad.mockResolvedValue({ visibilidad_defecto: "solo_yo", registros_distintos: 7 });
    A.aplicarPreferencia.mockResolvedValue({ afectados: 7, visibilidad: "solo_yo" });
    abrir();
    expect(await screen.findByTestId("cuantos-afecta")).toHaveTextContent("cambiaría 7 registros tuyos");
    await u.click(screen.getByRole("button", { name: "Aplicar a mis registros anteriores" }));
    const dialogo = await screen.findByRole("dialog", { name: "Confirmar" });
    expect(screen.getByTestId("confirmar-cuantos")).toHaveTextContent("Se cambiarán 7 registros tuyos");
    expect(dialogo).toHaveTextContent("solo tú los veas");
    expect(A.aplicarPreferencia).not.toHaveBeenCalled(); // todavia nada
    await u.click(screen.getByRole("button", { name: "Cambiar 7" }));
    await waitFor(() => expect(A.aplicarPreferencia).toHaveBeenCalledWith(7));
    expect(await screen.findByText(/7 registros cambiaron/)).toBeInTheDocument();
  });

  it("cancelar la confirmacion no cambia nada", async () => {
    const u = userEvent.setup();
    A.obtenerPrivacidad.mockResolvedValue({ visibilidad_defecto: "solo_yo", registros_distintos: 2 });
    abrir();
    await u.click(await screen.findByRole("button", { name: "Aplicar a mis registros anteriores" }));
    await u.click(await screen.findByRole("button", { name: "Cancelar" }));
    expect(A.aplicarPreferencia).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Confirmar" })).not.toBeInTheDocument();
  });

  it("si la cantidad cambio mientras tanto (409) lo dice y muestra la nueva", async () => {
    const u = userEvent.setup();
    A.obtenerPrivacidad.mockResolvedValueOnce({ visibilidad_defecto: "solo_yo", registros_distintos: 2 });
    A.obtenerPrivacidad.mockResolvedValue({ visibilidad_defecto: "solo_yo", registros_distintos: 3 });
    A.aplicarPreferencia.mockRejectedValue(new ErrorApi(409, "Ahora se afectarían 3 registros y no 2: revisa y confirma de nuevo"));
    abrir();
    await u.click(await screen.findByRole("button", { name: "Aplicar a mis registros anteriores" }));
    await u.click(await screen.findByRole("button", { name: "Cambiar 2" }));
    expect(await screen.findByText(/Ahora se afectarían 3 registros/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("cuantos-afecta")).toHaveTextContent("cambiaría 3 registros tuyos"));
  });
});

describe("Privacidad: aviso honesto", () => {
  it("dice que la privacidad es entre usuarios y que quien administra el servidor puede acceder a la base", async () => {
    abrir();
    const aviso = await screen.findByTestId("aviso-privacidad");
    expect(aviso).toHaveTextContent("entre las personas que usan la app");
    expect(aviso).toHaveTextContent("ni siquiera el administrador de tu familia");
    expect(aviso).toHaveTextContent("Quien administra el servidor puede acceder técnicamente a la base de datos");
  });

  it("si no carga muestra el error", async () => {
    A.obtenerPrivacidad.mockRejectedValue(new ErrorApi(500, "Error del servidor"));
    abrir();
    expect(await screen.findByRole("alert")).toHaveTextContent("Error del servidor");
  });
});
