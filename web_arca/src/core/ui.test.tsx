// Sistema de diseno (Fase 14): jerarquia de botones, campos, claves, interruptor, estados vacio/carga y encabezado.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import Encabezado, { AccionFija } from "./Encabezado";
import HojaOpciones from "./HojaOpciones";
import { Boton, Campo, CampoClave, Cargando, ErrorCaja, Interruptor, MensajeError, Vacio, claseInput } from "./ui";

describe("botones: nunca todos iguales", () => {
  it("el principal es verde, de ancho completo y 56px; el secundario lleva borde; el destructivo es rojo suave", () => {
    render(<><Boton>Guardar</Boton><Boton variante="suave">Cancelar</Boton><Boton variante="peligro">Anular</Boton><Boton variante="apoyo">Consumir</Boton></>);
    const [p, s, d, a] = screen.getAllByRole("button");
    expect(p.className).toMatch(/bg-arca/);
    expect(p.className).toContain("w-full");
    expect(p.className).toContain("min-h-[56px]");
    expect(s.className).toMatch(/border-\[1\.5px\]/);
    expect(s.className).toMatch(/bg-white/);
    expect(d.className).toMatch(/bg-red-50/);
    expect(d.className).toMatch(/text-red-700/);
    expect(a.className).toMatch(/bg-apoyo/);
    expect(new Set([p.className, s.className, d.className, a.className]).size).toBe(4);
    for (const b of [s, d, a]) expect(b.className).toMatch(/min-h-\[48px\]/); // todos de 44px o mas
  });
});

