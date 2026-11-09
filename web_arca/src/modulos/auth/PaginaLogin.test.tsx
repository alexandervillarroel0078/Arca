import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import PaginaLogin from "./PaginaLogin";

const auth = vi.hoisted(() => ({ entrar: vi.fn(), registrar: vi.fn() }));
vi.mock("./AuthContext", () => ({ useAuth: () => auth }));

describe("PaginaLogin", () => {
  it("entra con correo y contrasena", async () => {
    const u = userEvent.setup();
    auth.entrar.mockResolvedValue(undefined);
    render(<PaginaLogin />);
    await u.type(screen.getByLabelText("Correo"), "ana@t.com");
    await u.type(screen.getByLabelText("Contraseña"), "secreto1");
    await u.click(screen.getByRole("button", { name: "Entrar" }));
    expect(auth.entrar).toHaveBeenCalledWith("ana@t.com", "secreto1");
    expect(auth.registrar).not.toHaveBeenCalled();
  });

  it("muestra el error del servidor (credenciales incorrectas)", async () => {
    const u = userEvent.setup();
    auth.entrar.mockRejectedValue(new Error("Correo o contrasena incorrectos"));
    render(<PaginaLogin />);
    await u.type(screen.getByLabelText("Correo"), "ana@t.com");
    await u.type(screen.getByLabelText("Contraseña"), "mala");
    await u.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Correo o contrasena incorrectos");
    expect(screen.getByRole("button", { name: "Entrar" })).toBeEnabled();
  });

  it("deshabilita el boton mientras envia (evita doble envio)", async () => {
    const u = userEvent.setup();
    let resolver: () => void = () => {};
    auth.entrar.mockReturnValue(new Promise<void>((r) => { resolver = r; }));
    render(<PaginaLogin />);
    await u.type(screen.getByLabelText("Correo"), "ana@t.com");
    await u.type(screen.getByLabelText("Contraseña"), "secreto1");
    await u.click(screen.getByRole("button", { name: "Entrar" }));
    expect(screen.getByRole("button", { name: "Un momento..." })).toBeDisabled();
    resolver();
    await waitFor(() => expect(screen.getByRole("button", { name: "Entrar" })).toBeEnabled());
  });

  it("cambia a registro: pide nombre y familia, exige 8+ caracteres y llama a registrar", async () => {
    const u = userEvent.setup();
    auth.registrar.mockResolvedValue(undefined);
    render(<PaginaLogin />);
    expect(screen.queryByLabelText("Tu nombre")).not.toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Crear una cuenta nueva" }));
    expect(screen.getByLabelText("Contraseña")).toHaveAttribute("minlength", "8");
    await u.type(screen.getByLabelText("Tu nombre"), "Ana");
    await u.type(screen.getByLabelText("Nombre de la familia (opcional)"), "Los Perez");
    await u.type(screen.getByLabelText("Correo"), "ana@t.com");
    await u.type(screen.getByLabelText("Contraseña"), "secreto1");
    await u.click(screen.getByRole("button", { name: "Crear cuenta y familia" }));
    expect(auth.registrar).toHaveBeenCalledWith("Ana", "ana@t.com", "secreto1", "Los Perez");
  });

  it("volver a 'Ya tengo cuenta' limpia el error y oculta los campos de registro", async () => {
    const u = userEvent.setup();
    auth.entrar.mockRejectedValue(new Error("fallo"));
    render(<PaginaLogin />);
    await u.type(screen.getByLabelText("Correo"), "a@t.com");
    await u.type(screen.getByLabelText("Contraseña"), "x");
    await u.click(screen.getByRole("button", { name: "Entrar" }));
    await screen.findByRole("alert");
    await u.click(screen.getByRole("button", { name: "Crear una cuenta nueva" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Ya tengo cuenta" }));
    expect(screen.queryByLabelText("Tu nombre")).not.toBeInTheDocument();
  });
});
