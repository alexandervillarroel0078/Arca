import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { admin, itemDe, renderPantalla } from "../../test/ayudas";
import type { Yo } from "../auth/api";
import FilaActividad from "./FilaActividad";

const sesion = vi.hoisted(() => ({ usuario: null as Yo | null }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => sesion, useUsuarioOpcional: () => sesion.usuario }));

function fila(autor: string, props: { mostrarAutor?: boolean; mostrarFecha?: boolean } = {}) {
  sesion.usuario = admin;
  renderPantalla(<FilaActividad item={itemDe({ usuario_nombre: autor })} acciones={[]} {...props} />);
  return screen.getByTestId("fila-lista");
}
const visible = (f: HTMLElement) => f.cloneNode(true) as HTMLElement; // texto sin lo que es solo para lectores de pantalla
const textoVisible = (f: HTMLElement) => {
  const c = visible(f);
  c.querySelectorAll(".solo-lectores").forEach((e) => e.remove());
  return c.textContent;
};

describe("FilaActividad: autor y fecha", () => {
  it("por defecto (Inicio) todo se ve: nombre de pila, y la fecha", () => {
    const f = fila("Ana Maria de los Angeles Perez");
    expect(textoVisible(f)).toContain("Comida · Ana · ");
    expect(textoVisible(f)).not.toContain("Maria");
    expect(f).toHaveTextContent("Comida · Ana Maria de los Angeles Perez ·"); // y el texto completo sigue ahi
  });

  it("un nombre de una sola palabra no lleva title ni texto aparte", () => {
    const f = fila("Beto");
    expect(within(f).queryByTitle("Beto")).not.toBeInTheDocument();
    expect(f.querySelectorAll(".solo-lectores")).toHaveLength(0);
    expect(textoVisible(f)).toContain("Comida · Beto ·");
  });

  it("espacios de mas no rompen la abreviatura", () => {
    const f = fila("  Ana   Maria  ");
    expect(textoVisible(f)).toContain("Comida · Ana");
    expect(textoVisible(f)).not.toContain("Maria");
  });

  it("mostrarAutor=false: no se ve el autor pero el nombre completo sigue en el texto de la fila", () => {
    const f = fila("Ana Maria de los Angeles Perez", { mostrarAutor: false });
    expect(textoVisible(f)).not.toContain("Ana");
    expect(f.textContent).toContain("Ana Maria de los Angeles Perez");
    expect(within(f).queryByTitle("Ana Maria de los Angeles Perez")).not.toBeInTheDocument();
  });

  it("mostrarFecha=false: no se ve la fecha pero sigue en el texto de la fila", () => {
    const f = fila("Ana Maria", { mostrarFecha: false });
    expect(textoVisible(f)).not.toMatch(/nov|Hoy/);
    expect(f.textContent).toMatch(/3 nov|Hoy/);
  });

  it("el nombre completo tambien se puede ver dejando el dedo o el cursor encima (title)", () => {
    const f = fila("Ana Maria de los Angeles Perez");
    expect(within(f).getByTitle("Ana Maria de los Angeles Perez")).toBeInTheDocument();
  });
});
