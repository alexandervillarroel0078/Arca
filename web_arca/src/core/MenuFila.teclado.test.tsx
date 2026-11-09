import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import MenuFila from "./MenuFila";

const acciones = (extra: Partial<Parameters<typeof MenuFila>[0]["acciones"][number]> = {}) => [
  { texto: "Editar", alAccionar: vi.fn(), ...extra },
  { texto: "Ver historial", alAccionar: vi.fn() },
  { texto: "Anular", peligro: true, alAccionar: vi.fn() },
];

async function abrir(acc = acciones()) {
  const u = userEvent.setup();
  render(<MenuFila etiqueta="Acciones de Taxi" acciones={acc} />);
  const boton = screen.getByRole("button", { name: "Acciones de Taxi" });
  await u.click(boton);
  return { u, boton };
}

describe("MenuFila: teclado y foco", () => {
  it("al abrir el foco va a la primera accion", async () => {
    await abrir();
    expect(screen.getByRole("menuitem", { name: "Editar" })).toHaveFocus();
  });

  it("flechas abajo/arriba se mueven entre las acciones y dan la vuelta; Inicio y Fin saltan a los extremos", async () => {
    const { u } = await abrir();
    await u.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Ver historial" })).toHaveFocus();
    await u.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Anular" })).toHaveFocus();
    await u.keyboard("{ArrowDown}"); // del ultimo vuelve al primero
    expect(screen.getByRole("menuitem", { name: "Editar" })).toHaveFocus();
    await u.keyboard("{ArrowUp}"); // del primero va al ultimo
    expect(screen.getByRole("menuitem", { name: "Anular" })).toHaveFocus();
    await u.keyboard("{Home}");
    expect(screen.getByRole("menuitem", { name: "Editar" })).toHaveFocus();
    await u.keyboard("{End}");
    expect(screen.getByRole("menuitem", { name: "Anular" })).toHaveFocus();
  });

  it("Escape cierra el menu y el foco vuelve al boton ...", async () => {
    const { u, boton } = await abrir();
    await u.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(boton).toHaveFocus();
    expect(boton).toHaveAttribute("aria-expanded", "false");
  });

  it("Tab cierra el menu y deja el foco en el boton ...", async () => {
    const { u, boton } = await abrir();
    await u.tab();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(boton).toHaveFocus();
  });

  it("Enter en una accion la ejecuta, cierra el menu y el foco ya esta de vuelta en el boton ...", async () => {
    const u = userEvent.setup();
    let focoAlAccionar: Element | null = null;
    const acc = acciones();
    acc[1].alAccionar = vi.fn(() => { focoAlAccionar = document.activeElement; });
    render(<MenuFila etiqueta="Acciones de Taxi" acciones={acc} />);
    const boton = screen.getByRole("button", { name: "Acciones de Taxi" });
    await u.click(boton);
    await u.keyboard("{ArrowDown}{Enter}");
    expect(acc[1].alAccionar).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(focoAlAccionar).toBe(boton); // un dialogo que se abra ahora recordara este boton para devolverle el foco
    expect(boton).toHaveFocus();
  });

  it("tocar fuera cierra sin ejecutar nada y el boton de fondo no es una parada de Tab", async () => {
    const { u } = await abrir();
    expect(screen.getByRole("button", { name: "Cerrar menu" })).toHaveAttribute("tabindex", "-1");
    await u.click(screen.getByRole("button", { name: "Cerrar menu" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("tocar de nuevo el boton ... lo cierra", async () => {
    const { u, boton } = await abrir();
    await u.click(boton);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
