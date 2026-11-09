import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EtiquetaSync } from "./EtiquetaSync";

describe("EtiquetaSync (pildora de estado de sincronizacion)", () => {
  it("un registro ya sincronizado no muestra nada", () => {
    const { container } = render(<EtiquetaSync />);
    expect(container).toBeEmptyDOMElement();
    const otro = render(<EtiquetaSync sinSincronizar={false} enConflicto={false} />);
    expect(otro.container).toBeEmptyDOMElement();
  });

  it("'sin enviar': pildora con icono y texto (no solo color)", () => {
    render(<EtiquetaSync sinSincronizar />);
    const p = screen.getByTestId("etiqueta-sin-enviar");
    expect(p).toHaveTextContent("⏳ sin enviar");
    expect(p.className).toMatch(/rounded-full/);
    expect(p.className).toMatch(/border/); // el borde tambien la distingue del fondo, no solo el color del texto
    expect(screen.queryByTestId("etiqueta-en-conflicto")).not.toBeInTheDocument();
  });

  it("'en conflicto': pildora roja con icono y texto", () => {
    render(<EtiquetaSync enConflicto />);
    const p = screen.getByTestId("etiqueta-en-conflicto");
    expect(p).toHaveTextContent("⚠ en conflicto");
    expect(p.className).toMatch(/bg-red-50/);
    expect(p.className).toMatch(/text-red-800/);
    expect(screen.queryByTestId("etiqueta-sin-enviar")).not.toBeInTheDocument();
  });

  it("si hay las dos, salen las dos", () => {
    render(<EtiquetaSync sinSincronizar enConflicto />);
    expect(screen.getByTestId("etiqueta-sin-enviar")).toBeInTheDocument();
    expect(screen.getByTestId("etiqueta-en-conflicto")).toBeInTheDocument();
  });

  it("usa los tonos de alto contraste del sistema (texto oscuro sobre tinte claro)", () => {
    render(<EtiquetaSync sinSincronizar enConflicto />);
    expect(screen.getByTestId("etiqueta-sin-enviar").className).toMatch(/bg-apoyo-claro/);
    expect(screen.getByTestId("etiqueta-sin-enviar").className).toMatch(/text-apoyo-texto/); // 8.5:1
    expect(screen.getByTestId("etiqueta-en-conflicto").className).toMatch(/text-red-800/); // ~7.6:1
  });
});
