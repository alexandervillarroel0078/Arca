import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import DialogoAnular from "./DialogoAnular";

const pedido = (ejecutar = vi.fn().mockResolvedValue(undefined), extra = {}) => ({
  titulo: "Anular gasto", detalle: "Almuerzo familiar · Bs 60.00", ejecutar, ...extra,
});

describe("DialogoAnular", () => {
  it("muestra que se anula (nombre y monto) y aclara que no se borra nada", () => {
    render(<DialogoAnular pedido={pedido()} alCerrar={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Anular gasto" })).toBeInTheDocument();
    expect(screen.getByTestId("detalle-anular")).toHaveTextContent("Almuerzo familiar · Bs 60.00");
    expect(screen.getByText(/No se borra nada/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("muestra la advertencia previa cuando hay efectos (ej. devoluciones en cascada)", () => {
    render(<DialogoAnular pedido={pedido(undefined, { advertencia: "Se anularan tambien 2 devoluciones." })} alCerrar={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Se anularan tambien 2 devoluciones.");
  });

  it("Cancelar cierra sin anular", async () => {
    const u = userEvent.setup();
    const ejecutar = vi.fn();
    const cerrar = vi.fn();
    render(<DialogoAnular pedido={pedido(ejecutar)} alCerrar={cerrar} />);
    await u.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(cerrar).toHaveBeenCalledTimes(1);
    expect(ejecutar).not.toHaveBeenCalled();
  });

  it("Anular manda el motivo (sin espacios sobrantes) y luego cierra", async () => {
    const u = userEvent.setup();
    const ejecutar = vi.fn().mockResolvedValue(undefined);
    const cerrar = vi.fn();
    render(<DialogoAnular pedido={pedido(ejecutar)} alCerrar={cerrar} />);
    await u.type(screen.getByLabelText("Motivo (opcional)"), "  Duplicado  ");
    await u.click(screen.getByRole("button", { name: "Anular" }));
    await waitFor(() => expect(cerrar).toHaveBeenCalled());
    expect(ejecutar).toHaveBeenCalledWith("Duplicado");
  });

  it("el motivo es opcional: se anula con motivo vacio", async () => {
    const u = userEvent.setup();
    const ejecutar = vi.fn().mockResolvedValue(undefined);
    render(<DialogoAnular pedido={pedido(ejecutar)} alCerrar={vi.fn()} />);
    await u.click(screen.getByRole("button", { name: "Anular" }));
    await waitFor(() => expect(ejecutar).toHaveBeenCalledWith(""));
  });

  it("si el servidor rechaza, muestra el error y NO se cierra", async () => {
    const u = userEvent.setup();
    const cerrar = vi.fn();
    render(<DialogoAnular pedido={pedido(vi.fn().mockRejectedValue(new Error("Solo puedes modificar lo que registraste tú")))} alCerrar={cerrar} />);
    await u.click(screen.getByRole("button", { name: "Anular" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Solo puedes modificar lo que registraste tú");
    expect(cerrar).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Anular" })).toBeEnabled(); // se puede reintentar o cancelar
  });
});
