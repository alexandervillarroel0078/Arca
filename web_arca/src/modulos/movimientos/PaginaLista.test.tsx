import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { admin, itemDe, miembro, renderPantalla } from "../../test/ayudas";
import * as apoyos from "../apoyos/api";
import type { Yo } from "../auth/api";
import * as familia from "../familia/api";
import * as hist from "../historial/api";
import * as actividad from "./actividad";
import * as mov from "./api";
import PaginaLista from "./PaginaLista";

const sesion = vi.hoisted(() => ({ usuario: null as Yo | null }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => sesion }));
vi.mock("./actividad", () => ({ listarActividad: vi.fn() }));
vi.mock("./api", () => ({ anularMovimiento: vi.fn(), reactivarMovimiento: vi.fn() }));
vi.mock("../apoyos/api", () => ({ anularApoyo: vi.fn(), reactivarApoyo: vi.fn() }));
vi.mock("../familia/api", () => ({ listarMiembros: vi.fn(), listarCategorias: vi.fn() }));
vi.mock("../historial/api", () => ({ cadenaHistorial: vi.fn() }));

const listar = vi.mocked(actividad.listarActividad);
const pagina = (items: ReturnType<typeof itemDe>[], extra: { total?: number; hay_mas?: boolean } = {}) => ({
  items, total: extra.total ?? items.length, hay_mas: extra.hay_mas ?? false,
});
const abrir = (usuario: Yo = admin) => {
  sesion.usuario = usuario;
  return renderPantalla(<PaginaLista />, { ruta: "/todos", hoy: "2026-11-08" });
};
const filaDe = (titulo: string) => screen.getAllByTestId("fila-lista").find((f) => within(f).queryByText(titulo, { exact: true }))!;
const opciones = async (u: ReturnType<typeof userEvent.setup>, titulo: string) => {
  await u.click(await screen.findByRole("button", { name: `Acciones de ${titulo}` }));
  return screen.getAllByRole("menuitem").map((i) => i.textContent);
};

// datos base: un gasto del admin, un ingreso del miembro y un apoyo del admin
const gastoAdmin = itemDe({ id: 1, titulo: "Almuerzo", monto: 45, usuario_id: 1 });
const ingresoMiembro = itemDe({ id: 2, tipo: "ingreso", titulo: "Sueldo", monto: 1000, usuario_id: 2, usuario_nombre: "Beto Miembro", categoria_nombre: null, categoria_icono: null });
const apoyoAdmin = itemDe({ clase: "apoyo", id: 5, tipo: "apoyo", titulo: "Tia Rosa", monto: 300, beneficiario: "Tia Rosa", estado: "Pendiente", pendiente: 200, devoluciones_activas: 2, categoria_nombre: null, categoria_icono: null });

beforeEach(() => {
  listar.mockResolvedValue(pagina([gastoAdmin, ingresoMiembro, apoyoAdmin]));
  vi.mocked(familia.listarMiembros).mockResolvedValue([
    { usuario_id: 1, nombre: "Ana Admin", email: "a@t.com", rol: "admin", activo: true },
    { usuario_id: 2, nombre: "Beto Miembro", email: "b@t.com", rol: "miembro", activo: true },
  ]);
  vi.mocked(familia.listarCategorias).mockResolvedValue([
    { id: 2, nombre: "Comida", icono: "utensils", activa: true },
    { id: 3, nombre: "Antojos", icono: "cookie", activa: false },
  ]);
  vi.mocked(hist.cadenaHistorial).mockResolvedValue({ items: [], total: 0, hay_mas: false });
});

