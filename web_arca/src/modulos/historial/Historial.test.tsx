import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { admin, miembro, renderPantalla } from "../../test/ayudas";
import type { Yo } from "../auth/api";
import * as familia from "../familia/api";
import * as api from "./api";
import DialogoHistorial from "./DialogoHistorial";
import PaginaActividadFamilia from "./PaginaActividadFamilia";

const sesion = vi.hoisted(() => ({ usuario: null as Yo | null }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => sesion }));
vi.mock("../familia/api", () => ({ listarMiembros: vi.fn() }));
vi.mock("./api", () => ({ cadenaHistorial: vi.fn(), actividadFamilia: vi.fn() }));
const A = vi.mocked(api);

const fecha = new Date(2026, 10, 3, 14, 5).toISOString();
const entrada = (id: number, c: Partial<api.EntradaHistorial> = {}): api.EntradaHistorial => ({
  id, entidad: "movimiento", entidad_id: 7, accion: "editar", usuario_id: 1, usuario_nombre: "Ana Admin", fecha, cambios: {},
  motivo: null, etiqueta: "Gasto: Almuerzo (Bs 45.00)", ...c,
});
const pagina = (items: api.EntradaHistorial[], total = items.length, hay_mas = false): api.PaginaHistorial => ({ items, total, hay_mas });

describe("DialogoHistorial (Ver historial)", () => {
  beforeEach(() => {
    A.cadenaHistorial.mockReset();
  });
  const abrir = (alCerrar = vi.fn()) =>
    render(<DialogoHistorial pedido={{ entidad: "movimiento", id: 7, titulo: "Almuerzo · Bs 45.00" }} alCerrar={alCerrar} />);

  it("pide la cadena del registro y la muestra en el orden recibido (cronologico)", async () => {
    A.cadenaHistorial.mockResolvedValue(pagina([
      entrada(1, { accion: "crear", cambios: { monto: { antes: null, despues: "45.00" } } }),
      entrada(2, { accion: "editar", cambios: { monto: { antes: "45.00", despues: "60.00" } } }),
      entrada(3, { accion: "anular", motivo: "Duplicado", cambios: { anulado: { antes: false, despues: true } } }),
    ]));
    abrir();
    await screen.findAllByTestId("entrada-historial");
    expect(A.cadenaHistorial).toHaveBeenCalledWith("movimiento", 7);
    expect(screen.getAllByTestId("entrada-historial").map((e) => e.getAttribute("data-accion"))).toEqual(["crear", "editar", "anular"]);
    expect(screen.getByTestId("titulo-historial")).toHaveTextContent("Almuerzo · Bs 45.00");
    expect(screen.getByText("Monto: Bs 45.00 → Bs 60.00")).toBeInTheDocument();
    expect(screen.getByText("Motivo: Duplicado")).toBeInTheDocument();
  });

  it("un registro anterior a la funcion de historial lo explica (no inventa nada)", async () => {
    A.cadenaHistorial.mockResolvedValue(pagina([]));
    abrir();
    expect(await screen.findByText("Sin historial: este registro es anterior a la función de historial.")).toBeInTheDocument();
  });

  it("muestra el error si no se puede cargar y 'Cerrar' lo cierra", async () => {
    const u = userEvent.setup();
    const cerrar = vi.fn();
    A.cadenaHistorial.mockRejectedValue(new Error("Sin conexión con el servidor"));
    abrir(cerrar);
    expect(await screen.findByRole("alert")).toHaveTextContent("Sin conexión con el servidor");
    await u.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(cerrar).toHaveBeenCalled();
  });
});