describe("campos de formulario", () => {
  it("campo de 52px, borde de 1.5px, radio de 14px y foco verde visible", () => {
    expect(claseInput).toContain("min-h-[52px]");
    expect(claseInput).toContain("border-[1.5px]");
    expect(claseInput).toContain("rounded-campo");
    expect(claseInput).toContain("focus:border-arca");
  });

  it("la etiqueta va arriba y el error DEBAJO del campo, con icono y texto", () => {
    render(<Campo etiqueta="Nombre" error="Ya existe"><input className={claseInput} /></Campo>);
    const campo = screen.getByLabelText("Nombre");
    const error = screen.getByRole("alert");
    expect(error).toHaveTextContent("Ya existe");
    expect(error.className).toContain("before:content-['⚠']");
    expect(campo.compareDocumentPosition(error) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // despues del campo
    expect(screen.getByText("Nombre").compareDocumentPosition(campo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // etiqueta antes
  });

  it("sin error no se muestra nada", () => {
    render(<><MensajeError mensaje={null} /><ErrorCaja mensaje={null} /></>);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("las claves tienen boton para mostrar u ocultar (44px) y la etiqueta sigue funcionando", async () => {
    const u = userEvent.setup();
    render(<CampoClave etiqueta="Contrasena" defaultValue="secreta12" />);
    const campo = screen.getByLabelText("Contrasena");
    expect(campo).toHaveAttribute("type", "password");
    const boton = screen.getByRole("button", { name: "Mostrar clave" });
    expect(boton.className).toContain("min-h-[44px]");
    await u.click(boton);
    expect(campo).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Ocultar clave" })).toHaveAttribute("aria-pressed", "true");
    await u.click(screen.getByRole("button", { name: "Ocultar clave" }));
    expect(campo).toHaveAttribute("type", "password");
  });
});

describe("interruptor", () => {
  it("es un checkbox real con rol switch: se activa con el dedo y con el teclado", async () => {
    const u = userEvent.setup();
    const alCambiar = vi.fn();
    render(<Interruptor etiqueta="Ver anulados" activo={false} alCambiar={alCambiar} />);
    const sw = screen.getByRole("switch", { name: "Ver anulados" });
    await u.click(sw);
    expect(alCambiar).toHaveBeenCalledWith(true);
    sw.focus();
    await u.keyboard(" ");
    expect(alCambiar).toHaveBeenCalledTimes(2);
  });
});

describe("estados de carga y vacio", () => {
  it("Cargando muestra esqueletos y anuncia el texto solo a lectores de pantalla", () => {
    render(<Cargando />);
    expect(screen.getByText("Cargando...").className).toContain("sr-only");
    expect(document.querySelectorAll(".esqueleto").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  });

  it("Vacio: mensaje amable con una accion (enlace o boton)", async () => {
    const u = userEvent.setup();
    const alClic = vi.fn();
    render(
      <MemoryRouter>
        <Vacio texto="Todavia no hay nada" accion={{ texto: "Crear el primero", a: "/nuevo" }} />
        <Vacio texto="Sin filtros" accion={{ texto: "Quitar filtros", alClic }} />
        <Vacio texto="Sin accion" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Crear el primero" })).toHaveAttribute("href", "/nuevo");
    await u.click(screen.getByRole("button", { name: "Quitar filtros" }));
    expect(alClic).toHaveBeenCalled();
    expect(screen.getAllByTestId("estado-vacio")).toHaveLength(3);
    expect(screen.getByRole("link", { name: "Crear el primero" }).className).toContain("min-h-[48px]");
  });
});

function Ruta() {
  return <p data-testid="ruta">{useLocation().pathname}</p>;
}

describe("Encabezado '< Volver'", () => {
  const app = (inicial: string[]) => (
    <MemoryRouter initialEntries={inicial}>
      <Routes>
        <Route path="/familia/miembros" element={<Encabezado titulo="Miembros" volverA="/familia" />} />
        <Route path="*" element={<p>otra</p>} />
      </Routes>
      <Ruta />
    </MemoryRouter>
  );

  it("muestra el titulo y el boton Volver de 44px", () => {
    render(app(["/familia/miembros"]));
    expect(screen.getByRole("heading", { name: "Miembros" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Volver" }).className).toContain("min-h-[44px]");
  });

  it("sin pantalla anterior (pagina recargada) lleva a la ruta de respaldo, no saca de la app", async () => {
    render(app(["/familia/miembros"]));
    await userEvent.setup().click(screen.getByRole("button", { name: "Volver" }));
    expect(screen.getByTestId("ruta")).toHaveTextContent("/familia");
  });
});

describe("AccionFija y HojaOpciones", () => {
  it("el boton fijo queda sobre la barra inferior (72px) y deja espacio para no tapar el contenido", () => {
    const { container } = render(<AccionFija><button>Agregar</button></AccionFija>);
    const fijo = container.querySelector(".fixed") as HTMLElement;
    expect(fijo.style.bottom).toContain("72px");
    expect(container.querySelector(".h-24")).not.toBeNull();
  });

  it("la hoja de opciones elige una y marca la actual", async () => {
    const u = userEvent.setup();
    const alElegir = vi.fn();
    render(<HojaOpciones titulo="Tipo" valor="a" opciones={[{ valor: "a", texto: "Uno" }, { valor: "b", texto: "Dos" }]} alElegir={alElegir} alCerrar={() => {}} />);
    expect(screen.getByRole("radio", { name: "Uno" })).toHaveAttribute("aria-checked", "true");
    await u.click(screen.getByRole("radio", { name: "Dos" }));
    expect(alElegir).toHaveBeenCalledWith("b");
  });
});

describe("tokens del sistema de diseno", () => {
  const css = readFileSync(join(process.cwd(), "src", "index.css"), "utf-8");
  const cfg = readFileSync(join(process.cwd(), "tailwind.config.js"), "utf-8");
  it("variables CSS y Tailwind usan los colores del prototipo", () => {
    for (const hex of ["#F4F6F5", "#FFFFFF", "#12201C", "#4A5A56", "#E1E7E5", "#0E6B58", "#E3F1EC", "#A8470A", "#FBEBDD", "#6E3207"]) {
      expect(css.toUpperCase(), `index.css ${hex}`).toContain(hex);
    }
    for (const hex of ["#0E6B58", "#E3F1EC", "#A8470A", "#FBEBDD", "#6E3207", "#F4F6F5", "#E1E7E5", "#4A5A56", "#12201C"]) {
      expect(cfg.toUpperCase(), `tailwind ${hex}`).toContain(hex);
    }
    expect(css).toContain("--alto-nav: 72px");
    expect(cfg).toContain("Space Grotesk");
    expect(cfg).toContain("Inter");
  });
});
