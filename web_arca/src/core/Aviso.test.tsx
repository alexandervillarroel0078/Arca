import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AvisoProvider, useAviso } from "./Aviso";

let mostrar: ReturnType<typeof useAviso>;
function Espia() {
  mostrar = useAviso();
  return null;
}
const montar = () => render(<AvisoProvider><Espia /></AvisoProvider>);

describe("Avisos", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("muestra el texto y lo quita solo a los 3,5 segundos", () => {
    montar();
    act(() => mostrar("Guardado"));
    expect(screen.getByText("Guardado")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(3400); });
    expect(screen.getByText("Guardado")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.queryByText("Guardado")).not.toBeInTheDocument();
  });

  it("solo se ve el aviso mas reciente", () => {
    montar();
    act(() => mostrar("Primero"));
    act(() => mostrar("Segundo", "error"));
    expect(screen.queryByText("Primero")).not.toBeInTheDocument();
    expect(screen.getByText("Segundo").parentElement!.className).toMatch(/bg-red-700/);
  });

  it("con boton de accion ('Anulado' + 'Reactivar') dura 8 segundos y el boton ejecuta la accion y cierra el aviso", () => {
    montar();
    const reactivar = vi.fn();
    act(() => mostrar("Anulado", "ok", { texto: "Reactivar", alAccionar: reactivar }));
    act(() => { vi.advanceTimersByTime(7000); });
    expect(screen.getByText("Anulado")).toBeInTheDocument();
    const boton = screen.getByRole("button", { name: "Reactivar" });
    expect(boton.className).toMatch(/min-h-\[44px\]/);
    fireEvent.click(boton);
    expect(reactivar).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Anulado")).not.toBeInTheDocument();
  });

  it("sin tocar el boton, el aviso con accion desaparece a los 8 segundos", () => {
    montar();
    act(() => mostrar("Anulado", "ok", { texto: "Reactivar", alAccionar: vi.fn() }));
    act(() => { vi.advanceTimersByTime(8100); });
    expect(screen.queryByText("Anulado")).not.toBeInTheDocument();
  });

  it("los avisos son informativos para lectores de pantalla (role=status)", () => {
    montar();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
