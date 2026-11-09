// Pantallas propias de Familia: Miembros, Categorias, Agregar miembro, Agregar categoria y Mi perfil.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { admin, miembro, renderPantalla } from "../../test/ayudas";
import * as authApi from "../auth/api";
import type { Yo } from "../auth/api";
import * as api from "./api";
import PaginaCategoriaNueva from "./PaginaCategoriaNueva";
import PaginaCategorias from "./PaginaCategorias";
import PaginaMiembroNuevo from "./PaginaMiembroNuevo";
import PaginaMiembros from "./PaginaMiembros";
import PaginaPerfil from "./PaginaPerfil";

const sesion = vi.hoisted(() => ({ usuario: null as Yo | null, actualizarUsuario: vi.fn() }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => sesion }));
vi.mock("../auth/api", () => ({ cambiarClave: vi.fn(), cambiarNombre: vi.fn() }));
vi.mock("./api", () => ({
  listarCategorias: vi.fn(), listarMiembros: vi.fn(), crearCategoria: vi.fn(), editarCategoria: vi.fn(),
  invitar: vi.fn(), editarMiembro: vi.fn(), restablecerClave: vi.fn(),
}));

const A = vi.mocked(api);
const MIEMBROS: api.MiembroFamilia[] = [
  { usuario_id: 1, nombre: "Ana Admin", email: "ana@t.com", rol: "admin", activo: true },
  { usuario_id: 2, nombre: "Beto Miembro", email: "beto@t.com", rol: "miembro", activo: true },
  { usuario_id: 3, nombre: "Carla Baja", email: "carla@t.com", rol: "miembro", activo: false },
];
const CATEGORIAS: api.Categoria[] = [
  { id: 1, nombre: "Transporte", icono: "bus", activa: true },
  { id: 2, nombre: "Antojos", icono: "cookie", activa: false },
];

function abrir(ui: React.ReactElement, ruta: string, usuario: Yo = admin) {
  sesion.usuario = usuario;
  return renderPantalla(ui, { ruta });
}
const ruta = () => screen.getByTestId("ruta-actual").textContent;
const opciones = async (u: ReturnType<typeof userEvent.setup>, etiqueta: string) => {
  await u.click(await screen.findByRole("button", { name: etiqueta }));
  return screen.getAllByRole("menuitem").map((i) => i.textContent);
};

beforeEach(() => {
  sesion.actualizarUsuario.mockReset();
  A.listarCategorias.mockResolvedValue(CATEGORIAS);
  A.listarMiembros.mockResolvedValue(MIEMBROS);
});

