import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ErrorApi, ErrorRed, token } from "../../core/api";
import * as almacen from "../../core/almacen";
import { leerCache } from "../sync/cache";
import { cantidadEnCola, encolar } from "../sync/cola";
import * as api from "./api";
import { AuthProvider, useAuth } from "./AuthContext";

vi.mock("./api", () => ({ login: vi.fn(), registro: vi.fn(), yo: vi.fn(), logout: vi.fn() }));
const A = vi.mocked(api);

const ana: api.Yo = { id: 1, nombre: "Ana", email: "ana@t.com", familia_id: 1, familia_nombre: "Fam", rol: "admin" };
let auth: ReturnType<typeof useAuth>;
function Espia() {
  auth = useAuth();
  return <p data-testid="estado">{auth.cargando ? "cargando" : auth.usuario ? `dentro:${auth.usuario.nombre}` : "fuera"}</p>;
}
const montar = () => render(<AuthProvider><Espia /></AuthProvider>);

describe("AuthProvider (sesion)", () => {
  it("sin token: no hay sesion y no llama al servidor", () => {
    montar();
    expect(screen.getByTestId("estado")).toHaveTextContent("fuera");
    expect(A.yo).not.toHaveBeenCalled();
  });

  it("entrar guarda el token y el usuario (para poder abrir sin internet)", async () => {
    A.login.mockResolvedValue({ access_token: "tok1", usuario: ana });
    montar();
    await act(async () => { await auth.entrar("ana@t.com", "secreto1"); });
    expect(A.login).toHaveBeenCalledWith("ana@t.com", "secreto1");
    expect(screen.getByTestId("estado")).toHaveTextContent("dentro:Ana");
    expect(token.leer()).toBe("tok1");
    expect(JSON.parse(localStorage.getItem("arca-usuario")!)).toMatchObject({ nombre: "Ana", rol: "admin" });
  });

  it("registrar crea la sesion igual que entrar", async () => {
    A.registro.mockResolvedValue({ access_token: "tok2", usuario: ana });
    montar();
    await act(async () => { await auth.registrar("Ana", "ana@t.com", "secreto1", "Fam"); });
    expect(A.registro).toHaveBeenCalledWith("Ana", "ana@t.com", "secreto1", "Fam");
    expect(token.leer()).toBe("tok2");
  });

  it("un login rechazado no deja sesion a medias", async () => {
    A.login.mockRejectedValue(new ErrorApi(401, "Correo o contrasena incorrectos"));
    montar();
    await expect(act(async () => { await auth.entrar("a@t.com", "mala"); })).rejects.toThrow("Correo o contrasena incorrectos");
    expect(token.leer()).toBeNull();
    expect(screen.getByTestId("estado")).toHaveTextContent("fuera");
  });

  it("con token guardado confirma con el servidor y refresca los datos", async () => {
    token.guardar("tok");
    localStorage.setItem("arca-usuario", JSON.stringify({ ...ana, nombre: "Ana vieja" }));
    A.yo.mockResolvedValue({ ...ana, nombre: "Ana nueva" });
    montar();
    expect(screen.getByTestId("estado")).toHaveTextContent("cargando"); // mientras confirma con el servidor
    await waitFor(() => expect(screen.getByTestId("estado")).toHaveTextContent("dentro:Ana nueva"));
  });

  it("si el servidor dice 401 (token vencido o cuenta desactivada) cierra la sesion", async () => {
    token.guardar("vencido");
    localStorage.setItem("arca-usuario", JSON.stringify(ana));
    A.yo.mockRejectedValue(new ErrorApi(401, "Tu cuenta esta desactivada"));
    montar();
    await waitFor(() => expect(screen.getByTestId("estado")).toHaveTextContent("fuera"));
    expect(token.leer()).toBeNull();
    expect(localStorage.getItem("arca-usuario")).toBeNull();
  });

  it("sin internet NO cierra la sesion: se puede seguir registrando", async () => {
    token.guardar("tok");
    localStorage.setItem("arca-usuario", JSON.stringify(ana));
    A.yo.mockRejectedValue(new ErrorRed());
    montar();
    await waitFor(() => expect(A.yo).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId("estado")).toHaveTextContent("dentro:Ana"));
    expect(token.leer()).toBe("tok");
  });

  it("salir borra token, usuario y las categorias guardadas", async () => {
    token.guardar("tok");
    localStorage.setItem("arca-usuario", JSON.stringify(ana));
    localStorage.setItem("arca-categorias", "[]");
    A.yo.mockResolvedValue(ana);
    montar();
    await waitFor(() => expect(screen.getByTestId("estado")).toHaveTextContent("dentro:Ana"));
    act(() => auth.salir());
    expect(screen.getByTestId("estado")).toHaveTextContent("fuera");
    expect(token.leer()).toBeNull();
    expect(localStorage.getItem("arca-usuario")).toBeNull();
    expect(localStorage.getItem("arca-categorias")).toBeNull();
  });

  it("salir avisa a la bitacora ANTES de borrar el token, y si el aviso falla igual cierra la sesion (Fase 15)", async () => {
    token.guardar("tok");
    localStorage.setItem("arca-usuario", JSON.stringify(ana));
    A.yo.mockResolvedValue(ana);
    let tokenAlLlamar: string | null = "nada";
    A.logout.mockImplementation(() => {
      tokenAlLlamar = token.leer();
      return Promise.reject(new ErrorRed()); // sin internet: la salida simplemente no queda anotada
    });
    montar();
    await waitFor(() => expect(screen.getByTestId("estado")).toHaveTextContent("dentro:Ana"));
    act(() => auth.salir());
    expect(A.logout).toHaveBeenCalledTimes(1);
    expect(tokenAlLlamar).toBe("tok"); // la peticion sale con la sesion todavia valida
    expect(screen.getByTestId("estado")).toHaveTextContent("fuera");
    expect(token.leer()).toBeNull();
  });

  it("una sesion vencida (401) NO llama a logout: no hay sesion valida que anotar", async () => {
    token.guardar("tok");
    localStorage.setItem("arca-usuario", JSON.stringify(ana));
    A.yo.mockRejectedValue(new ErrorApi(401, "No autenticado"));
    montar();
    await waitFor(() => expect(screen.getByTestId("estado")).toHaveTextContent("fuera"));
    expect(A.logout).not.toHaveBeenCalled();
  });

  it("el evento de sesion expirada (un 401 en cualquier llamada) cierra la sesion", async () => {
    token.guardar("tok");
    localStorage.setItem("arca-usuario", JSON.stringify(ana));
    A.yo.mockResolvedValue(ana);
    montar();
    await waitFor(() => expect(screen.getByTestId("estado")).toHaveTextContent("dentro:Ana"));
    act(() => { window.dispatchEvent(new Event("arca-sesion-expirada")); });
    expect(screen.getByTestId("estado")).toHaveTextContent("fuera");
  });

  it("actualizarUsuario cambia el nombre en memoria y en el telefono", async () => {
    token.guardar("tok");
    localStorage.setItem("arca-usuario", JSON.stringify(ana));
    A.yo.mockResolvedValue(ana);
    montar();
    await waitFor(() => expect(screen.getByTestId("estado")).toHaveTextContent("dentro:Ana"));
    act(() => auth.actualizarUsuario({ ...ana, nombre: "Ana Maria" }));
    expect(screen.getByTestId("estado")).toHaveTextContent("dentro:Ana Maria");
    expect(JSON.parse(localStorage.getItem("arca-usuario")!).nombre).toBe("Ana Maria");
  });

  it("useAuth fuera del proveedor da un error claro", () => {
    const silenciar = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Espia />)).toThrow("useAuth fuera de AuthProvider");
    silenciar.mockRestore();
  });
});

