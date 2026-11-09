import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ChipFiltro, ChipInterruptor } from "./ChipFiltro";

describe("ChipFiltro", () => {
  it("muestra 'Etiqueta: texto ▾' y abre la hoja al tocarlo", async () => {
    const u = userEvent.setup();
    const abrir = vi.fn();
    render(<ChipFiltro etiqueta="Persona" texto="Toda la familia" activo={false} alAbrir={abrir} />);
    const b = screen.getByRole("button", { name: "Persona: Toda la familia" }); // el ▾ es decorativo (aria-hidden)
    expect(b).toHaveAttribute("aria-haspopup", "dialog");
    expect(b.className).toMatch(/min-h-\[44px\]/);
    expect(b.className).toMatch(/whitespace-nowrap/); // el texto no se parte ni se corta con puntos suspensivos
    await u.click(b);
    expect(abrir).toHaveBeenCalledTimes(1);
  });

  it("activo se ve con otro fondo y borde; desactivado no se puede tocar", async () => {
    const u = userEvent.setup();
    const abrir = vi.fn();
    const { rerender } = render(<ChipFiltro etiqueta="Tipo" texto="Gastos" activo alAbrir={abrir} />);
    expect(screen.getByRole("button").className).toMatch(/bg-arca-claro/);
    rerender(<ChipFiltro etiqueta="Categoria" texto="Todas" activo={false} desactivado alAbrir={abrir} />);
    expect(screen.getByRole("button")).toBeDisabled();
    await u.click(screen.getByRole("button"));
    expect(abrir).not.toHaveBeenCalled();
  });
});

describe("ChipInterruptor", () => {
  function Conectado({ inicial = false }: { inicial?: boolean }) {
    const [v, setV] = useState(inicial);
    return <ChipInterruptor etiqueta="Ver anulados" activo={v} alCambiar={setV} />;
  }

  it("es un interruptor (role switch) con el nombre de su etiqueta, tambien por getByLabelText", () => {
    render(<Conectado />);
    const sw = screen.getByRole("switch", { name: "Ver anulados" });
    expect(sw).not.toBeChecked();
    expect(screen.getByLabelText("Ver anulados")).toBe(sw);
  });

  it("tocar el chip lo activa y desactiva; el input cubre todo el chip (area tactil de 44 px)", async () => {
    const u = userEvent.setup();
    render(<Conectado />);
    const sw = screen.getByRole("switch", { name: "Ver anulados" });
    expect(sw.className).toMatch(/absolute inset-0/);
    expect(sw.parentElement!.querySelector("span")!.className).toMatch(/min-h-\[44px\]/);
    await u.click(sw);
    expect(sw).toBeChecked();
    await u.click(sw);
    expect(sw).not.toBeChecked();
  });

  it("con el teclado: Tab llega, Espacio activa", async () => {
    const u = userEvent.setup();
    render(<Conectado />);
    await u.tab();
    expect(screen.getByRole("switch")).toHaveFocus();
    await u.keyboard(" ");
    expect(screen.getByRole("switch")).toBeChecked();
  });

  it("activo: borde, fondo y marca ✓ (no solo color); la marca no entra en el nombre accesible", () => {
    render(<Conectado inicial />);
    const sw = screen.getByRole("switch", { name: "Ver anulados" });
    const chip = sw.parentElement!.querySelector("span")!;
    expect(chip.className).toMatch(/border-arca/);
    expect(chip.className).toMatch(/bg-arca-claro/);
    expect(chip.textContent).toContain("✓");
    expect(chip.querySelector("[aria-hidden]")).toHaveTextContent("✓");
    expect(sw).toHaveAccessibleName("Ver anulados");
  });

  it("muestra el foco con un contorno cuando se llega con el teclado (peer-focus-visible)", () => {
    render(<Conectado />);
    const chip = screen.getByRole("switch").parentElement!.querySelector("span")!;
    expect(chip.className).toMatch(/peer-focus-visible:outline/);
  });
});
