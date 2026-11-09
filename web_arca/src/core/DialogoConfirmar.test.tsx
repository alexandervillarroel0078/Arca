import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AvisoProvider } from "./Aviso";
import DialogoConfirmar, { useConfirmar, type PedidoConfirmar } from "./DialogoConfirmar";

/** Un boton "Accion" que pide confirmar; muestra el dialogo del hook. */
function Pantalla({ ejecutar, titulo = "Marcar consumido" }: { ejecutar: PedidoConfirmar["ejecutar"]; titulo?: string }) {
  const { confirmar, dialogo } = useConfirmar();
  return (
    <AvisoProvider>
      <button onClick={() => confirmar({ titulo, mensaje: "Marcar Bs 250.00 de Tia Rosa como consumido? Puedes reabrirlo despues.", ejecutar })}>
        Accion
      </button>
      {dialogo}
    </AvisoProvider>
  );
}

describe("DialogoConfirmar", () => {
  it("muestra el titulo, el mensaje tal cual y los botones Cancelar y Confirmar", async () => {
    const u = userEvent.setup();
    render(<Pantalla ejecutar={vi.fn()} />);
    await u.click(screen.getByRole("button", { name: "Accion" }));
    const d = screen.getByRole("dialog", { name: "Marcar consumido" });
    expect(d).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("heading", { name: "Marcar consumido" })).toBeInTheDocument();
    expect(screen.getByTestId("mensaje-confirmar")).toHaveTextContent("Marcar Bs 250.00 de Tia Rosa como consumido? Puedes reabrirlo despues.");
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeInTheDocument();
  });

  it("el foco inicial esta en Cancelar (un Enter distraido no ejecuta nada)", async () => {
    const u = userEvent.setup();
    const ejecutar = vi.fn();
    render(<Pantalla ejecutar={ejecutar} />);
    await u.click(screen.getByRole("button", { name: "Accion" }));
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();
    await u.keyboard("{Enter}");
    expect(ejecutar).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); // Enter sobre Cancelar solo cancela
  });

  it("Escape cancela: no ejecuta nada y el foco vuelve al boton que lo abrio", async () => {
    const u = userEvent.setup();
    const ejecutar = vi.fn();
    render(<Pantalla ejecutar={ejecutar} />);
    const abrir = screen.getByRole("button", { name: "Accion" });
    await u.click(abrir);
    await u.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(ejecutar).not.toHaveBeenCalled();
    expect(abrir).toHaveFocus();
  });

  it("Cancelar y tocar el fondo tambien cancelan sin ejecutar", async () => {
    const u = userEvent.setup();
    const ejecutar = vi.fn();
    render(<Pantalla ejecutar={ejecutar} />);
    await u.click(screen.getByRole("button", { name: "Accion" }));
    await u.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Accion" }));
    await u.click(screen.getByRole("dialog").closest("[data-fondo]") as HTMLElement);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(ejecutar).not.toHaveBeenCalled();
  });

  it("Confirmar ejecuta la accion una sola vez y cierra el dialogo", async () => {
    const u = userEvent.setup();
    const ejecutar = vi.fn().mockResolvedValue(undefined);
    render(<Pantalla ejecutar={ejecutar} />);
    await u.click(screen.getByRole("button", { name: "Accion" }));
    await u.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(ejecutar).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("el dialogo ya esta cerrado cuando la accion arranca (asi un dialogo que abra la accion no se pelea el foco)", async () => {
    const u = userEvent.setup();
    let abiertoAlEjecutar: boolean | null = null;
    const ejecutar = vi.fn(() => {
      abiertoAlEjecutar = !!screen.queryByRole("dialog", { name: "Marcar consumido" });
    });
    render(<Pantalla ejecutar={ejecutar} />);
    await u.click(screen.getByRole("button", { name: "Accion" }));
    await u.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(ejecutar).toHaveBeenCalled());
    expect(abiertoAlEjecutar).toBe(false);
  });

  it("si la accion falla con un error, se avisa como alert (el dialogo ya se cerro)", async () => {
    const u = userEvent.setup();
    render(<Pantalla ejecutar={() => Promise.reject(new Error("No se pudo restablecer"))} />);
    await u.click(screen.getByRole("button", { name: "Accion" }));
    await u.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo restablecer");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Tab no sale del dialogo (Cancelar y Confirmar)", async () => {
    const u = userEvent.setup();
    render(<Pantalla ejecutar={vi.fn()} />);
    await u.click(screen.getByRole("button", { name: "Accion" }));
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();
    await u.tab();
    expect(screen.getByRole("button", { name: "Confirmar" })).toHaveFocus();
    await u.tab();
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();
    await u.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Confirmar" })).toHaveFocus();
  });

  it("usado directamente (sin el hook): cierra con alCerrar", async () => {
    const u = userEvent.setup();
    function Directo() {
      const [abierto, setAbierto] = useState(true);
      return abierto ? <AvisoProvider><DialogoConfirmar pedido={{ titulo: "Restablecer clave", mensaje: "Seguro?", ejecutar: vi.fn() }} alCerrar={() => setAbierto(false)} /></AvisoProvider> : <p>cerrado</p>;
    }
    render(<Directo />);
    expect(screen.getByRole("dialog", { name: "Restablecer clave" })).toBeInTheDocument();
    await u.keyboard("{Escape}");
    expect(screen.getByText("cerrado")).toBeInTheDocument();
  });
});
