import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { admin, itemDe, renderPantalla } from "../../test/ayudas";
import type { Yo } from "../auth/api";
import * as familia from "../familia/api";
import * as actividad from "./actividad";
import PaginaLista from "./PaginaLista";

const sesion = vi.hoisted(() => ({ usuario: null as Yo | null }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => sesion }));
vi.mock("./actividad", () => ({ listarActividad: vi.fn() }));
vi.mock("./api", () => ({ anularMovimiento: vi.fn(), reactivarMovimiento: vi.fn() }));
vi.mock("../apoyos/api", () => ({ anularApoyo: vi.fn(), reactivarApoyo: vi.fn() }));
vi.mock("../familia/api", () => ({ listarMiembros: vi.fn(), listarCategorias: vi.fn() }));
vi.mock("../historial/api", () => ({ cadenaHistorial: vi.fn() }));

const listar = vi.mocked(actividad.listarActividad);
const pagina = (items: ReturnType<typeof itemDe>[], hay_mas = false) => ({ items, total: items.length, hay_mas });

// hoy = 8 nov (en La Paz); ayer = 7 nov; y el 3 nov. El 5 nov no hay nada.
const hoyGasto = itemDe({ id: 1, titulo: "Almuerzo", monto: 45, fecha: "2026-11-08", usuario_id: 1, usuario_nombre: "Ana Maria de los Angeles Perez" });
const hoyIngreso = itemDe({ id: 2, tipo: "ingreso", titulo: "Sueldo", monto: 1000.1, fecha: "2026-11-08", usuario_id: 2, usuario_nombre: "Beto Miembro", categoria_nombre: null, categoria_icono: null });
const ayerGasto = itemDe({ id: 3, titulo: "Taxi", monto: 30, fecha: "2026-11-07", usuario_id: 1, usuario_nombre: "Ana Maria de los Angeles Perez" });
const ayerApoyo = itemDe({ clase: "apoyo", id: 4, tipo: "apoyo", titulo: "Tia Rosa", monto: 200, fecha: "2026-11-07", beneficiario: "Tia Rosa", estado: "Pendiente", pendiente: 200, devoluciones_activas: 0, categoria_nombre: null, categoria_icono: null });
const ayerAnulado = itemDe({ id: 5, titulo: "Duplicado", monto: 999, fecha: "2026-11-07", anulado: true });
const viejo = itemDe({ id: 6, titulo: "Pasajes", monto: 12.5, fecha: "2026-11-03", usuario_id: 2, usuario_nombre: "Beto Miembro" });
const TODOS = [hoyGasto, hoyIngreso, ayerGasto, ayerApoyo, ayerAnulado, viejo];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); // solo el reloj: hoy = 8 nov 2026 (11:00 en La Paz)
  vi.setSystemTime(new Date("2026-11-08T15:00:00Z"));
  sesion.usuario = admin;
  listar.mockResolvedValue(pagina(TODOS));
  vi.mocked(familia.listarMiembros).mockResolvedValue([
    { usuario_id: 1, nombre: "Ana Admin", email: "a@t.com", rol: "admin", activo: true },
    { usuario_id: 2, nombre: "Beto Miembro", email: "b@t.com", rol: "miembro", activo: true },
  ]);
  vi.mocked(familia.listarCategorias).mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

const abrir = () => renderPantalla(<PaginaLista />, { ruta: "/todos", hoy: "2026-11-08" });
const dia = (nombre: string) => screen.getByRole("region", { name: `Movimientos de ${nombre}` });

