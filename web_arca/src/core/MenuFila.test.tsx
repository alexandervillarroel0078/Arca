import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import MenuFila from "./MenuFila";

describe("MenuFila (boton ...)", () => {
  it("sin acciones no dibuja nada (asi se oculta para quien no tiene permiso)", () => {
    const { container } = render(<MenuFila acciones={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("el boton esta cerrado al inicio y abre la lista de acciones", async () => {
    const u = userEvent.setup();
    render(<MenuFila etiqueta="Acciones de Almuerzo" acciones={[{ texto: "Editar", alAccionar: vi.fn() }, { texto: "Anular", peligro: true, alAccionar: vi.fn() }]} />);
    const boton = screen.getByRole("button", { name: "Acciones de Almuerzo" });
    expect(boton).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await u.click(boton);
    expect(boton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Editar", "Anular"]);
  });

  it("al elegir una accion la ejecuta y cierra el menu", async () => {
    const u = userEvent.setup();
    const anular = vi.fn();
    render(<MenuFila acciones={[{ texto: "Editar", alAccionar: vi.fn() }, { texto: "Anular", alAccionar: anular }]} />);
    await u.click(screen.getByRole("button", { name: "Acciones" }));
    await u.click(screen.getByRole("menuitem", { name: "Anular" }));
    expect(anular).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("tocar fuera cierra el menu sin ejecutar nada", async () => {
    const u = userEvent.setup();
    const accion = vi.fn();
    render(<MenuFila acciones={[{ texto: "Editar", alAccionar: accion }]} />);
    await u.click(screen.getByRole("button", { name: "Acciones" }));
    await u.click(screen.getByRole("button", { name: "Cerrar menu" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(accion).not.toHaveBeenCalled();
  });

  it("las acciones peligrosas se marcan en rojo", async () => {
    const u = userEvent.setup();
    render(<MenuFila acciones={[{ texto: "Anular", peligro: true, alAccionar: vi.fn() }]} />);
    await u.click(screen.getByRole("button", { name: "Acciones" }));
    expect(screen.getByRole("menuitem", { name: "Anular" }).className).toMatch(/text-red-700/);
  });

  it("boton y opciones miden al menos 44px (clase min-h-[44px])", async () => {
    const u = userEvent.setup();
    render(<MenuFila acciones={[{ texto: "Editar", alAccionar: vi.fn() }]} />);
    const boton = screen.getByRole("button", { name: "Acciones" });
    expect(boton.className).toMatch(/min-h-\[44px\]/);
    expect(boton.className).toMatch(/min-w-\[44px\]/);
    await u.click(boton);
    expect(screen.getByRole("menuitem").className).toMatch(/min-h-\[44px\]/);
  });
});
