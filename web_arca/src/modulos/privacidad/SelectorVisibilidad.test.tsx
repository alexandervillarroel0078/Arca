// Fase 17: selector "Quién lo ve" y pantalla para elegir personas.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { admin, miembro } from "../../test/ayudas";
import type { Yo } from "../auth/api";
import * as fam from "../familia/api";
import { EtiquetaPrivacidad, NotaPrivados } from "./Etiquetas";
import SelectorVisibilidad, { type Seleccion } from "./SelectorVisibilidad";

const sesion = vi.hoisted(() => ({ usuario: null as Yo | null }));
vi.mock("../auth/AuthContext", () => ({ useUsuarioOpcional: () => sesion.usuario, useAuth: () => sesion }));
vi.mock("../familia/api", () => ({ listarMiembros: vi.fn() }));

const gente = [
  { usuario_id: 1, nombre: "Ana Admin", email: "a@t.com", rol: "admin" as const, activo: true },
  { usuario_id: 2, nombre: "Beto Miembro", email: "b@t.com", rol: "miembro" as const, activo: true },
  { usuario_id: 3, nombre: "Carla", email: "c@t.com", rol: "miembro" as const, activo: true },
  { usuario_id: 4, nombre: "Dario Inactivo", email: "d@t.com", rol: "miembro" as const, activo: false },
];

beforeEach(() => {
  sesion.usuario = miembro; // id 2
  vi.mocked(fam.listarMiembros).mockReset();
  vi.mocked(fam.listarMiembros).mockResolvedValue(gente);
});

