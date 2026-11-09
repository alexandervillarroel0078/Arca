import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import DialogoAnular from "./DialogoAnular";

const pedido = { titulo: "Anular gasto", detalle: "Almuerzo familiar · Bs 60.00", ejecutar: vi.fn().mockResolvedValue(undefined) };
const fondoDe = () => screen.getByRole("dialog", { name: "Anular gasto" }).closest("[data-fondo]") as HTMLElement;

describe("DialogoAnular: foco, Escape y fondo", () => {
  it("al abrir el foco queda en el dialogo y NO en el motivo (no abre el teclado de golpe sobre los botones)", () => {
    render(<DialogoAnular pedido={pedido} alCerrar={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Anular gasto" })).toHaveFocus();
    expect(screen.getByLabelText("Motivo (opcional)")).not.toHaveFocus();
  });

  it("Escape cierra sin anular", async () => {
    const u = userEvent.setup();
    const ejecutar = vi.fn();
    const cerrar = vi.fn();
    render(<DialogoAnular pedido={{ ...pedido, ejecutar }} alCerrar={cerrar} />);
    await u.keyboard("{Escape}");
    expect(cerrar).toHaveBeenCalledTimes(1);
    expect(ejecutar).not.toHaveBeenCalled();
  });

  it("tocar el fondo cierra mientras el motivo esta vacio", async () => {
    const u = userEvent.setup();
    const cerrar = vi.fn();
    render(<DialogoAnular pedido={pedido} alCerrar={cerrar} />);
    await u.click(fondoDe());
    expect(cerrar).toHaveBeenCalledTimes(1);
  });

  it("con un motivo escrito, tocar el fondo NO cierra (no se pierde lo escrito); Escape y Cancelar si", async () => {
    const u = userEvent.setup();
    const cerrar = vi.fn();
    render(<DialogoAnular pedido={pedido} alCerrar={cerrar} />);
    await u.type(screen.getByLabelText("Motivo (opcional)"), "Duplicado");
    await u.click(fondoDe());
    expect(cerrar).not.toHaveBeenCalled();
    await u.keyboard("{Escape}");
    expect(cerrar).toHaveBeenCalledTimes(1);
  });

  it("el dialogo se puede desplazar si la pantalla es baja (max-h y overflow-y-auto)", () => {
    render(<DialogoAnular pedido={pedido} alCerrar={vi.fn()} />);
    const d = screen.getByRole("dialog", { name: "Anular gasto" });
    expect(d.className).toMatch(/max-h-\[calc\(100dvh-2rem\)\]/);
    expect(d.className).toMatch(/overflow-y-auto/);
    expect(fondoDe().parentElement!.className).toMatch(/overflow-y-auto/); // y el fondo tambien, por si acaso
  });

  it("Tab no sale del dialogo: del ultimo boton vuelve al primer elemento", async () => {
    const u = userEvent.setup();
    render(<DialogoAnular pedido={pedido} alCerrar={vi.fn()} />);
    await u.tab(); // dialogo -> primer elemento (motivo)
    expect(screen.getByLabelText("Motivo (opcional)")).toHaveFocus();
    await u.tab();
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();
    await u.tab();
    expect(screen.getByRole("button", { name: "Anular" })).toHaveFocus();
    await u.tab();
    expect(screen.getByLabelText("Motivo (opcional)")).toHaveFocus();
  });
});