describe("Lista: encabezados por dia con su total", () => {
  it("un encabezado por dia (Hoy, Ayer, 3 nov), en orden, y ninguno para un dia sin movimientos", async () => {
    abrir();
    await screen.findByText("Almuerzo");
    const titulos = screen.getAllByTestId("encabezado-dia").map((h) => within(h).getByRole("heading", { level: 2 }).textContent);
    expect(titulos).toEqual(["Hoy", "Ayer", "3 nov"]);
    expect(screen.queryByRole("heading", { name: "5 nov" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1); // el titulo de la pantalla sigue siendo uno solo
  });

  it("cada dia muestra su total (ingresos suman; gastos y apoyos restan; lo anulado no cuenta)", async () => {
    abrir();
    await screen.findByText("Almuerzo");
    expect(within(dia("Hoy")).getByTestId("total-dia")).toHaveTextContent("+Bs 955.10"); // 1,000.10 - 45
    expect(within(dia("Ayer")).getByTestId("total-dia")).toHaveTextContent("-Bs 230.00"); // -30 -200 (el anulado de 999 no entra)
    expect(within(dia("3 nov")).getByTestId("total-dia")).toHaveTextContent("-Bs 12.50");
    expect(within(dia("Hoy")).getByTestId("total-dia")).toHaveTextContent("Total del día"); // y se lee como total para lectores de pantalla
  });

  it("las filas no cambian: mismos data-testid, mismo conteo, cada una bajo su dia", async () => {
    abrir();
    await screen.findByText("Almuerzo");
    expect(screen.getAllByTestId("fila-lista")).toHaveLength(6);
    expect(within(dia("Hoy")).getAllByTestId("fila-lista")).toHaveLength(2);
    expect(within(dia("Ayer")).getAllByTestId("fila-lista")).toHaveLength(3);
    expect(within(dia("3 nov")).getAllByTestId("fila-lista")).toHaveLength(1);
    expect(screen.getByTestId("total-lista")).toHaveTextContent("6 registros");
  });

  it("no se pide nada nuevo a la API: el mismo pedido de siempre", async () => {
    abrir();
    await screen.findByText("Almuerzo");
    expect(listar).toHaveBeenCalledTimes(1);
    expect(listar).toHaveBeenCalledWith({ desde: "2026-11-01", hasta: "2026-11-30", usuario: "", tipo: "", categoria: "", verAnulados: false }, 0, 20);
  });

  it("un dia solo con anulados lleva encabezado pero sin total", async () => {
    listar.mockResolvedValue(pagina([hoyGasto, ayerAnulado]));
    abrir();
    await screen.findByText("Almuerzo");
    expect(within(dia("Ayer")).getByRole("heading", { name: "Ayer" })).toBeInTheDocument();
    expect(within(dia("Ayer")).queryByTestId("total-dia")).not.toBeInTheDocument();
  });

  it("con 'Cargar mas', el ultimo dia no muestra total hasta tener todas sus filas; luego si, ya completo", async () => {
    const u = userEvent.setup();
    listar.mockResolvedValueOnce(pagina([hoyGasto, ayerGasto, viejo], true));
    listar.mockResolvedValueOnce(pagina([itemDe({ id: 7, titulo: "Cena", monto: 7.5, fecha: "2026-11-03" })], false));
    abrir();
    await screen.findByText("Almuerzo");
    expect(within(dia("Hoy")).getByTestId("total-dia")).toHaveTextContent("-Bs 45.00");
    expect(within(dia("3 nov")).queryByTestId("total-dia")).not.toBeInTheDocument(); // puede seguir en la pagina que falta
    await u.click(screen.getByRole("button", { name: "Cargar más" }));
    await screen.findByText("Cena");
    expect(within(dia("3 nov")).getAllByTestId("fila-lista")).toHaveLength(2); // el mismo dia, ahora completo
    expect(within(dia("3 nov")).getByTestId("total-dia")).toHaveTextContent("-Bs 20.00"); // 12.50 + 7.50
  });
});

describe("Lista: autor abreviado", () => {
  const fila = (titulo: string) => screen.getAllByTestId("fila-lista").find((f) => within(f).queryByText(titulo, { exact: true }))!;

  it("se ve el nombre de pila; el nombre completo queda en title y en el texto para lectores de pantalla", async () => {
    abrir();
    await screen.findByText("Almuerzo");
    const f = fila("Almuerzo");
    const autor = within(f).getByTitle("Ana Maria de los Angeles Perez");
    expect(autor.firstChild).toHaveTextContent("Ana");
    expect(autor.querySelector(".solo-lectores")).toHaveTextContent("Maria de los Angeles Perez");
    expect(f).toHaveTextContent("Comida · Ana Maria de los Angeles Perez"); // nada se pierde del texto de la fila
  });

  it("con UNA persona filtrada el autor no se ve (sin title) pero sigue en el texto para lectores de pantalla", async () => {
    const u = userEvent.setup();
    abrir();
    await screen.findByText("Almuerzo");
    await u.click(screen.getByRole("button", { name: /^Persona:/ }));
    await u.click(within(screen.getByRole("dialog", { name: "Persona" })).getByRole("radio", { name: "Ana Admin" }));
    await waitFor(() => expect(listar).toHaveBeenLastCalledWith(expect.objectContaining({ usuario: "1" }), 0, 20));
    await waitFor(() => expect(within(fila("Almuerzo")).queryByTitle("Ana Maria de los Angeles Perez")).not.toBeInTheDocument());
    const f = fila("Almuerzo");
    expect(f.textContent).toContain("Ana Maria de los Angeles Perez");
    expect(Array.from(f.querySelectorAll(".solo-lectores")).some((e) => e.textContent?.includes("Ana Maria de los Angeles Perez"))).toBe(true);
  });

  it("la fecha de la fila ya no se ve (la dice el encabezado del dia) pero sigue para lectores de pantalla", async () => {
    abrir();
    await screen.findByText("Almuerzo");
    const sr = Array.from(fila("Almuerzo").querySelectorAll(".solo-lectores")).map((e) => e.textContent);
    expect(sr.some((t) => /· .+/.test(t ?? "") && /nov|Hoy|Ayer/.test(t ?? ""))).toBe(true);
  });
});

describe("Lista: 'Ver anulados' como chip", () => {
  it("es un interruptor accesible dentro del grupo de filtros, el primero, y ya no es una tarjeta", async () => {
    abrir();
    await screen.findByText("Almuerzo");
    const filtros = screen.getByRole("group", { name: "Filtros" });
    const sw = within(filtros).getByRole("switch", { name: "Ver anulados" });
    expect(filtros.firstElementChild).toContainElement(sw);
    expect(sw).not.toBeChecked();
    expect(screen.getByLabelText("Ver anulados")).toBe(sw);
    expect(sw.closest(".rounded-tarjeta")).toBeNull(); // antes vivia en una tarjeta aparte
  });

  it("tocarlo vuelve a pedir la lista con anulados y el chip se ve activo (con marca, no solo color)", async () => {
    const u = userEvent.setup();
    abrir();
    await screen.findByText("Almuerzo");
    const sw = screen.getByRole("switch", { name: "Ver anulados" });
    const chip = sw.parentElement!.querySelector("span")!;
    expect(chip.className).toMatch(/border-stone-300/);
    await u.click(sw);
    expect(sw).toBeChecked();
    await waitFor(() => expect(listar).toHaveBeenLastCalledWith(expect.objectContaining({ verAnulados: true }), 0, 20));
    expect(chip.className).toMatch(/bg-arca-claro/);
    expect(chip.textContent).toContain("✓");
    expect(screen.getByRole("switch", { name: "Ver anulados" })).toHaveAccessibleName("Ver anulados"); // la marca no cambia el nombre
  });

  it("con el teclado se activa con Espacio y 'Quitar filtros' lo apaga", async () => {
    const u = userEvent.setup();
    listar.mockResolvedValue(pagina([]));
    abrir();
    const sw = await screen.findByRole("switch", { name: "Ver anulados" });
    sw.focus();
    await u.keyboard(" ");
    expect(sw).toBeChecked();
    await u.click(await screen.findByRole("button", { name: "Quitar filtros" }));
    expect(screen.getByRole("switch", { name: "Ver anulados" })).not.toBeChecked();
  });
});
