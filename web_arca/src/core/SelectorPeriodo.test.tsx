import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import PaginaRango from "./PaginaRango";
import { PeriodoProvider, usePeriodo } from "./PeriodoContext";
import SelectorPeriodo from "./SelectorPeriodo";

const hoy = () => "2026-11-08";

/** Dos pantallas con el selector y una pantalla de "Rango", dentro del mismo proveedor (como en la app). */
function Prueba({ diaInicioMes = 1 }: { diaInicioMes?: number }) {
  const [sesion, setSesion] = useState<number | null>(1);
  return (
    <PeriodoProvider diaInicioMes={diaInicioMes} sesion={sesion} hoy={hoy}>
      <button onClick={() => setSesion(null)}>cerrar sesion</button>
      <button onClick={() => setSesion(2)}>entrar otra cuenta</button>
      <MemoryRouter initialEntries={["/"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/" element={<><h1>Inicio</h1><SelectorPeriodo /><Link to="/reportes">ir a Reportes</Link><Datos /></>} />
          <Route path="/reportes" element={<><h1>Reportes</h1><SelectorPeriodo /><Link to="/">ir a Inicio</Link></>} />
          <Route path="/periodo/rango" element={<PaginaRango />} />
        </Routes>
      </MemoryRouter>
    </PeriodoProvider>
  );
}
/** Lo que las pantallas reciben para pedir datos. */
function Datos() {
  const { periodo } = usePeriodo();
  return <output data-testid="fechas">{periodo.desde}|{periodo.hasta}</output>;
}

const etiqueta = () => screen.getByTestId("etiqueta-periodo");
const chip = (n: string) => screen.getByRole("button", { name: n });
const anterior = () => screen.getByRole("button", { name: "Periodo anterior" });
const siguiente = () => screen.getByRole("button", { name: "Periodo siguiente" });

describe("Selector de periodo: chips y etiqueta", () => {
  it("muestra Hoy | Semana | Mes | Anio | Rango y empieza en el mes actual", () => {
    render(<Prueba />);
    const grupo = screen.getByRole("group", { name: "Tipo de periodo" });
    expect(within(grupo).getAllByRole("button").map((b) => b.textContent)).toEqual(["Hoy", "Semana", "Mes", "Año", "Rango"]);
    expect(chip("Mes")).toHaveAttribute("aria-pressed", "true");
    expect(chip("Semana")).toHaveAttribute("aria-pressed", "false");
    expect(etiqueta()).toHaveTextContent("Noviembre 2026");
  });

  it("cada chip muestra el periodo actual de ese tipo", async () => {
    const u = userEvent.setup();
    render(<Prueba />);
    await u.click(chip("Hoy"));
    expect(etiqueta()).toHaveTextContent("8 nov 2026");
    await u.click(chip("Semana"));
    expect(etiqueta()).toHaveTextContent("2 nov - 8 nov 2026");
    await u.click(chip("Año"));
    expect(etiqueta()).toHaveTextContent("2026");
    expect(chip("Año")).toHaveAttribute("aria-pressed", "true");
    expect(chip("Mes")).toHaveAttribute("aria-pressed", "false");
  });

  it("el mes respeta el dia de inicio de la familia", () => {
    render(<Prueba diaInicioMes={15} />);
    expect(etiqueta()).toHaveTextContent("15 oct - 14 nov");
    expect(screen.getByTestId("fechas")).toHaveTextContent("2026-10-15|2026-11-14");
  });

  it("los controles miden 44px o mas", () => {
    render(<Prueba />);
    for (const b of [...within(screen.getByRole("group", { name: "Tipo de periodo" })).getAllByRole("button"), anterior(), siguiente()])
      expect(b.className).toMatch(/min-h-\[44px\]/);
  });
});

describe("Selector de periodo: flechas", () => {
  it("anterior retrocede un periodo y habilita siguiente; siguiente vuelve al actual", async () => {
    const u = userEvent.setup();
    render(<Prueba />);
    await u.click(anterior());
    expect(etiqueta()).toHaveTextContent("Octubre 2026");
    expect(screen.getByTestId("fechas")).toHaveTextContent("2026-10-01|2026-10-31");
    expect(siguiente()).toBeEnabled();
    await u.click(siguiente());
    expect(etiqueta()).toHaveTextContent("Noviembre 2026");
    expect(screen.getByTestId("fechas")).toHaveTextContent("2026-11-01|2026-11-30");
  });

  it("la siguiente se desactiva si el periodo contiene hoy (en todos los tipos)", async () => {
    const u = userEvent.setup();
    render(<Prueba />);
    for (const n of ["Hoy", "Semana", "Mes", "Año"]) {
      await u.click(chip(n));
      expect(siguiente()).toBeDisabled();
    }
  });

  it("al retroceder varias veces y volver, la siguiente se desactiva justo en el periodo de hoy", async () => {
    const u = userEvent.setup();
    render(<Prueba />);
    await u.click(anterior());
    await u.click(anterior());
    expect(etiqueta()).toHaveTextContent("Septiembre 2026");
    await u.click(siguiente());
    expect(siguiente()).toBeEnabled();
    await u.click(siguiente());
    expect(etiqueta()).toHaveTextContent("Noviembre 2026");
    expect(siguiente()).toBeDisabled();
  });

  it("semana y anio cruzan correctamente los limites", async () => {
    const u = userEvent.setup();
    render(<Prueba />);
    await u.click(chip("Semana"));
    await u.click(anterior());
    expect(etiqueta()).toHaveTextContent("26 oct - 1 nov 2026"); // cruza de mes
    await u.click(chip("Año"));
    await u.click(anterior());
    expect(etiqueta()).toHaveTextContent("2025");
    expect(screen.getByTestId("fechas")).toHaveTextContent("2025-01-01|2025-12-31");
  });

  it("el dia retrocede de uno en uno", async () => {
    const u = userEvent.setup();
    render(<Prueba />);
    await u.click(chip("Hoy"));
    await u.click(anterior());
    expect(etiqueta()).toHaveTextContent("7 nov 2026");
    expect(screen.getByTestId("fechas")).toHaveTextContent("2026-11-07|2026-11-07");
  });

  it("con dia de inicio 15 las flechas mueven de 15 a 14", async () => {
    const u = userEvent.setup();
    render(<Prueba diaInicioMes={15} />);
    await u.click(anterior());
    expect(etiqueta()).toHaveTextContent("15 sep - 14 oct");
  });
});

describe("Selector de periodo: rango", () => {
  async function aplicar(u: ReturnType<typeof userEvent.setup>, desde: string, hasta: string) {
    await u.click(chip("Rango"));
    expect(await screen.findByRole("heading", { name: "Rango de fechas" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: desde } });
    fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: hasta } });
    await u.click(screen.getByRole("button", { name: "Aplicar rango" }));
  }

  it("'Rango' abre una pantalla con dos campos de fecha; al aplicar vuelve y muestra el rango", async () => {
    const u = userEvent.setup();
    render(<Prueba />);
    await u.click(chip("Rango"));
    expect(screen.getByLabelText("Desde")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("Hasta")).toHaveAttribute("type", "date");
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-10-10" } });
    await u.click(screen.getByRole("button", { name: "Aplicar rango" }));
    expect(await screen.findByRole("heading", { name: "Inicio" })).toBeInTheDocument();
    expect(etiqueta()).toHaveTextContent("1 oct - 10 oct 2026");
    expect(screen.getByTestId("fechas")).toHaveTextContent("2026-10-01|2026-10-10");
    expect(chip("Rango")).toHaveAttribute("aria-pressed", "true");
  });

  it("las flechas mueven el rango por su mismo largo", async () => {
    const u = userEvent.setup();
    render(<Prueba />);
    await aplicar(u, "2026-10-01", "2026-10-10");
    await u.click(anterior());
    expect(screen.getByTestId("fechas")).toHaveTextContent("2026-09-21|2026-09-30");
    await u.click(siguiente());
    await u.click(siguiente());
    expect(screen.getByTestId("fechas")).toHaveTextContent("2026-10-11|2026-10-20");
  });

  it("un rango que contiene hoy desactiva la siguiente", async () => {
    const u = userEvent.setup();
    render(<Prueba />);
    await aplicar(u, "2026-11-05", "2026-11-12");
    expect(siguiente()).toBeDisabled();
  });

  it("desde posterior a hasta: lo dice debajo del campo y no cambia el periodo", async () => {
    const u = userEvent.setup();
    render(<Prueba />);
    await aplicar(u, "2026-10-20", "2026-10-10");
    expect(await screen.findByRole("alert")).toHaveTextContent("La fecha desde no puede ser posterior a la fecha hasta");
    expect(screen.getByRole("heading", { name: "Rango de fechas" })).toBeInTheDocument(); // se queda en la pantalla
  });

  it("un campo vacio pide las dos fechas", async () => {
    const u = userEvent.setup();
    render(<Prueba />);
    await aplicar(u, "", "2026-10-10");
    expect(await screen.findByRole("alert")).toHaveTextContent("Elige las dos fechas");
  });

  it("volver a abrir 'Rango' muestra las fechas del periodo que se estaba viendo", async () => {
    const u = userEvent.setup();
    render(<Prueba />);
    await u.click(chip("Rango"));
    expect(screen.getByLabelText("Desde")).toHaveValue("2026-11-01");
    expect(screen.getByLabelText("Hasta")).toHaveValue("2026-11-30");
  });

  it("el rango de un solo dia es valido", async () => {
    const u = userEvent.setup();
    render(<Prueba />);
    await aplicar(u, "2026-10-05", "2026-10-05");
    expect(screen.getByTestId("fechas")).toHaveTextContent("2026-10-05|2026-10-05");
  });
});

