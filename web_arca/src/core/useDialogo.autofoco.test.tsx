import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Fondo } from "./DialogoAnular";

// Regresion: un campo con autoFocus mueve el foco al montarse; el dialogo debe recordar a quien lo ABRIO, no a ese campo.
function ConAutoFoco() {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <button onClick={() => setAbierto(true)}>Abrir</button>
      {abierto && (
        <Fondo alCerrar={() => setAbierto(false)}>
          <div role="dialog" aria-modal="true" aria-label="Con campo">
            <input aria-label="Monto" autoFocus />
          </div>
        </Fondo>
      )}
    </>
  );
}

describe("Dialogos con autoFocus", () => {
  it("al cerrar con Escape el foco vuelve al boton que lo abrio (no al campo que ya no existe)", async () => {
    const u = userEvent.setup();
    render(<ConAutoFoco />);
    const abrir = screen.getByRole("button", { name: "Abrir" });
    await u.click(abrir);
    expect(screen.getByLabelText("Monto")).toHaveFocus();
    await u.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(abrir).toHaveFocus();
  });
});