describe("Actividad de la familia (solo admin)", () => {
  beforeEach(() => {
    vi.mocked(familia.listarMiembros).mockResolvedValue([
      { usuario_id: 1, nombre: "Ana Admin", email: "a@t.com", rol: "admin", activo: true },
      { usuario_id: 2, nombre: "Beto Miembro", email: "b@t.com", rol: "miembro", activo: true },
    ]);
    A.actividadFamilia.mockReset();
    A.actividadFamilia.mockResolvedValue(pagina([entrada(9, { accion: "anular" }), entrada(8, { accion: "crear" })]));
  });
  const abrir = (usuario: Yo) => {
    sesion.usuario = usuario;
    return renderPantalla(<PaginaActividadFamilia />, { ruta: "/familia/actividad" });
  };

  it("un miembro es devuelto a Familia sin pedir nada al servidor", () => {
    abrir(miembro);
    expect(screen.getByTestId("otra-pantalla")).toBeInTheDocument();
    expect(A.actividadFamilia).not.toHaveBeenCalled();
  });

  it("el admin ve la actividad con el nombre de cada registro", async () => {
    abrir(admin);
    expect(await screen.findAllByTestId("entrada-historial")).toHaveLength(2);
    expect(screen.getAllByText("Gasto: Almuerzo (Bs 45.00)")).toHaveLength(2);
    expect(screen.getByTestId("total-actividad")).toHaveTextContent("2 entradas");
    expect(A.actividadFamilia).toHaveBeenCalledWith({ entidad: "", accion: "", usuario: "" }, 0, 20);
  });

  it("los filtros vuelven a pedir desde el principio", async () => {
    const u = userEvent.setup();
    abrir(admin);
    await screen.findAllByTestId("entrada-historial");
    // los filtros son chips que abren una hoja de opciones (antes eran <select>)
    const elegir = async (chip: RegExp, hoja: string, opcion: string) => {
      await u.click(screen.getByRole("button", { name: chip }));
      await u.click(within(screen.getByRole("dialog", { name: hoja })).getByRole("radio", { name: opcion }));
    };
    await elegir(/^Qué:/, "Qué", "Apoyos");
    await waitFor(() => expect(A.actividadFamilia).toHaveBeenLastCalledWith({ entidad: "apoyo", accion: "", usuario: "" }, 0, 20));
    await elegir(/^Acción:/, "Acción", "Anuló");
    await waitFor(() => expect(A.actividadFamilia).toHaveBeenLastCalledWith({ entidad: "apoyo", accion: "anular", usuario: "" }, 0, 20));
    await elegir(/^Quién:/, "Quién", "Beto Miembro");
    await waitFor(() => expect(A.actividadFamilia).toHaveBeenLastCalledWith({ entidad: "apoyo", accion: "anular", usuario: "2" }, 0, 20));
  });

  it("'Cargar mas' trae la siguiente pagina y la agrega", async () => {
    const u = userEvent.setup();
    A.actividadFamilia.mockResolvedValueOnce(pagina([entrada(3), entrada(2)], 3, true));
    A.actividadFamilia.mockResolvedValueOnce(pagina([entrada(1)], 3, false));
    abrir(admin);
    await screen.findAllByTestId("entrada-historial");
    await u.click(screen.getByRole("button", { name: "Cargar más" }));
    await waitFor(() => expect(screen.getAllByTestId("entrada-historial")).toHaveLength(3));
    expect(A.actividadFamilia).toHaveBeenLastCalledWith(expect.anything(), 2, 20);
    expect(screen.queryByRole("button", { name: "Cargar más" })).not.toBeInTheDocument();
  });

  it("sin actividad avisa; con error lo muestra", async () => {
    A.actividadFamilia.mockResolvedValueOnce(pagina([]));
    const { unmount } = abrir(admin);
    expect(await screen.findByText("No hay actividad con estos filtros.")).toBeInTheDocument();
    unmount();
    A.actividadFamilia.mockRejectedValueOnce(new Error("Solo un administrador puede ver la actividad de la familia"));
    abrir(admin);
    expect(await screen.findByRole("alert")).toHaveTextContent("Solo un administrador");
  });

  it("una clave cambiada se ve solo como 'clave cambiada'", async () => {
    A.actividadFamilia.mockResolvedValue(pagina([entrada(5, { entidad: "usuario", accion: "cambiar_clave", cambios: { clave: "clave cambiada" }, etiqueta: "Usuario Ana" })]));
    abrir(admin);
    const li = await screen.findByTestId("entrada-historial");
    expect(within(li).getByText("Clave: clave cambiada")).toBeInTheDocument();
  });
});