describe("Miembros", () => {
  const abrirMiembros = (usuario: Yo = admin) => abrir(<PaginaMiembros />, "/familia/miembros", usuario);

  it("tiene encabezado '< Volver' y titulo, y muestra rol y estado (el desactivado tachado)", async () => {
    abrirMiembros();
    expect(screen.getByRole("heading", { name: "Miembros" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Volver" })).toBeInTheDocument();
    await screen.findByText("Beto Miembro");
    const filas = screen.getAllByTestId("fila-miembro");
    expect(filas.map((f) => f.getAttribute("data-activo"))).toEqual(["true", "true", "false"]);
    expect(filas[0]).toHaveTextContent("Admin");
    expect(filas[1]).toHaveTextContent("Miembro");
    expect(filas[2]).toHaveTextContent("Desactivado");
    expect(within(filas[2]).getByText("Carla Baja").className).toMatch(/line-through/);
  });

  it("'Volver' sin historial previo (pagina recargada) lleva al menu de Familia", async () => {
    const u = userEvent.setup();
    abrirMiembros();
    await u.click(screen.getByRole("button", { name: "Volver" }));
    expect(ruta()).toBe("/familia");
  });

  it("el admin tiene el boton principal fijo 'Agregar miembro' que abre su propia pantalla (no hay formulario abierto)", async () => {
    abrirMiembros();
    await screen.findByText("Beto Miembro");
    const boton = screen.getByRole("link", { name: "Agregar miembro" });
    expect(boton).toHaveAttribute("href", "/familia/miembros/nuevo");
    expect(boton.className).toContain("min-h-[56px]");
    expect(boton.closest(".fixed")).not.toBeNull(); // fijo abajo
    expect(document.querySelector("form")).toBeNull();
    expect(screen.getByRole("button", { name: "Acciones de Beto Miembro" })).toBeInTheDocument();
  });

  it("el miembro solo ve: sin boton de agregar y sin menus", async () => {
    abrirMiembros(miembro);
    await screen.findByText("Beto Miembro");
    expect(screen.queryByRole("link", { name: "Agregar miembro" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Acciones de/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Solo un administrador puede agregar o cambiar miembros/)).toBeInTheDocument();
  });

  it("opciones segun el miembro: rol opuesto y desactivar/reactivar", async () => {
    const u = userEvent.setup();
    abrirMiembros();
    expect(await opciones(u, "Acciones de Beto Miembro")).toEqual(["Hacer administrador", "Desactivar", "Restablecer clave"]);
    await u.click(screen.getByRole("button", { name: "Cerrar menu" }));
    expect(await opciones(u, "Acciones de Ana Admin")).toEqual(["Pasar a miembro", "Desactivar", "Restablecer clave"]);
    await u.click(screen.getByRole("button", { name: "Cerrar menu" }));
    expect(await opciones(u, "Acciones de Carla Baja")).toEqual(["Hacer administrador", "Reactivar", "Restablecer clave"]);
  });

  it("cambiar rol, desactivar y reactivar llaman a la API con los datos correctos", async () => {
    const u = userEvent.setup();
    A.editarMiembro.mockResolvedValue(MIEMBROS[1]);
    abrirMiembros();
    await opciones(u, "Acciones de Beto Miembro");
    await u.click(screen.getByRole("menuitem", { name: "Hacer administrador" }));
    await waitFor(() => expect(A.editarMiembro).toHaveBeenLastCalledWith(2, { rol: "admin" }));
    expect(await screen.findByText("Beto Miembro ahora es administrador")).toBeInTheDocument();
    await opciones(u, "Acciones de Beto Miembro");
    await u.click(screen.getByRole("menuitem", { name: "Desactivar" }));
    await waitFor(() => expect(A.editarMiembro).toHaveBeenLastCalledWith(2, { activo: false }));
    await opciones(u, "Acciones de Carla Baja");
    await u.click(screen.getByRole("menuitem", { name: "Reactivar" }));
    await waitFor(() => expect(A.editarMiembro).toHaveBeenLastCalledWith(3, { activo: true }));
  });

  it("si el servidor impide desactivar al ultimo admin, lo muestra", async () => {
    const u = userEvent.setup();
    A.editarMiembro.mockRejectedValue(new Error("No puedes desactivar ni degradar al último administrador"));
    abrirMiembros();
    await opciones(u, "Acciones de Ana Admin");
    await u.click(screen.getByRole("menuitem", { name: "Desactivar" }));
    expect(await screen.findByText("No puedes desactivar ni degradar al último administrador")).toBeInTheDocument();
  });

  it("restablecer clave pide confirmacion y muestra la temporal una sola vez", async () => {
    const u = userEvent.setup();
    A.restablecerClave.mockResolvedValue({ clave_temporal: "Ab3dEf9x" });
    abrirMiembros();
    await opciones(u, "Acciones de Beto Miembro");
    await u.click(screen.getByRole("menuitem", { name: "Restablecer clave" }));
    const c = screen.getByRole("dialog", { name: "Restablecer clave" });
    expect(within(c).getByTestId("mensaje-confirmar")).toHaveTextContent("¿Restablecer la clave de Beto Miembro? La clave actual dejará de servir.");
    expect(A.restablecerClave).not.toHaveBeenCalled(); // hasta confirmar no se toca la clave
    await u.click(within(c).getByRole("button", { name: "Confirmar" }));
    const d = await screen.findByRole("dialog", { name: "Clave temporal" });
    expect(within(d).getByTestId("clave-temporal")).toHaveTextContent("Ab3dEf9x");
    expect(d).toHaveTextContent("Entrega esta clave a Beto Miembro");
    await u.click(within(d).getByRole("button", { name: "Listo" }));
    expect(screen.queryByText("Ab3dEf9x")).not.toBeInTheDocument();
  });

  it("si se cancela la confirmacion no se restablece nada", async () => {
    const u = userEvent.setup();
    abrirMiembros();
    await opciones(u, "Acciones de Beto Miembro");
    await u.click(screen.getByRole("menuitem", { name: "Restablecer clave" }));
    await u.click(within(screen.getByRole("dialog", { name: "Restablecer clave" })).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog", { name: "Restablecer clave" })).not.toBeInTheDocument();
    expect(A.restablecerClave).not.toHaveBeenCalled();
  });

  it("mientras carga muestra esqueletos (no una pantalla en blanco)", async () => {
    A.listarMiembros.mockReturnValue(new Promise(() => {}));
    abrirMiembros();
    expect(screen.getByText("Cargando...")).toBeInTheDocument();
    expect(document.querySelectorAll(".esqueleto").length).toBeGreaterThan(0);
  });
});

describe("Agregar miembro", () => {
  const abrirNuevo = (usuario: Yo = admin) => abrir(<PaginaMiembroNuevo />, "/familia/miembros/nuevo", usuario);

  it("manda nombre, correo, clave temporal y rol; avisa y vuelve a Miembros", async () => {
    const u = userEvent.setup();
    A.invitar.mockResolvedValue(MIEMBROS[1]);
    abrirNuevo();
    expect(screen.getByRole("heading", { name: "Agregar miembro" })).toBeInTheDocument();
    await u.type(screen.getByLabelText("Nombre"), "  Diego  ");
    await u.type(screen.getByLabelText("Correo"), "diego@t.com");
    await u.type(screen.getByLabelText(/Contraseña temporal/), "temporal1");
    await u.selectOptions(screen.getByLabelText("Rol"), "admin");
    await u.click(screen.getByRole("button", { name: "Agregar miembro" }));
    await waitFor(() => expect(A.invitar).toHaveBeenCalledWith("Diego", "diego@t.com", "temporal1", "admin"));
    await waitFor(() => expect(ruta()).toBe("/familia/miembros"));
    expect(await screen.findByText("Miembro agregado")).toBeInTheDocument();
  });

  it("muestra el error del servidor (correo repetido) y se queda en el formulario", async () => {
    const u = userEvent.setup();
    A.invitar.mockRejectedValue(new Error("Ya existe una cuenta con ese correo"));
    abrirNuevo();
    await u.type(screen.getByLabelText("Nombre"), "Diego");
    await u.type(screen.getByLabelText("Correo"), "diego@t.com");
    await u.type(screen.getByLabelText(/Contraseña temporal/), "temporal1");
    await u.click(screen.getByRole("button", { name: "Agregar miembro" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ya existe una cuenta con ese correo");
    expect(ruta()).toBe("/familia/miembros/nuevo");
  });

  it("la clave temporal se puede mostrar u ocultar", async () => {
    const u = userEvent.setup();
    abrirNuevo();
    const campo = screen.getByLabelText(/Contraseña temporal/);
    expect(campo).toHaveAttribute("type", "text"); // el admin la ve al escribirla
    await u.click(screen.getByRole("button", { name: "Ocultar clave" }));
    expect(campo).toHaveAttribute("type", "password");
  });

  it("un miembro que entra por la URL vuelve a Miembros (solo el admin agrega)", () => {
    abrirNuevo(miembro);
    expect(ruta()).toBe("/familia/miembros");
  });
});

describe("Categorias", () => {
  const abrirCats = (usuario: Yo = admin) => abrir(<PaginaCategorias />, "/familia/categorias", usuario);

  it("una categoria desactivada se ve tachada y '(desactivada)'", async () => {
    abrirCats();
    expect(screen.getByRole("heading", { name: "Categorías" })).toBeInTheDocument();
    await screen.findByText("Transporte");
    const filas = screen.getAllByTestId("fila-categoria");
    expect(filas.map((f) => f.getAttribute("data-activa"))).toEqual(["true", "false"]);
    expect(filas[1]).toHaveTextContent("Antojos (desactivada)");
  });

  it("el admin tiene el boton fijo 'Agregar categoria' hacia su propia pantalla; el miembro no", async () => {
    abrirCats();
    await screen.findByText("Transporte");
    expect(screen.getByRole("link", { name: "Agregar categoría" })).toHaveAttribute("href", "/familia/categorias/nueva");
    expect(document.querySelector("form")).toBeNull();
  });

  it("el miembro solo ve (sin boton ni menus)", async () => {
    abrirCats(miembro);
    await screen.findByText("Transporte");
    expect(screen.queryByRole("link", { name: "Agregar categoría" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Acciones de/ })).not.toBeInTheDocument();
  });

  it("opciones: activa -> Desactivar; desactivada -> Reactivar (nunca borrar)", async () => {
    const u = userEvent.setup();
    abrirCats();
    expect(await opciones(u, "Acciones de Transporte")).toEqual(["Editar nombre e icono", "Desactivar"]);
    await u.click(screen.getByRole("button", { name: "Cerrar menu" }));
    expect(await opciones(u, "Acciones de Antojos")).toEqual(["Editar nombre e icono", "Reactivar"]);
  });

  it("desactivar y reactivar mandan activa false/true", async () => {
    const u = userEvent.setup();
    A.editarCategoria.mockResolvedValue(CATEGORIAS[0]);
    abrirCats();
    await opciones(u, "Acciones de Transporte");
    await u.click(screen.getByRole("menuitem", { name: "Desactivar" }));
    await waitFor(() => expect(A.editarCategoria).toHaveBeenLastCalledWith(1, { activa: false }));
    expect(await screen.findByText("Categoría desactivada")).toBeInTheDocument();
    await opciones(u, "Acciones de Antojos");
    await u.click(screen.getByRole("menuitem", { name: "Reactivar" }));
    await waitFor(() => expect(A.editarCategoria).toHaveBeenLastCalledWith(2, { activa: true }));
  });

  it("renombrar y cambiar icono envia nombre sin espacios e icono elegido", async () => {
    const u = userEvent.setup();
    A.editarCategoria.mockResolvedValue(CATEGORIAS[0]);
    abrirCats();
    await opciones(u, "Acciones de Transporte");
    await u.click(screen.getByRole("menuitem", { name: "Editar nombre e icono" }));
    const campo = screen.getByLabelText("Nombre de la categoría");
    expect(campo).toHaveValue("Transporte");
    await u.clear(campo);
    await u.type(campo, "  Pasajes ");
    const fila = screen.getAllByTestId("fila-categoria")[0];
    await u.click(within(fila).getByRole("radio", { name: "car" }));
    await u.click(within(fila).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(A.editarCategoria).toHaveBeenCalledWith(1, { nombre: "Pasajes", icono: "car" }));
  });

  it("sin categorias: estado vacio amable con la accion de agregar", async () => {
    A.listarCategorias.mockResolvedValue([]);
    abrirCats();
    const vacio = await screen.findByTestId("estado-vacio");
    expect(vacio).toHaveTextContent("Aún no hay categorías.");
    expect(within(vacio).getByRole("link", { name: "Agregar categoría" })).toHaveAttribute("href", "/familia/categorias/nueva");
  });
});

describe("Agregar categoria", () => {
  const abrirNueva = (usuario: Yo = admin) => abrir(<PaginaCategoriaNueva />, "/familia/categorias/nueva", usuario);

  it("manda nombre e icono; un nombre repetido muestra el error DEBAJO del campo y reintentar funciona", async () => {
    const u = userEvent.setup();
    A.crearCategoria.mockRejectedValueOnce(new Error("Ya existe una categoría con ese nombre")).mockResolvedValueOnce(CATEGORIAS[0]);
    abrirNueva();
    await u.type(screen.getByLabelText("Nombre"), "Ropa");
    await u.click(screen.getByRole("radio", { name: "shirt" }));
    await u.click(screen.getByRole("button", { name: "Agregar categoría" }));
    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("Ya existe una categoría con ese nombre");
    expect(alerta.className).toContain("before:content-['⚠']"); // icono + texto, nunca solo color
    expect(screen.getByLabelText("Nombre")).toHaveAttribute("aria-invalid", "true");
    expect(A.crearCategoria).toHaveBeenCalledWith("Ropa", "shirt");
    await u.click(screen.getByRole("button", { name: "Agregar categoría" }));
    await waitFor(() => expect(ruta()).toBe("/familia/categorias"));
    expect(await screen.findByText("Categoría creada")).toBeInTheDocument();
  });

  it("un miembro que entra por la URL vuelve a Categorias", () => {
    abrirNueva(miembro);
    expect(ruta()).toBe("/familia/categorias");
  });
});

describe("Mi perfil", () => {
  const abrirPerfil = () => abrir(<PaginaPerfil />, "/familia/perfil");

  it("muestra quien soy y tiene '< Volver'", () => {
    abrirPerfil();
    expect(screen.getByRole("heading", { name: "Mi perfil" })).toBeInTheDocument();
    expect(screen.getByText("ana@t.com")).toBeInTheDocument();
    expect(screen.getByText(/Administrador · Familia Prueba/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Volver" })).toBeInTheDocument();
  });

  it("cambiar el nombre actualiza la sesion", async () => {
    const u = userEvent.setup();
    vi.mocked(authApi.cambiarNombre).mockResolvedValue({ ...admin, nombre: "Ana Nueva" });
    abrirPerfil();
    const campo = screen.getByLabelText("Mi nombre");
    expect(campo).toHaveValue("Ana Admin");
    await u.clear(campo);
    await u.type(campo, "  Ana Nueva ");
    await u.click(screen.getByRole("button", { name: "Guardar nombre" }));
    await waitFor(() => expect(authApi.cambiarNombre).toHaveBeenCalledWith("Ana Nueva"));
    await waitFor(() => expect(sesion.actualizarUsuario).toHaveBeenCalledWith({ ...admin, nombre: "Ana Nueva" }));
  });

  it("si la clave nueva y su repeticion no coinciden, no llama a la API y lo dice debajo del campo", async () => {
    const u = userEvent.setup();
    abrirPerfil();
    await u.type(screen.getByLabelText("Clave actual"), "vieja123");
    await u.type(screen.getByLabelText("Clave nueva (mínimo 8)"), "nueva1234");
    await u.type(screen.getByLabelText("Repite la clave nueva"), "otra12345");
    await u.click(screen.getByRole("button", { name: "Cambiar clave" }));
    expect(await screen.findByText("La clave nueva y su repetición no coinciden")).toBeInTheDocument();
    expect(authApi.cambiarClave).not.toHaveBeenCalled();
  });

  it("cambia la clave con la actual y limpia los campos; si la actual esta mal, el error sale debajo de ese campo", async () => {
    const u = userEvent.setup();
    vi.mocked(authApi.cambiarClave).mockRejectedValueOnce(new Error("La clave actual no es correcta")).mockResolvedValueOnce(undefined);
    abrirPerfil();
    await u.type(screen.getByLabelText("Clave actual"), "mala");
    await u.type(screen.getByLabelText("Clave nueva (mínimo 8)"), "nueva1234");
    await u.type(screen.getByLabelText("Repite la clave nueva"), "nueva1234");
    await u.click(screen.getByRole("button", { name: "Cambiar clave" }));
    expect(await screen.findByText("La clave actual no es correcta")).toBeInTheDocument();
    await u.clear(screen.getByLabelText("Clave actual"));
    await u.type(screen.getByLabelText("Clave actual"), "vieja123");
    await u.click(screen.getByRole("button", { name: "Cambiar clave" }));
    await waitFor(() => expect(authApi.cambiarClave).toHaveBeenLastCalledWith("vieja123", "nueva1234"));
    expect(await screen.findByText("Clave actualizada")).toBeInTheDocument();
    expect(screen.getByLabelText("Clave actual")).toHaveValue("");
  });

  it("las claves tienen boton para mostrar u ocultar", async () => {
    const u = userEvent.setup();
    abrirPerfil();
    const actual = screen.getByLabelText("Clave actual");
    expect(actual).toHaveAttribute("type", "password");
    await u.click(screen.getAllByRole("button", { name: "Mostrar clave" })[0]);
    expect(actual).toHaveAttribute("type", "text");
    expect(screen.getAllByRole("button", { name: /clave$/ })[0]).toHaveAttribute("aria-pressed", "true");
  });
});
