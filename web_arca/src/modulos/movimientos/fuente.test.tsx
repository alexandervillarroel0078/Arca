// Fuente de pago (0010): hoja "¿Efectivo o Banco?", chip "Pagado con", envío directo con banco, marcas y la cola.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AvisoProvider } from "../../core/Aviso";
import { ErrorRed } from "../../core/api";
import * as apoyos from "../apoyos/api";
import * as cuentas from "../cuentas/api";
import * as familia from "../familia/api";
import { MENSAJE_BANCO_SIN_COLA, operar } from "../sync/operaciones";
import * as mov from "./api";
import * as fuente from "./fuente";
import { marcaFuente } from "./fuente";
import HojaFuente from "./HojaFuente";
import PaginaNuevo from "./PaginaNuevo";
import { registrar } from "./registrar";

vi.mock("../familia/api", () => ({ listarCategorias: vi.fn() }));
vi.mock("../apoyos/api", () => ({ listarApoyos: vi.fn(), obtenerApoyo: vi.fn(), editarApoyo: vi.fn() }));
vi.mock("./api", () => ({ obtenerMovimiento: vi.fn(), editarMovimiento: vi.fn() }));
vi.mock("./registrar", () => ({ registrar: vi.fn() }));
vi.mock("../cuentas/api", () => ({ listarFuentes: vi.fn(), resumenPorConfirmar: vi.fn() }));
vi.mock("./fuente", async (original) => ({
  ...(await original<typeof import("./fuente")>()),
  crearConBanco: vi.fn(),
  editarConBanco: vi.fn(),
}));

const CUENTAS: cuentas.CuentaFuente[] = [
  { id: 7, nombre: "Mi Unión", tipo: "corriente", banco: "Banco Unión", banco_otro: null, ultimos4: "1234", directo: true, confirma_nombre: null },
  { id: 9, nombre: "BNB de Beto", tipo: "ahorro", banco: "BNB", banco_otro: null, ultimos4: null, directo: false, confirma_nombre: "Beto" },
];

let enLinea = true;
beforeEach(() => {
  enLinea = true;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => enLinea);
  localStorage.clear();
  vi.mocked(familia.listarCategorias).mockResolvedValue([{ id: 1, nombre: "Comida", icono: "utensils", activa: true }]);
  vi.mocked(apoyos.listarApoyos).mockResolvedValue([]);
  vi.mocked(registrar).mockReset().mockResolvedValue("enviado");
  vi.mocked(cuentas.listarFuentes).mockReset().mockResolvedValue(CUENTAS);
  vi.mocked(cuentas.resumenPorConfirmar).mockResolvedValue({ cantidad: 0, rechazos: [] });
  vi.mocked(fuente.crearConBanco).mockReset().mockResolvedValue({} as never);
  vi.mocked(fuente.editarConBanco).mockReset().mockResolvedValue({} as never);
  vi.mocked(mov.editarMovimiento).mockReset().mockResolvedValue({} as never);
});
afterEach(() => vi.restoreAllMocks());

function abrir(ui: ReactElement, ruta: string, patron: string, state?: unknown) {
  return render(
    <AvisoProvider>
      <MemoryRouter initialEntries={[{ pathname: ruta, state }]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path={patron} element={ui} />
          <Route path="*" element={<div data-testid="otra-pantalla" />} />
        </Routes>
      </MemoryRouter>
    </AvisoProvider>,
  );
}

describe("Hoja «¿Efectivo o Banco?»", () => {
  it("Banco se despliega ahí mismo con las cuentas y su marca; elegir una la devuelve", async () => {
    const u = userEvent.setup();
    const alElegir = vi.fn();
    render(<HojaFuente alElegir={alElegir} alCerrar={vi.fn()} />);
    await u.click(screen.getByRole("button", { name: /Banco/ }));
    const grupo = await screen.findByRole("group", { name: "Cuentas de banco" });
    const [propia, ajena] = await within(grupo).findAllByTestId("opcion-cuenta");
    expect(propia).toHaveTextContent("Mi Unión");
    expect(propia).toHaveTextContent("Se registra directo");
    expect(ajena).toHaveTextContent("Requiere confirmación de Beto");
    await u.click(ajena);
    expect(alElegir).toHaveBeenCalledWith({ id: 9, nombre: "BNB de Beto", directo: false, confirma_nombre: "Beto" });
  });

  it("Efectivo devuelve null", async () => {
    const u = userEvent.setup();
    const alElegir = vi.fn();
    render(<HojaFuente alElegir={alElegir} alCerrar={vi.fn()} />);
    await u.click(screen.getByRole("button", { name: /Efectivo/ }));
    expect(alElegir).toHaveBeenCalledWith(null);
  });

  it("sin conexión Banco queda deshabilitado (solo Efectivo) y no pide cuentas", () => {
    enLinea = false;
    render(<HojaFuente alElegir={vi.fn()} alCerrar={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Banco/ })).toBeDisabled();
    expect(screen.getByText("Sin conexión: solo efectivo")).toBeInTheDocument();
    expect(cuentas.listarFuentes).not.toHaveBeenCalled();
  });

  it("si la última fuente fue una cuenta, Banco empieza desplegado con ella marcada", async () => {
    localStorage.setItem("arca-fuente-ultima", "7");
    render(<HojaFuente alElegir={vi.fn()} alCerrar={vi.fn()} />);
    const [propia] = await screen.findAllByTestId("opcion-cuenta");
    expect(propia).toHaveTextContent("Última usada");
  });
});

