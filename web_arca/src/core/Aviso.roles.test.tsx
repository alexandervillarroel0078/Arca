import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AvisoProvider, useAviso } from "./Aviso";

let mostrar: ReturnType<typeof useAviso>;
function Espia() {
  mostrar = useAviso();
  return null;
}
const montar = () => render(<AvisoProvider><Espia /></AvisoProvider>);

describe("Avisos: errores con role=alert, informativos con role=status", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("un error se anuncia como alert (de inmediato) y no queda dentro de la region status", () => {
    montar();
    act(() => mostrar("No se pudo guardar", "error"));
    const alerta = screen.getByRole("alert");
    expect(alerta).toHaveTextContent("No se pudo guardar");
    expect(screen.getByRole("status")).not.toContainElement(alerta);
  });

  it("los avisos ok e info son status y NO alert", () => {
    montar();
    act(() => mostrar("Guardado", "ok"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Guardado");
    act(() => mostrar("Sin internet: se guardo", "info"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Sin internet: se guardo");
  });

  it("sin errores no existe ningun alert en pantalla", () => {
    montar();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("el error NO desaparece a los 3,5 s: dura 10 s", () => {
    montar();
    act(() => mostrar("No se pudo guardar", "error"));
    act(() => { vi.advanceTimersByTime(3600); });
    expect(screen.getByText("No se pudo guardar")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(6300); }); // 9,9 s
    expect(screen.getByText("No se pudo guardar")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(200); }); // 10,1 s
    expect(screen.queryByText("No se pudo guardar")).not.toBeInTheDocument();
  });

  it("el error se cierra con el boton 'Cerrar aviso' (44px)", () => {
    montar();
    act(() => mostrar("No se pudo guardar", "error"));
    const cerrar = screen.getByRole("button", { name: "Cerrar aviso" });
    expect(cerrar.className).toMatch(/min-h-\[44px\]/);
    expect(cerrar.className).toMatch(/min-w-\[44px\]/);
    fireEvent.click(cerrar);
    expect(screen.queryByText("No se pudo guardar")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("los informativos no llevan boton de cerrar y siguen yendose solos a los 3,5 s", () => {
    montar();
    act(() => mostrar("Guardado"));
    expect(screen.queryByRole("button", { name: "Cerrar aviso" })).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(3600); });
    expect(screen.queryByText("Guardado")).not.toBeInTheDocument();
  });

  it("un error con boton de accion (AccionAviso sin cambios) ejecuta la accion y tambien dura 10 s", () => {
    montar();
    const reintentar = vi.fn();
    act(() => mostrar("No se pudo anular", "error", { texto: "Reintentar", alAccionar: reintentar }));
    act(() => { vi.advanceTimersByTime(9000); });
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(reintentar).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("No se pudo anular")).not.toBeInTheDocument();
  });

  it("solo se ve el aviso mas reciente: un informativo reemplaza al error anterior", () => {
    montar();
    act(() => mostrar("Fallo", "error"));
    act(() => mostrar("Listo", "ok"));
    expect(screen.queryByText("Fallo")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
