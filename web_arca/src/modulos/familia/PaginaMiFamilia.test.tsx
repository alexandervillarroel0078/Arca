// Familia > Mi familia: el dia de inicio del mes (1 a 28) lo cambia solo el administrador.
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { admin, miembro, renderPantalla } from "../../test/ayudas";
import type { Yo } from "../auth/api";
import * as api from "./api";
import PaginaMiFamilia from "./PaginaMiFamilia";

const sesion = vi.hoisted(() => ({ usuario: null as Yo | null, actualizarUsuario: vi.fn() }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => sesion }));
vi.mock("./api", () => ({ cambiarDiaInicioMes: vi.fn() }));

const A = vi.mocked(api);
const abrir = (u: Yo = admin) => {
  sesion.usuario = u;
  return renderPantalla(<PaginaMiFamilia />, { ruta: "/familia/mi-familia", hoy: "2026-11-08" });
};
const campo = () => screen.getByLabelText(/Día de inicio del mes/);

beforeEach(() => {
  sesion.actualizarUsuario.mockReset();
  A.cambiarDiaInicioMes.mockReset();
  A.cambiarDiaInicioMes.mockImplementation(async (dia) => ({ id: 1, nombre: "Familia Prueba", dia_inicio_mes: dia }));
});

describe("Mi familia: dia de inicio del mes", () => {
  it("el admin ve el nombre de la familia y el campo con el valor actual (1 por defecto)", () => {
    abrir();
    expect(screen.getByTestId("nombre-familia")).toHaveTextContent("Familia Prueba");
    expect(campo()).toHaveValue(1);
    expect(campo()).toHaveAttribute("min", "1");
    expect(campo()).toHaveAttribute("max", "28");
  });

  it("explica el efecto con un ejemplo y que no cierra ni bloquea nada", () => {
    abrir();
    const nota = screen.getByTestId("nota-dia-inicio");
    expect(nota).toHaveTextContent("Con 1 es el mes calendario");
    expect(nota).toHaveTextContent("pon 15");
    expect(nota).toHaveTextContent("15 nov - 14 dic");
    expect(nota).toHaveTextContent("no se mueve, cierra ni bloquea ningún registro");
  });

  it("muestra como quedaria el mes de hoy antes de guardar", async () => {
    const u = userEvent.setup();
    abrir();
    await u.clear(campo());
    await u.type(campo(), "15");
    expect(screen.getByTestId("vista-previa-dia-inicio")).toHaveTextContent("15 oct - 14 nov");
    await u.clear(campo());
    await u.type(campo(), "28");
    expect(screen.getByTestId("vista-previa-dia-inicio")).toHaveTextContent("28 oct - 27 nov");
  });

  it("guarda el dia, actualiza la sesion y avisa", async () => {
    const u = userEvent.setup();
    abrir();
    await u.clear(campo());
    await u.type(campo(), "15");
    await u.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(A.cambiarDiaInicioMes).toHaveBeenCalledWith(15));
    expect(sesion.actualizarUsuario).toHaveBeenCalledWith(expect.objectContaining({ id: 1, dia_inicio_mes: 15 }));
    expect(await screen.findByText("El mes ahora empieza el día 15")).toBeInTheDocument();
  });

  it.each(["0", "29", "-3", "1.5", ""])("'%s' no es valido: no guarda", async (texto) => {
    const u = userEvent.setup();
    abrir();
    await u.clear(campo());
    if (texto) await u.type(campo(), texto);
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
    expect(A.cambiarDiaInicioMes).not.toHaveBeenCalled();
    expect(screen.queryByTestId("vista-previa-dia-inicio")).not.toBeInTheDocument();
  });

  it("sin cambios no se puede guardar", () => {
    abrir();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
  });

  it("un error del servidor se muestra debajo del campo", async () => {
    A.cambiarDiaInicioMes.mockRejectedValue(new Error("Solo un administrador puede hacerlo"));
    const u = userEvent.setup();
    abrir();
    await u.clear(campo());
    await u.type(campo(), "20");
    await u.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Solo un administrador puede hacerlo");
    expect(sesion.actualizarUsuario).not.toHaveBeenCalled();
  });

  it("un miembro NO ve el control: solo un texto con el dia actual", () => {
    abrir({ ...miembro, dia_inicio_mes: 15 });
    expect(screen.queryByLabelText(/Día de inicio del mes/)).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Guardar" })).not.toBeInTheDocument();
    expect(screen.getByTestId("dia-inicio-solo-lectura")).toHaveTextContent("empieza el día 15. Solo un administrador puede cambiarlo");
  });

  it("el campo mide 52px o mas (sistema de diseno)", () => {
    abrir();
    expect(campo().className).toContain("min-h-[52px]");
  });
});