describe("Nuevo movimiento con fuente", () => {
  const nuevo = (f: fuente.FuenteElegida | null) => abrir(<PaginaNuevo />, "/nuevo", "/nuevo", { fuente: f });

  it("Efectivo: chip «Pagado con: Efectivo» y va por la cola (sin cuenta_id)", async () => {
    const u = userEvent.setup();
    nuevo(null);
    expect(screen.getByTestId("chip-fuente")).toHaveTextContent("Efectivo");
    await u.type(screen.getByLabelText("Monto"), "10");
    await u.click(await screen.findByRole("radio", { name: /Comida/ }));
    await u.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(registrar).toHaveBeenCalled());
    expect(vi.mocked(registrar).mock.calls[0][0].datos).not.toHaveProperty("cuenta_id");
    expect(fuente.crearConBanco).not.toHaveBeenCalled();
    expect(localStorage.getItem("arca-fuente-ultima")).toBe('"efectivo"');
  });

  it("cuenta ajena: avisa que requiere confirmación y se envía DIRECTO con cuenta_id (nunca por la cola)", async () => {
    const u = userEvent.setup();
    nuevo({ id: 9, nombre: "BNB de Beto", directo: false, confirma_nombre: "Beto" });
    expect(screen.getByTestId("chip-fuente")).toHaveTextContent("BNB de Beto");
    expect(screen.getByTestId("aviso-confirmacion")).toHaveTextContent("Requiere confirmación de Beto");
    await u.type(screen.getByLabelText("Monto"), "25.50");
    await u.click(await screen.findByRole("radio", { name: /Comida/ }));
    await u.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(fuente.crearConBanco).toHaveBeenCalled());
    const [clase, datos] = vi.mocked(fuente.crearConBanco).mock.calls[0];
    expect(clase).toBe("movimiento");
    expect(datos).toMatchObject({ tipo: "gasto", monto: 25.5, categoria_id: 1, cuenta_id: 9 });
    expect(registrar).not.toHaveBeenCalled();
    expect(await screen.findByTestId("otra-pantalla")).toBeInTheDocument();
  });

  it("con banco y sin conexión: no se guarda y dice que necesita conexión", async () => {
    const u = userEvent.setup();
    vi.mocked(fuente.crearConBanco).mockRejectedValue(new ErrorRed(MENSAJE_BANCO_SIN_COLA));
    nuevo({ id: 7, nombre: "Mi Unión", directo: true, confirma_nombre: null });
    await u.type(screen.getByLabelText("Monto"), "5");
    await u.click(await screen.findByRole("radio", { name: /Comida/ }));
    await u.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("El pago con banco necesita conexión");
    expect(registrar).not.toHaveBeenCalled();
  });

  it("el chip abre la hoja y permite cambiar a Efectivo", async () => {
    const u = userEvent.setup();
    nuevo({ id: 7, nombre: "Mi Unión", directo: true, confirma_nombre: null });
    await u.click(screen.getByTestId("chip-fuente"));
    const hoja = screen.getByRole("dialog", { name: "¿Efectivo o Banco?" });
    await u.click(within(hoja).getByRole("button", { name: /Efectivo/ }));
    expect(screen.getByTestId("chip-fuente")).toHaveTextContent("Efectivo");
  });
});