describe("Lista completa: contenido", () => {
  it("muestra cada fila con su signo, monto y detalle", async () => {
    abrir();
    expect(await screen.findByText("Almuerzo")).toBeInTheDocument();
    expect(filaDe("Almuerzo")).toHaveTextContent("-Bs 45.00");
    expect(filaDe("Almuerzo")).toHaveTextContent("Comida · Ana Admin");
    expect(filaDe("Sueldo")).toHaveTextContent("+Bs 1,000.00");
    expect(filaDe("Sueldo")).toHaveTextContent("Ingreso · Beto Miembro");
    expect(filaDe("Tia Rosa")).toHaveTextContent("-Bs 300.00");
    expect(filaDe("Tia Rosa")).toHaveTextContent("Apoyo");
    expect(filaDe("Tia Rosa")).toHaveTextContent("Pendiente");
    expect(screen.getByTestId("total-lista")).toHaveTextContent("3 registros");
  });

  it("el primer pedido es del periodo actual (desde y hasta), 20 por pagina, sin anulados", async () => {
    abrir();
    await screen.findByText("Almuerzo");
    expect(listar).toHaveBeenCalledWith(
      { desde: "2026-11-01", hasta: "2026-11-30", usuario: "", tipo: "", categoria: "", verAnulados: false }, 0, 20,
    );
  });

  it("sin resultados avisa; con un solo registro usa singular", async () => {
    listar.mockResolvedValue(pagina([]));
    abrir();
    expect(await screen.findByText("No hay movimientos en este periodo.")).toBeInTheDocument();
  });

  it("singular", async () => {
    listar.mockResolvedValue(pagina([gastoAdmin]));
    abrir();
    expect(await screen.findByTestId("total-lista")).toHaveTextContent("1 registro");
    expect(screen.getByTestId("total-lista")).not.toHaveTextContent("registros");
  });

  it("muestra quien edito un registro", async () => {
    listar.mockResolvedValue(pagina([itemDe({ editado_por_nombre: "Beto Miembro", editado_en: new Date(2026, 10, 4, 9, 30).toISOString() })]));
    abrir();
    expect(await screen.findByText("Editado por Beto Miembro · 4 nov 09:30")).toBeInTheDocument();
  });

  it("un error de carga se muestra", async () => {
    listar.mockRejectedValue(new Error("Sin conexión con el servidor"));
    abrir();
    expect(await screen.findByRole("alert")).toHaveTextContent("Sin conexión con el servidor");
  });
});

describe("Lista completa: registros anulados", () => {
  const anulado = itemDe({
    id: 7, titulo: "Cena", monto: 80, usuario_id: 1, anulado: true, anulado_por_nombre: "Ana Admin",
    anulado_en: new Date(2026, 10, 3, 14, 5).toISOString(), motivo_anulacion: "Duplicado",
  });

  it("se ve gris y tachado, con quien, cuando y por que", async () => {
    listar.mockResolvedValue(pagina([anulado]));
    abrir();
    const fila = (await screen.findAllByTestId("fila-lista"))[0];
    expect(fila).toHaveAttribute("data-anulado", "true");
    expect(within(fila).getByText("Cena").className).toMatch(/line-through/);
    expect(fila).toHaveTextContent("Anulado por Ana Admin · 3 nov 14:05 · Duplicado");
    expect(fila.className).toMatch(/bg-stone-100/);
  });

  it("la casilla 'Ver anulados' vuelve a pedir la lista incluyendo anulados", async () => {
    const u = userEvent.setup();
    abrir();
    await screen.findByText("Almuerzo");
    await u.click(screen.getByLabelText("Ver anulados"));
    await waitFor(() => expect(listar).toHaveBeenLastCalledWith(expect.objectContaining({ verAnulados: true }), 0, 20));
  });

  it("de un anulado se ofrece Reactivar (no Editar ni Anular) y llama a la API correcta", async () => {
    const u = userEvent.setup();
    listar.mockResolvedValue(pagina([anulado, { ...apoyoAdmin, anulado: true }]));
    vi.mocked(mov.reactivarMovimiento).mockResolvedValue({} as never);
    vi.mocked(apoyos.reactivarApoyo).mockResolvedValue({} as never);
    abrir();
    expect(await opciones(u, "Cena")).toEqual(["Reactivar", "Ver historial"]);
    await u.click(screen.getByRole("menuitem", { name: "Reactivar" }));
    await waitFor(() => expect(mov.reactivarMovimiento).toHaveBeenCalledWith(7));
    expect(await screen.findByText("Reactivado")).toBeInTheDocument();
    await u.click(await screen.findByRole("button", { name: "Acciones de Tia Rosa" }));
    await u.click(screen.getByRole("menuitem", { name: "Reactivar" }));
    await waitFor(() => expect(apoyos.reactivarApoyo).toHaveBeenCalledWith(5));
  });
});

