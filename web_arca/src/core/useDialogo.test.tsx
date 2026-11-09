import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Fondo } from "./DialogoAnular";
import HojaOpciones from "./HojaOpciones";

/** Un boton "Abrir" que abre un dialogo (Fondo) con tres cosas enfocables: Uno, Campo y Dos. */
function Ejemplo({
  sinGuardar = false,
  alCerrar = vi.fn(),
  enfoque,
  interior,
}: {
  sinGuardar?: boolean;
  alCerrar?: () => void;
  enfoque?: "primero" | "dialogo";
  interior?: React.ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <button onClick={() => setAbierto(true)}>Abrir</button>
      {abierto && (
        <Fondo alCerrar={() => { alCerrar(); setAbierto(false); }} sinGuardar={sinGuardar} enfoque={enfoque}>
          <div role="dialog" aria-modal="true" aria-label="Prueba">
            <button>Uno</button>
            <input aria-label="Campo" />
            <button>Dos</button>
            {interior}
          </div>
        </Fondo>
      )}
    </>
  );
}

const fondoDe = () => screen.getByRole("dialog", { name: "Prueba" }).closest("[data-fondo]") as HTMLElement;

describe("Dialogos (Fondo): Escape, foco y fondo", () => {
  it("al abrir, el foco pasa al primer elemento util", async () => {
    const u = userEvent.setup();
    render(<Ejemplo />);
    await u.click(screen.getByRole("button", { name: "Abrir" }));
    expect(screen.getByRole("button", { name: "Uno" })).toHaveFocus();
  });

  it("con enfoque 'dialogo' el foco va al dialogo y no a un campo (no abre el teclado del telefono)", async () => {
    const u = userEvent.setup();
    render(<Ejemplo enfoque="dialogo" />);
    await u.click(screen.getByRole("button", { name: "Abrir" }));
    expect(screen.getByRole("dialog", { name: "Prueba" })).toHaveFocus();
    expect(screen.getByLabelText("Campo")).not.toHaveFocus();
  });

  it("un campo con autoFocus conserva el foco al abrir", async () => {
    const u = userEvent.setup();
    render(<Ejemplo interior={<input aria-label="Con autofoco" autoFocus />} />);
    await u.click(screen.getByRole("button", { name: "Abrir" }));
    expect(screen.getByLabelText("Con autofoco")).toHaveFocus();
  });

  it("Escape cierra el dialogo y el foco vuelve al boton que lo abrio", async () => {
    const u = userEvent.setup();
    const cerrar = vi.fn();
    render(<Ejemplo alCerrar={cerrar} />);
    const abrir = screen.getByRole("button", { name: "Abrir" });
    await u.click(abrir);
    await u.keyboard("{Escape}");
    expect(cerrar).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(abrir).toHaveFocus();
  });

  it("Escape cierra tambien cuando hay datos sin guardar (solo el fondo se protege)", async () => {
    const u = userEvent.setup();
    const cerrar = vi.fn();
    render(<Ejemplo alCerrar={cerrar} sinGuardar />);
    await u.click(screen.getByRole("button", { name: "Abrir" }));
    await u.keyboard("{Escape}");
    expect(cerrar).toHaveBeenCalledTimes(1);
  });

  it("tocar el fondo cierra; tocar dentro del dialogo no", async () => {
    const u = userEvent.setup();
    const cerrar = vi.fn();
    render(<Ejemplo alCerrar={cerrar} />);
    await u.click(screen.getByRole("button", { name: "Abrir" }));
    await u.click(screen.getByRole("button", { name: "Uno" }));
    expect(cerrar).not.toHaveBeenCalled();
    await u.click(fondoDe());
    expect(cerrar).toHaveBeenCalledTimes(1);
  });

  it("con datos sin guardar, tocar el fondo NO cierra", async () => {
    const u = userEvent.setup();
    const cerrar = vi.fn();
    render(<Ejemplo alCerrar={cerrar} sinGuardar />);
    await u.click(screen.getByRole("button", { name: "Abrir" }));
    await u.click(fondoDe());
    expect(cerrar).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Prueba" })).toBeInTheDocument();
  });

  it("trampa de foco: Tab y Shift+Tab dan la vuelta dentro del dialogo", async () => {
    const u = userEvent.setup();
    render(<Ejemplo />);
    await u.click(screen.getByRole("button", { name: "Abrir" }));
    expect(screen.getByRole("button", { name: "Uno" })).toHaveFocus();
    await u.tab();
    expect(screen.getByLabelText("Campo")).toHaveFocus();
    await u.tab();
    expect(screen.getByRole("button", { name: "Dos" })).toHaveFocus();
    await u.tab(); // del ultimo vuelve al primero
    expect(screen.getByRole("button", { name: "Uno" })).toHaveFocus();
    await u.tab({ shift: true }); // del primero va al ultimo
    expect(screen.getByRole("button", { name: "Dos" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Abrir" })).not.toHaveFocus(); // nunca sale a la pantalla de atras
  });

  it("un dialogo propio dentro del dialogo maneja su teclado: Escape alli no cierra el de afuera", async () => {
    const u = userEvent.setup();
    const cerrar = vi.fn();
    render(
      <Ejemplo
        alCerrar={cerrar}
        interior={
          <div role="dialog" aria-label="Capa interior">
            <input aria-label="Dentro de la capa" />
          </div>
        }
      />,
    );
    await u.click(screen.getByRole("button", { name: "Abrir" }));
    screen.getByLabelText("Dentro de la capa").focus();
    await u.keyboard("{Escape}");
    expect(cerrar).not.toHaveBeenCalled();
  });
});

describe("HojaOpciones: Escape, foco y fondo", () => {
  const opciones = [
    { valor: "", texto: "Todos" },
    { valor: "a", texto: "Ana" },
    { valor: "b", texto: "Beto" },
  ];
  function ConChip({ alElegir = vi.fn() }: { alElegir?: (v: string) => void }) {
    const [abierta, setAbierta] = useState(false);
    return (
      <>
        <button onClick={() => setAbierta(true)}>Persona</button>
        {abierta && <HojaOpciones titulo="Persona" opciones={opciones} valor="a" alElegir={alElegir} alCerrar={() => setAbierta(false)} />}
      </>
    );
  }

  it("al abrir el foco va a la opcion elegida; Escape cierra y el foco vuelve al chip", async () => {
    const u = userEvent.setup();
    render(<ConChip />);
    const chip = screen.getByRole("button", { name: "Persona" });
    await u.click(chip);
    expect(screen.getByRole("radio", { name: "Ana" })).toHaveFocus();
    await u.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(chip).toHaveFocus();
  });

  it("el boton que cubre el fondo sigue cerrando al tocarlo pero no es una parada de Tab", async () => {
    const u = userEvent.setup();
    render(<ConChip />);
    await u.click(screen.getByRole("button", { name: "Persona" }));
    const fondo = screen.getByRole("button", { name: "Cerrar opciones" });
    expect(fondo).toHaveAttribute("tabindex", "-1");
    await u.click(fondo);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Tab no sale de la hoja", async () => {
    const u = userEvent.setup();
    render(<ConChip />);
    await u.click(screen.getByRole("button", { name: "Persona" }));
    for (let i = 0; i < 8; i++) await u.tab();
    expect(screen.getByRole("dialog", { name: "Persona" }).contains(document.activeElement)).toBe(true);
  });

  it("elegir una opcion sigue llamando a alElegir con su valor", async () => {
    const u = userEvent.setup();
    const elegir = vi.fn();
    render(<ConChip alElegir={elegir} />);
    await u.click(screen.getByRole("button", { name: "Persona" }));
    await u.click(screen.getByRole("radio", { name: "Beto" }));
    expect(elegir).toHaveBeenCalledWith("b");
  });
});
