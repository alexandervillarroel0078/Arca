import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { admin, itemDe, renderPantalla } from "../../test/ayudas";
import type { Yo } from "../auth/api";
import FilaActividad from "./FilaActividad";

const sesion = vi.hoisted(() => ({ usuario: null as Yo | null }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => sesion, useUsuarioOpcional: () => sesion.usuario }));

const fila = (c: Parameters<typeof itemDe>[0]) => {
  sesion.usuario = admin;
  renderPantalla(<FilaActividad item={itemDe(c)} acciones={[]} />);
  return screen.getByTestId("fila-lista");
};

describe("FilaActividad: pildoras de sincronizacion", () => {
  it("un registro sincronizado no muestra ninguna etiqueta (ni un contenedor vacio que ocupe espacio)", () => {
    const f = fila({});
    expect(within(f).queryByTestId("etiqueta-sin-enviar")).not.toBeInTheDocument();
    expect(within(f).queryByTestId("etiqueta-en-conflicto")).not.toBeInTheDocument();
    expect(f.querySelector(".empty\\:hidden")).toBeEmptyDOMElement(); // `empty:hidden`: sin hijos no se ve ni deja margen
    expect(f).not.toHaveTextContent("sin enviar");
  });

  it("pendiente: pildora '⏳ sin enviar' fuera de la linea de detalle (que ya no la lleva suelta)", () => {
    const f = fila({ sinSincronizar: true });
    const p = within(f).getByTestId("etiqueta-sin-enviar");
    expect(p).toHaveTextContent("⏳ sin enviar");
    expect(p.className).toMatch(/rounded-full/);
    expect(within(f).getByText(/Comida/)).not.toHaveTextContent("sin enviar"); // la linea de detalle (tipo · autor · fecha)
    expect(within(f).queryByTestId("etiqueta-en-conflicto")).not.toBeInTheDocument();
  });

  it("en conflicto: pildora '⚠ en conflicto' (ademas de la de sin enviar si tambien esta pendiente)", () => {
    const f = fila({ sinSincronizar: true, enConflicto: true });
    expect(within(f).getByTestId("etiqueta-en-conflicto")).toHaveTextContent("⚠ en conflicto");
    expect(within(f).getByTestId("etiqueta-sin-enviar")).toBeInTheDocument();
  });

  it("solo en conflicto muestra solo la roja", () => {
    const f = fila({ enConflicto: true });
    expect(within(f).getByTestId("etiqueta-en-conflicto")).toBeInTheDocument();
    expect(within(f).queryByTestId("etiqueta-sin-enviar")).not.toBeInTheDocument();
  });

  it("convive con la etiqueta de privacidad en la misma fila de etiquetas", () => {
    const f = fila({ sinSincronizar: true, visibilidad: "solo_yo", usuario_id: 1 });
    const contenedor = within(f).getByTestId("etiqueta-sin-enviar").parentElement!;
    expect(within(contenedor).getByTestId("etiqueta-privacidad")).toBeInTheDocument();
  });
});