describe("SelectorVisibilidad", () => {
  const abrir = (valor: Seleccion = { visibilidad: "familia", compartido_con: [] }) => {
    const alCambiar = vi.fn();
    const r = render(<SelectorVisibilidad valor={valor} alCambiar={alCambiar} />);
    return { alCambiar, ...r };
  };

  it("ofrece Solo yo, Familia y Personas... con la elegida marcada", () => {
    abrir();
    expect(screen.getByRole("radiogroup", { name: "Quién lo ve" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Solo yo/ })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radio", { name: /Familia/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /Personas/ })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("resumen-visibilidad")).toHaveTextContent("Toda la familia lo ve");
  });

  it("Solo yo y Familia cambian al instante y vacian la lista de personas", async () => {
    const u = userEvent.setup();
    const { alCambiar } = abrir({ visibilidad: "elegidas", compartido_con: [3] });
    await u.click(screen.getByRole("radio", { name: /Solo yo/ }));
    expect(alCambiar).toHaveBeenCalledWith({ visibilidad: "solo_yo", compartido_con: [] });
    await u.click(screen.getByRole("radio", { name: /Familia/ }));
    expect(alCambiar).toHaveBeenCalledWith({ visibilidad: "familia", compartido_con: [] });
  });

  it("Personas... abre la pantalla: solo miembros activos y distintos de ti", async () => {
    const u = userEvent.setup();
    abrir();
    await u.click(screen.getByRole("radio", { name: /Personas/ }));
    const dialogo = await screen.findByRole("dialog", { name: "Elegir personas" });
    expect(await screen.findByRole("checkbox", { name: "Ana Admin" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Carla" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Beto Miembro" })).not.toBeInTheDocument(); // tu mismo
    expect(screen.queryByRole("checkbox", { name: "Dario Inactivo" })).not.toBeInTheDocument(); // desactivado
    expect(dialogo).toHaveTextContent("tampoco el administrador");
  });

  it("no se puede terminar sin elegir a alguien; al elegir devuelve las personas", async () => {
    const u = userEvent.setup();
    const { alCambiar } = abrir();
    await u.click(screen.getByRole("radio", { name: /Personas/ }));
    const listo = await screen.findByRole("button", { name: /Elige al menos una persona/ });
    expect(listo).toBeDisabled();
    await u.click(await screen.findByRole("checkbox", { name: "Ana Admin" }));
    await u.click(screen.getByRole("checkbox", { name: "Carla" }));
    await u.click(screen.getByRole("button", { name: "Listo (2)" }));
    expect(alCambiar).toHaveBeenCalledWith({ visibilidad: "elegidas", compartido_con: [1, 3] });
    expect(screen.queryByRole("dialog", { name: "Elegir personas" })).not.toBeInTheDocument();
  });

  it("accesible: el foco entra a Volver, Tab no sale de la pantalla, Escape vuelve sin cambiar nada y el foco regresa a quien la abrio", async () => {
    const u = userEvent.setup();
    const { alCambiar } = abrir();
    const personas = screen.getByRole("radio", { name: /Personas/ });
    await u.click(personas);
    const dialogo = await screen.findByRole("dialog", { name: "Elegir personas" });
    expect(dialogo.className).toContain("!m-0"); // sin el margen de 8 px que le ponia `space-y-2` del selector
    const volver = screen.getByRole("button", { name: "Volver" });
    await waitFor(() => expect(volver).toHaveFocus());

    // Tab recorre Volver, las personas y el boton de abajo, y despues vuelve a Volver (no sale hacia el fondo)
    await screen.findByRole("checkbox", { name: "Ana Admin" });
    await u.tab();
    expect(screen.getByRole("checkbox", { name: "Ana Admin" })).toHaveFocus();
    await u.tab();
    expect(screen.getByRole("checkbox", { name: "Carla" })).toHaveFocus();
    await u.tab({ shift: true });
    await u.tab({ shift: true });
    expect(volver).toHaveFocus();
    await u.tab({ shift: true }); // desde el primero, hacia atras: da la vuelta al ultimo de la pantalla
    expect(dialogo).toContainElement(document.activeElement as HTMLElement);

    await u.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Elegir personas" })).not.toBeInTheDocument();
    expect(alCambiar).not.toHaveBeenCalled();
    expect(personas).toHaveFocus();
  });

  it("volver sin elegir no cambia nada", async () => {
    const u = userEvent.setup();
    const { alCambiar } = abrir();
    await u.click(screen.getByRole("radio", { name: /Personas/ }));
    await u.click(await screen.findByRole("button", { name: "Volver" }));
    expect(alCambiar).not.toHaveBeenCalled();
  });

  it("con personas elegidas resume los nombres y permite cambiarlas", async () => {
    const u = userEvent.setup();
    abrir({ visibilidad: "elegidas", compartido_con: [1, 3] });
    await waitFor(() => expect(screen.getByTestId("resumen-visibilidad")).toHaveTextContent("Solo Ana Admin y Carla"));
    await u.click(screen.getByRole("button", { name: "Cambiar personas" }));
    expect(await screen.findByRole("checkbox", { name: "Ana Admin" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Carla" })).toBeChecked();
  });

  it("todos los controles miden 44px o mas de alto (clases de tamano)", () => {
    abrir();
    for (const r of screen.getAllByRole("radio")) expect(r.className).toMatch(/min-h-\[(4[4-9]|5\d)px\]/);
  });
});

describe("EtiquetaPrivacidad y NotaPrivados", () => {
  const dato = (c = {}) => ({ usuario_id: 2, usuario_nombre: "Beto Miembro", ...c });

  it("el dueno ve 'Solo tú' y 'Compartido con N'", () => {
    const { rerender } = render(<EtiquetaPrivacidad registro={dato({ visibilidad: "solo_yo" })} />);
    expect(screen.getByTestId("etiqueta-privacidad")).toHaveTextContent("Solo tú");
    rerender(<EtiquetaPrivacidad registro={dato({ visibilidad: "elegidas", compartido_con: [1, 3] })} />);
    expect(screen.getByTestId("etiqueta-privacidad")).toHaveTextContent("Compartido con 2");
  });
  it("quien recibe lo compartido ve 'Compartido por X'", () => {
    sesion.usuario = admin;
    render(<EtiquetaPrivacidad registro={dato({ visibilidad: "elegidas" })} />);
    expect(screen.getByTestId("etiqueta-privacidad")).toHaveTextContent("Compartido por Beto Miembro");
  });
  it("lo de la familia no muestra nada", () => {
    const { container } = render(<EtiquetaPrivacidad registro={dato({ visibilidad: "familia" })} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("NotaPrivados dice cuantos y no aparece sin ninguno", () => {
    const { container, rerender } = render(<NotaPrivados n={3} />);
    expect(screen.getByTestId("nota-privados")).toHaveTextContent("Incluye tus 3 registros privados");
    rerender(<NotaPrivados n={0} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<NotaPrivados n={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