describe("Lista completa: permisos del menu '...'", () => {
  it("admin: puede editar y anular lo de cualquiera", async () => {
    const u = userEvent.setup();
    abrir(admin);
    expect(await opciones(u, "Almuerzo")).toEqual(["Editar", "Compartir...", "Ver historial", "Anular"]); // es del admin
    await u.click(screen.getByRole("button", { name: "Cerrar menu" }));
    expect(await opciones(u, "Sueldo")).toEqual(["Editar", "Ver historial", "Anular"]); // es del miembro: sin "Compartir..."
  });

  it("miembro: lo suyo si; lo del admin solo 'Ver historial'", async () => {
    const u = userEvent.setup();
    abrir(miembro); // id 2: dueno del ingreso
    expect(await opciones(u, "Sueldo")).toEqual(["Editar", "Compartir...", "Ver historial", "Anular"]);
    await u.click(screen.getByRole("button", { name: "Cerrar menu" }));
    expect(await opciones(u, "Almuerzo")).toEqual(["Ver historial"]);
    await u.click(screen.getByRole("button", { name: "Cerrar menu" }));
    expect(await opciones(u, "Tia Rosa")).toEqual(["Ver historial"]);
  });

  it("miembro: un anulado ajeno tampoco se puede reactivar", async () => {
    const u = userEvent.setup();
    listar.mockResolvedValue(pagina([itemDe({ id: 8, titulo: "Cena", usuario_id: 1, anulado: true })]));
    abrir(miembro);
    expect(await opciones(u, "Cena")).toEqual(["Ver historial"]);
  });

  it("'Ver historial' abre el dialogo del registro correcto (clase e id)", async () => {
    const u = userEvent.setup();
    abrir(miembro);
    await opciones(u, "Tia Rosa");
    await u.click(screen.getByRole("menuitem", { name: "Ver historial" }));
    expect(await screen.findByRole("dialog", { name: "Historial" })).toBeInTheDocument();
    expect(hist.cadenaHistorial).toHaveBeenCalledWith("apoyo", 5);
    expect(screen.getByTestId("titulo-historial")).toHaveTextContent("Tia Rosa · Bs 300.00");
  });

  it("Editar lleva a la pantalla de edicion segun la clase", async () => {
    const u = userEvent.setup();
    abrir(admin);
    await opciones(u, "Almuerzo");
    await u.click(screen.getByRole("menuitem", { name: "Editar" }));
    expect(screen.getByTestId("ruta-actual")).toHaveTextContent("/editar/movimiento/1");
  });
});