describe("AuthProvider: lo guardado sin conexion (Fase 12)", () => {
  const pendiente = () =>
    encolar({ entidad: "movimiento", accion: "crear", uuid: "u1", datos: { tipo: "gasto", monto: 5, fecha: "2026-11-07", categoria_id: 2, nota: null } });

  it("al CERRAR SESION se borran el cache y la cola", async () => {
    A.login.mockResolvedValue({ access_token: "tok1", usuario: ana });
    montar();
    await act(async () => { await auth.entrar("ana@t.com", "secreto1"); });
    await almacen.poner("cache", { clave: "resumen:2026-11", datos: { saldo: 1 }, guardado: Date.now() });
    await pendiente();
    expect(await cantidadEnCola()).toBe(1);
    await act(async () => { auth.salir(); });
    await waitFor(async () => expect(await cantidadEnCola()).toBe(0));
    expect(await leerCache("resumen:2026-11")).toBeUndefined();
    expect(screen.getByTestId("estado")).toHaveTextContent("fuera");
  });

  it("si la sesion VENCE se borra el cache pero se conserva la cola (son cambios del usuario sin enviar)", async () => {
    A.login.mockResolvedValue({ access_token: "tok1", usuario: ana });
    montar();
    await act(async () => { await auth.entrar("ana@t.com", "secreto1"); });
    await almacen.poner("cache", { clave: "resumen:2026-11", datos: { saldo: 1 }, guardado: Date.now() });
    await pendiente();
    await act(async () => { window.dispatchEvent(new Event("arca-sesion-expirada")); });
    await waitFor(() => expect(screen.getByTestId("estado")).toHaveTextContent("fuera"));
    await waitFor(async () => expect(await leerCache("resumen:2026-11")).toBeUndefined());
    expect(await cantidadEnCola()).toBe(1);
  });

  it("si entra OTRA cuenta, los cambios sin enviar de la anterior se descartan con aviso y no se mandan", async () => {
    A.login.mockResolvedValue({ access_token: "tok1", usuario: ana });
    montar();
    await act(async () => { await auth.entrar("ana@t.com", "secreto1"); });
    await pendiente();
    await act(async () => { window.dispatchEvent(new Event("arca-sesion-expirada")); });
    await waitFor(() => expect(screen.getByTestId("estado")).toHaveTextContent("fuera"));
    A.login.mockResolvedValue({ access_token: "tok2", usuario: { ...ana, id: 2, nombre: "Beto" } });
    await act(async () => { await auth.entrar("beto@t.com", "secreto1"); });
    expect(await cantidadEnCola()).toBe(0);
  });
});