describe("Selector de periodo: se conserva al navegar y se reinicia al salir", () => {
  it("el periodo elegido sigue igual en las demas pantallas", async () => {
    const u = userEvent.setup();
    render(<Prueba />);
    await u.click(anterior());
    await u.click(chip("Semana"));
    await u.click(anterior());
    const elegido = etiqueta().textContent;
    await u.click(screen.getByRole("link", { name: "ir a Reportes" }));
    expect(await screen.findByRole("heading", { name: "Reportes" })).toBeInTheDocument();
    expect(etiqueta().textContent).toBe(elegido);
    expect(chip("Semana")).toHaveAttribute("aria-pressed", "true");
    await u.click(anterior()); // se cambia alla...
    await u.click(screen.getByRole("link", { name: "ir a Inicio" }));
    expect(await screen.findByRole("heading", { name: "Inicio" })).toBeInTheDocument();
    expect(etiqueta().textContent).not.toBe(elegido); // ...y se ve igual aca: es UN solo periodo compartido
    expect(screen.getByTestId("fechas")).toHaveTextContent("2026-10-19|2026-10-25");
  });

  it("un rango tambien se conserva al navegar", async () => {
    const u = userEvent.setup();
    render(<Prueba />);
    await u.click(chip("Rango"));
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-10-10" } });
    await u.click(screen.getByRole("button", { name: "Aplicar rango" }));
    await u.click(await screen.findByRole("link", { name: "ir a Reportes" }));
    expect(await screen.findByTestId("etiqueta-periodo")).toHaveTextContent("1 oct - 10 oct 2026");
  });

  it("al cerrar sesion se reinicia a 'Mes actual'", async () => {
    const u = userEvent.setup();
    render(<Prueba />);
    await u.click(chip("Año"));
    await u.click(anterior());
    expect(etiqueta()).toHaveTextContent("2025");
    await u.click(screen.getByRole("button", { name: "cerrar sesion" }));
    expect(etiqueta()).toHaveTextContent("Noviembre 2026");
    expect(chip("Mes")).toHaveAttribute("aria-pressed", "true");
  });

  it("al entrar con otra cuenta tambien empieza en el mes actual", async () => {
    const u = userEvent.setup();
    render(<Prueba />);
    await u.click(anterior());
    await u.click(screen.getByRole("button", { name: "entrar otra cuenta" }));
    expect(etiqueta()).toHaveTextContent("Noviembre 2026");
  });
});
