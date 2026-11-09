import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

beforeEach(() => {
  sesion.usuario = admin;
  vi.mocked(actividad.listarActividad).mockResolvedValue({ items: [itemDe({ id: 1, titulo: "Almuerzo" })], total: 1, hay_mas: false });
  vi.mocked(familia.listarMiembros).mockResolvedValue([]);
  vi.mocked(familia.listarCategorias).mockResolvedValue([]);
});

describe("Lista completa (/todos): '< Volver' como las subpantallas", () => {
  it("tiene el encabezado con 'Volver' y el titulo una sola vez (no se duplica)", async () => {
    renderPantalla(<PaginaLista />, { ruta: "/todos", hoy: "2026-11-08" });
    await screen.findByText("Almuerzo");
    expect(screen.getByRole("button", { name: "Volver" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Todos los movimientos" })).toBeInTheDocument();
    expect(screen.getAllByText("Todos los movimientos")).toHaveLength(1);
  });

  it("Volver lleva a Inicio cuando se abrio la ruta directamente (recarga o enlace)", async () => {
    const u = userEvent.setup();
    renderPantalla(<PaginaLista />, { ruta: "/todos", hoy: "2026-11-08" });
    await screen.findByText("Almuerzo");
    await u.click(screen.getByRole("button", { name: "Volver" }));
    expect(screen.getByTestId("ruta-actual")).toHaveTextContent(/^\/$/);
  });

  it("el boton Volver mide al menos 44 px de alto (min-h-[44px]) y sigue habiendo selector de periodo y filtros", async () => {
    renderPantalla(<PaginaLista />, { ruta: "/todos", hoy: "2026-11-08" });
    await screen.findByText("Almuerzo");
    expect(screen.getByRole("button", { name: "Volver" }).className).toMatch(/min-h-\[44px\]/);
    expect(screen.getByTestId("selector-periodo")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Filtros" })).toBeInTheDocument();
  });
});
