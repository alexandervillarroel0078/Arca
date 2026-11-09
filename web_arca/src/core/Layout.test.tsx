import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AvisoProvider } from "./Aviso";
import Layout from "./Layout";

function Ruta() {
  return <div data-testid="ruta">{useLocation().pathname}</div>;
}

/** El Layout real con una pantalla falsa por cada ruta de la barra, mas /nuevo y /editar. */
function abrir(ruta: string) {
  const pantalla = (nombre: string) => <div>{`Pantalla ${nombre}`}</div>;
  return render(
    <AvisoProvider>
      <MemoryRouter initialEntries={[ruta]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={pantalla("inicio")} />
            <Route path="apoyos" element={pantalla("apoyos")} />
            <Route path="reportes" element={pantalla("reportes")} />
            <Route path="familia" element={pantalla("familia")} />
            <Route path="todos" element={pantalla("todos")} />
            <Route path="nuevo" element={pantalla("nuevo")} />
            <Route path="editar/:clase/:id" element={pantalla("editar")} />
          </Route>
        </Routes>
        <Ruta />
      </MemoryRouter>
    </AvisoProvider>,
  );
}

const barra = () => screen.getByRole("navigation", { name: "Navegación principal" });
const mas = () => within(barra()).getByRole("link", { name: "Nuevo movimiento" });

describe("Layout: barra de navegacion con el + en el centro", () => {
  it("2 pestanas, el +, 2 pestanas, en el orden de siempre (Inicio, Apoyos, +, Reportes, Familia)", () => {
    abrir("/");
    const items = within(barra()).getAllByRole("listitem");
    expect(items).toHaveLength(5);
    expect(items.map((li) => within(li).getByRole("link").getAttribute("aria-label") ?? li.textContent)).toEqual([
      expect.stringContaining("Inicio"),
      expect.stringContaining("Apoyos"),
      "Nuevo movimiento",
      expect.stringContaining("Reportes"),
      expect.stringContaining("Familia"),
    ]);
    expect(within(barra()).getByRole("list").className).toMatch(/grid-cols-5/);
  });

  it.each([
    ["/", "inicio"],
    ["/apoyos", "apoyos"],
    ["/reportes", "reportes"],
    ["/familia", "familia"],
    ["/todos", "todos"],
  ])("el + aparece en %s, lleva a /nuevo y es el UNICO enlace 'Nuevo movimiento' de la pantalla", (ruta, nombre) => {
    abrir(ruta);
    expect(screen.getByText(`Pantalla ${nombre}`)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Nuevo movimiento" })).toHaveLength(1); // evita violaciones de strict mode
    expect(mas()).toHaveAttribute("href", "/nuevo");
    expect(mas()).not.toHaveAttribute("aria-current");
    expect(mas()).not.toHaveAttribute("aria-disabled");
  });

  it("el + mide al menos 44 px de alto (el enlace ocupa toda la barra: h-nav = 72 px) y el circulo 56 px", () => {
    abrir("/");
    expect(mas().className).toMatch(/\bh-nav\b/);
    const circulo = mas().firstElementChild as HTMLElement;
    expect(circulo.className).toMatch(/\bw-14 h-14\b/);
    expect(circulo).toHaveAttribute("aria-hidden", "true");
  });

  it("tocar el + lleva a /nuevo", async () => {
    const u = userEvent.setup();
    abrir("/apoyos");
    await u.click(mas());
    expect(screen.getByTestId("ruta")).toHaveTextContent("/nuevo");
    expect(screen.getByText("Pantalla nuevo")).toBeInTheDocument();
  });

  it("en /nuevo el + queda marcado (aria-current, aria-disabled, atenuado) y tocarlo no navega", async () => {
    const u = userEvent.setup();
    abrir("/nuevo");
    expect(mas()).toHaveAttribute("aria-current", "page");
    expect(mas()).toHaveAttribute("aria-disabled", "true");
    expect((mas().firstElementChild as HTMLElement).className).toMatch(/opacity-50/);
    await u.click(mas());
    expect(screen.getByTestId("ruta")).toHaveTextContent("/nuevo");
    expect(screen.getAllByRole("link", { name: "Nuevo movimiento" })).toHaveLength(1);
  });

  it("en /editar/... pasa lo mismo: tocarlo no saca de la edicion hacia /nuevo", async () => {
    const u = userEvent.setup();
    abrir("/editar/movimiento/7");
    expect(mas()).toHaveAttribute("aria-current", "page");
    expect(mas()).toHaveAttribute("aria-disabled", "true");
    await u.click(mas());
    expect(screen.getByTestId("ruta")).toHaveTextContent("/editar/movimiento/7");
    expect(screen.getByText("Pantalla editar")).toBeInTheDocument();
  });

  it("con teclado (Enter) tampoco navega estando en /nuevo", async () => {
    const u = userEvent.setup();
    abrir("/nuevo");
    mas().focus();
    await u.keyboard("{Enter}");
    expect(screen.getByTestId("ruta")).toHaveTextContent("/nuevo");
  });

  it("las pestanas siguen marcando la activa (aria-current) y el + no la altera", () => {
    abrir("/reportes");
    expect(within(barra()).getByRole("link", { name: /Reportes/ })).toHaveAttribute("aria-current", "page");
    expect(within(barra()).getByRole("link", { name: /Inicio/ })).not.toHaveAttribute("aria-current");
    expect(mas()).not.toHaveAttribute("aria-current");
  });

  it("deja espacio al final del contenido para la barra, el circulo que sobresale y la zona segura del telefono", () => {
    abrir("/");
    expect(screen.getByRole("main").className).toMatch(/pb-\[calc\(env\(safe-area-inset-bottom\)\+7rem\)\]/);
  });
});