describe("Lista completa: anular", () => {
  it("movimiento: la confirmacion muestra nombre y monto, manda el motivo y ofrece Reactivar", async () => {
    const u = userEvent.setup();
    vi.mocked(mov.anularMovimiento).mockResolvedValue({} as never);
    vi.mocked(mov.reactivarMovimiento).mockResolvedValue({} as never);
    abrir(admin);
    await opciones(u, "Almuerzo");
    await u.click(screen.getByRole("menuitem", { name: "Anular" }));
    const d = screen.getByRole("dialog", { name: "Anular gasto" });
    expect(within(d).getByTestId("detalle-anular")).toHaveTextContent("Almuerzo · Bs 45.00");
    expect(within(d).queryByRole("alert")).not.toBeInTheDocument();
    await u.type(within(d).getByLabelText("Motivo (opcional)"), "Duplicado");
    await u.click(within(d).getByRole("button", { name: "Anular" }));
    await waitFor(() => expect(mov.anularMovimiento).toHaveBeenCalledWith(1, "Duplicado"));
    expect(await screen.findByText("Anulado")).toBeInTheDocument(); // aviso con boton Reactivar
    await u.click(screen.getByRole("button", { name: "Reactivar" }));
    await waitFor(() => expect(mov.reactivarMovimiento).toHaveBeenCalledWith(1));
    expect(listar.mock.calls.length).toBeGreaterThan(2); // recarga la lista tras cada cambio
  });

  it("el titulo del dialogo depende del tipo (ingreso)", async () => {
    const u = userEvent.setup();
    abrir(admin);
    await opciones(u, "Sueldo");
    await u.click(screen.getByRole("menuitem", { name: "Anular" }));
    expect(screen.getByRole("dialog", { name: "Anular ingreso" })).toBeInTheDocument();
  });

  it("apoyo con devoluciones: avisa que se anularan tambien y usa la API de apoyos", async () => {
    const u = userEvent.setup();
    vi.mocked(apoyos.anularApoyo).mockResolvedValue({} as never);
    abrir(admin);
    await opciones(u, "Tia Rosa");
    await u.click(screen.getByRole("menuitem", { name: "Anular" }));
    const d = screen.getByRole("dialog", { name: "Anular apoyo" });
    expect(within(d).getByRole("alert")).toHaveTextContent("Se anularán también 2 devoluciones de este apoyo.");
    await u.click(within(d).getByRole("button", { name: "Anular" }));
    await waitFor(() => expect(apoyos.anularApoyo).toHaveBeenCalledWith(5, ""));
    expect(mov.anularMovimiento).not.toHaveBeenCalled();
  });

  it("apoyo sin devoluciones: sin advertencia", async () => {
    const u = userEvent.setup();
    listar.mockResolvedValue(pagina([{ ...apoyoAdmin, devoluciones_activas: 0 }]));
    abrir(admin);
    await opciones(u, "Tia Rosa");
    await u.click(screen.getByRole("menuitem", { name: "Anular" }));
    expect(within(screen.getByRole("dialog", { name: "Anular apoyo" })).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("si el servidor rechaza (403), el dialogo muestra el error y no anula", async () => {
    const u = userEvent.setup();
    vi.mocked(mov.anularMovimiento).mockRejectedValue(new Error("Solo puedes modificar lo que registraste tu"));
    abrir(admin);
    await opciones(u, "Almuerzo");
    await u.click(screen.getByRole("menuitem", { name: "Anular" }));
    await u.click(within(screen.getByRole("dialog", { name: "Anular gasto" })).getByRole("button", { name: "Anular" }));
    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent("Solo puedes modificar");
    expect(screen.queryByText("Anulado")).not.toBeInTheDocument();
  });
});

/** Los filtros son chips: se toca el chip y se elige en la lista de opciones que se abre. */
async function elegir(u: ReturnType<typeof userEvent.setup>, filtro: string, opcion: string) {
  await u.click(screen.getByRole("button", { name: new RegExp(`^${filtro}:`) }));
  const hoja = await screen.findByRole("dialog", { name: filtro });
  await u.click(within(hoja).getByRole("radio", { name: opcion }));
  expect(screen.queryByRole("dialog", { name: filtro })).not.toBeInTheDocument(); // al elegir se cierra
}
const chip = (filtro: string) => screen.getByRole("button", { name: new RegExp(`^${filtro}:`) });

describe("Lista completa: filtros y paginacion", () => {
  it("cambiar tipo, persona y periodo vuelve a pedir con esos filtros desde el principio", async () => {
    const u = userEvent.setup();
    abrir();
    await screen.findByText("Almuerzo");
    await elegir(u, "Tipo", "Gastos");
    await waitFor(() => expect(listar).toHaveBeenLastCalledWith(expect.objectContaining({ tipo: "gasto" }), 0, 20));
    await elegir(u, "Persona", "Beto Miembro");
    await waitFor(() => expect(listar).toHaveBeenLastCalledWith(expect.objectContaining({ tipo: "gasto", usuario: "2" }), 0, 20));
    await u.click(screen.getByLabelText("Periodo anterior"));
    await waitFor(() =>
      expect(listar).toHaveBeenLastCalledWith(expect.objectContaining({ desde: "2026-10-01", hasta: "2026-10-31", tipo: "gasto", usuario: "2" }), 0, 20),
    );
    expect(chip("Tipo")).toHaveTextContent("Tipo: Gastos");
  });

  it("los chips estan en una fila deslizable y miden 44px o mas", async () => {
    abrir();
    await screen.findByText("Almuerzo");
    const grupo = screen.getByRole("group", { name: "Filtros" });
    expect(grupo.className).toContain("overflow-x-auto");
    expect(within(grupo).getAllByRole("button")).toHaveLength(3); // Persona, Tipo, Categoria (el periodo tiene su selector comun)
    for (const b of within(grupo).getAllByRole("button")) expect(b.className).toContain("min-h-[44px]");
  });

  it("la hoja de opciones marca la elegida y se puede cerrar sin elegir", async () => {
    const u = userEvent.setup();
    abrir();
    await screen.findByText("Almuerzo");
    await u.click(chip("Tipo"));
    const hoja = screen.getByRole("dialog", { name: "Tipo" });
    expect(within(hoja).getByRole("radio", { name: "Todos los tipos" })).toHaveAttribute("aria-checked", "true");
    await u.click(screen.getByRole("button", { name: "Cerrar hoja" }));
    expect(screen.queryByRole("dialog", { name: "Tipo" })).not.toBeInTheDocument();
    expect(listar).toHaveBeenCalledTimes(1); // no pidio nada nuevo
  });

  it("filtro por categoria; se deshabilita y se limpia al elegir apoyos o ingresos", async () => {
    const u = userEvent.setup();
    abrir();
    await screen.findByText("Almuerzo");
    await elegir(u, "Categoría", "Comida");
    await waitFor(() => expect(listar).toHaveBeenLastCalledWith(expect.objectContaining({ categoria: "2" }), 0, 20));
    await elegir(u, "Tipo", "Apoyos");
    await waitFor(() => expect(listar).toHaveBeenLastCalledWith(expect.objectContaining({ tipo: "apoyo", categoria: "" }), 0, 20));
    expect(chip("Categoría")).toBeDisabled();
    await elegir(u, "Tipo", "Gastos");
    expect(chip("Categoría")).toBeEnabled();
  });

  it("las categorias desactivadas siguen disponibles como filtro (son historial)", async () => {
    const u = userEvent.setup();
    abrir();
    await screen.findByText("Almuerzo");
    await u.click(chip("Categoría"));
    expect(within(screen.getByRole("dialog", { name: "Categoría" })).getByRole("radio", { name: "Antojos (desactivada)" })).toBeInTheDocument();
  });

  it("'Ver anulados' es un interruptor accesible", async () => {
    const u = userEvent.setup();
    abrir();
    await screen.findByText("Almuerzo");
    const sw = screen.getByRole("switch", { name: "Ver anulados" });
    expect(sw).not.toBeChecked();
    await u.click(sw);
    expect(sw).toBeChecked();
  });

  it("'Cargar mas' pide la siguiente pagina (desplazamiento = filas ya cargadas) y la agrega", async () => {
    const u = userEvent.setup();
    listar.mockResolvedValueOnce(pagina([gastoAdmin, ingresoMiembro], { total: 3, hay_mas: true }));
    listar.mockResolvedValueOnce(pagina([apoyoAdmin], { total: 3, hay_mas: false }));
    abrir();
    await screen.findByText("Almuerzo");
    expect(screen.getAllByTestId("fila-lista")).toHaveLength(2);
    await u.click(screen.getByRole("button", { name: "Cargar más" }));
    await waitFor(() => expect(screen.getAllByTestId("fila-lista")).toHaveLength(3));
    expect(listar).toHaveBeenLastCalledWith(expect.anything(), 2, 20);
    expect(screen.queryByRole("button", { name: "Cargar más" })).not.toBeInTheDocument();
    expect(screen.getByTestId("total-lista")).toHaveTextContent("3 registros");
  });

  it("sin mas paginas no aparece 'Cargar mas'", async () => {
    abrir();
    await screen.findByText("Almuerzo");
    expect(screen.queryByRole("button", { name: "Cargar más" })).not.toBeInTheDocument();
  });
});
