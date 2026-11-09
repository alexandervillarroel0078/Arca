import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AvisoProvider } from "./Aviso";
import Layout, { estadoPestana } from "./Layout";

function abrir(ruta: string) {
  const pantalla = (n: string) => <div>{`Pantalla ${n}`}</div>;
  return render(
    <AvisoProvider>
      <MemoryRouter initialEntries={[ruta]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={pantalla("inicio")} />
            <Route path="todos" element={pantalla("todos")} />
            <Route path="nuevo" element={pantalla("nuevo")} />
            <Route path="editar/:clase/:id" element={pantalla("editar")} />
            <Route path="apoyos" element={pantalla("apoyos")} />
            <Route path="reportes" element={pantalla("reportes")} />
            <Route path="familia" element={pantalla("familia")} />
            <Route path="familia/miembros" element={pantalla("miembros")} />
            <Route path="periodo/rango" element={pantalla("rango")} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AvisoProvider>,
  );
}

const barra = () => screen.getByRole("navigation", { name: "Navegación principal" });
const pestana = (n: string) => within(barra()).getByRole("link", { name: new RegExp(n) });
const resaltada = (n: string) => /text-arca/.test(pestana(n).className) && /bg-arca-claro/.test(pestana(n).firstElementChild!.className);
const conAriaCurrent = () => Array.from(document.querySelectorAll('[aria-current="page"]'));

describe("Layout: pestana activa (Bloque E)", () => {
  it.each(["/todos", "/nuevo", "/editar/movimiento/7"])("en %s Inicio se ve activa (resaltada)", (ruta) => {
    abrir(ruta);
    expect(resaltada("Inicio")).toBe(true);
    for (const otra of ["Apoyos", "Reportes", "Familia"]) expect(resaltada(otra)).toBe(false);
  });

  it("en /todos Inicio SI lleva aria-current='page' y es el unico de la pantalla", () => {
    abrir("/todos");
    expect(pestana("Inicio")).toHaveAttribute("aria-current", "page");
    expect(conAriaCurrent()).toHaveLength(1);
  });

  it.each(["/nuevo", "/editar/movimiento/7", "/editar/apoyo/3"])("en %s Inicio NO lleva aria-current (solo estilo): el unico es el +", (ruta) => {
    abrir(ruta);
    expect(pestana("Inicio")).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Nuevo movimiento" })).toHaveAttribute("aria-current", "page");
    expect(conAriaCurrent()).toHaveLength(1);
  });

  it.each([
    ["/", "Inicio"],
    ["/apoyos", "Apoyos"],
    ["/reportes", "Reportes"],
    ["/familia", "Familia"],
    ["/familia/miembros", "Familia"], // una subpantalla de Familia marca Familia
  ])("en %s solo %s lleva aria-current (un solo elemento por pantalla) y el + no", (ruta, nombre) => {
    abrir(ruta);
    expect(pestana(nombre)).toHaveAttribute("aria-current", "page");
    expect(resaltada(nombre)).toBe(true);
    expect(conAriaCurrent()).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Nuevo movimiento" })).not.toHaveAttribute("aria-current");
  });

  it("en una ruta sin pestana (/periodo/rango) no hay ninguna activa ni aria-current", () => {
    abrir("/periodo/rango");
    expect(conAriaCurrent()).toHaveLength(0);
    for (const n of ["Inicio", "Apoyos", "Reportes", "Familia"]) expect(resaltada(n)).toBe(false);
  });

  it("estadoPestana: reglas por ruta", () => {
    expect(estadoPestana("/", "/")).toEqual({ actual: true, resaltada: true });
    expect(estadoPestana("/", "/todos")).toEqual({ actual: true, resaltada: true });
    expect(estadoPestana("/", "/nuevo")).toEqual({ actual: false, resaltada: true });
    expect(estadoPestana("/", "/editar/apoyo/2")).toEqual({ actual: false, resaltada: true });
    expect(estadoPestana("/", "/apoyos")).toEqual({ actual: false, resaltada: false });
    expect(estadoPestana("/apoyos", "/nuevo")).toEqual({ actual: false, resaltada: false });
    expect(estadoPestana("/familia", "/familia/perfil/privacidad")).toEqual({ actual: true, resaltada: true });
    expect(estadoPestana("/familia", "/familiar")).toEqual({ actual: false, resaltada: false }); // no basta con empezar igual
  });
});