describe("Editar con fuente", () => {
  const GASTO: mov.Movimiento = {
    id: 5, tipo: "gasto", monto: 40, fecha: "2026-11-20", categoria_id: 1, categoria_nombre: "Comida", categoria_icono: "utensils",
    nota: null, usuario_id: 1, usuario_nombre: "Ana", version: 3, anulado: false,
    fuente: "banco", cuenta_id: 9, cuenta_nombre: "BNB de Beto", estado_cuenta: "pendiente", confirma_nombre: "Beto",
  } as mov.Movimiento;
  const editar = () => abrir(<PaginaNuevo />, "/editar/movimiento/5", "/editar/:clase/:id");

  it("muestra la cuenta y su estado; pasar a Efectivo va por la cola con cuenta_id null", async () => {
    const u = userEvent.setup();
    vi.mocked(mov.obtenerMovimiento).mockResolvedValue(GASTO);
    editar();
    expect(await screen.findByTestId("chip-fuente")).toHaveTextContent("BNB de Beto");
    expect(screen.getByTestId("etiqueta-fuente")).toHaveTextContent("Pendiente de confirmar · BNB de Beto");
    await u.click(screen.getByTestId("chip-fuente"));
    await u.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Efectivo/ }));
    await u.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(mov.editarMovimiento).toHaveBeenCalled());
    expect(vi.mocked(mov.editarMovimiento).mock.calls[0][1]).toMatchObject({ cuenta_id: null });
    expect(fuente.editarConBanco).not.toHaveBeenCalled();
  });

  it("sin cambiar la fuente no se manda cuenta_id; pasar a ingreso con banco se frena", async () => {
    const u = userEvent.setup();
    vi.mocked(mov.obtenerMovimiento).mockResolvedValue(GASTO);
    editar();
    await screen.findByTestId("chip-fuente");
    await u.click(screen.getByRole("tab", { name: "Ingreso" }));
    await u.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Un gasto pagado con banco no se puede pasar a ingreso");
    await u.click(screen.getByRole("tab", { name: "Gasto" }));
    await u.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(mov.editarMovimiento).toHaveBeenCalled());
    expect(vi.mocked(mov.editarMovimiento).mock.calls[0][1]).not.toHaveProperty("cuenta_id");
  });

  it("cambiar a otra cuenta va directo, con la version", async () => {
    const u = userEvent.setup();
    vi.mocked(mov.obtenerMovimiento).mockResolvedValue(GASTO);
    editar();
    await u.click(await screen.findByTestId("chip-fuente"));
    const hoja = screen.getByRole("dialog");
    const [propia] = await within(hoja).findAllByTestId("opcion-cuenta");
    await u.click(propia);
    await u.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(fuente.editarConBanco).toHaveBeenCalled());
    const [clase, id, cambios, version] = vi.mocked(fuente.editarConBanco).mock.calls[0];
    expect([clase, id, version]).toEqual(["movimiento", 5, 3]);
    expect(cambios).toMatchObject({ cuenta_id: 7 });
  });
});

describe("Marcas de la fuente en las filas", () => {
  it("pendiente, confirmado, rechazado y efectivo", () => {
    expect(marcaFuente({ fuente: "banco", cuenta_nombre: "BNB", estado_cuenta: "pendiente" })?.texto).toBe("Pendiente de confirmar · BNB");
    expect(marcaFuente({ fuente: "banco", cuenta_nombre: "BNB", estado_cuenta: "confirmado" })?.texto).toBe("Confirmado · BNB");
    expect(marcaFuente({ fuente: "efectivo", rechazado_por_nombre: "Beto" })?.texto).toBe("Rechazado por Beto · ahora Efectivo");
    expect(marcaFuente({ fuente: "efectivo" })).toBeNull();
    expect(marcaFuente({})).toBeNull(); // registros guardados antes (sin dato) = Efectivo
  });
});

describe("La cola sin conexión solo acepta Efectivo", () => {
  it("una operación con cuenta_id se rechaza antes de encolarse", async () => {
    await expect(
      operar({ entidad: "movimiento", accion: "crear", uuid: "u-1", datos: { tipo: "gasto", monto: 1, cuenta_id: 9 } }),
    ).rejects.toThrow(MENSAJE_BANCO_SIN_COLA);
  });
});
