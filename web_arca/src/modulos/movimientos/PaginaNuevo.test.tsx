import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorApi } from "../../core/api";
import { ayerISO, hoyISO } from "../../core/formato";
import { renderPantalla, sinAuditoria } from "../../test/ayudas";
import * as apoyos from "../apoyos/api";
import * as familia from "../familia/api";
import * as mov from "./api";
import PaginaNuevo from "./PaginaNuevo";
import { registrar } from "./registrar";

vi.mock("../familia/api", () => ({ listarCategorias: vi.fn() }));
vi.mock("../apoyos/api", () => ({ listarApoyos: vi.fn(), obtenerApoyo: vi.fn(), editarApoyo: vi.fn() }));
vi.mock("./api", () => ({ obtenerMovimiento: vi.fn(), editarMovimiento: vi.fn() }));
vi.mock("./registrar", () => ({ registrar: vi.fn() }));

const CATEGORIAS = [
  { id: 1, nombre: "Transporte", icono: "bus", activa: true },
  { id: 2, nombre: "Comida", icono: "utensils", activa: true },
  { id: 3, nombre: "Antojos", icono: "cookie", activa: false }, // desactivada: no se ofrece
];

beforeEach(() => {
  vi.mocked(familia.listarCategorias).mockResolvedValue(CATEGORIAS);
  vi.mocked(apoyos.listarApoyos).mockResolvedValue([]);
  vi.mocked(registrar).mockResolvedValue("enviado");
});

const abrirNuevo = () => renderPantalla(<PaginaNuevo />, { ruta: "/nuevo" });
const monto = () => screen.getByLabelText("Monto");
const guardar = () => screen.getByRole("button", { name: "Guardar" });

describe("Nuevo movimiento: validaciones", () => {
  it("sin monto no guarda y lo dice", async () => {
    const u = userEvent.setup();
    abrirNuevo();
    await u.click(guardar());
    expect(screen.getByRole("alert")).toHaveTextContent("Escribe un monto mayor a cero");
    expect(registrar).not.toHaveBeenCalled();
  });

  it("monto cero o con mas de 2 decimales se rechaza", async () => {
    const u = userEvent.setup();
    abrirNuevo();
    await u.type(monto(), "0");
    await u.click(guardar());
    expect(screen.getByRole("alert")).toHaveTextContent("Escribe un monto mayor a cero");
    await u.clear(monto());
    await u.type(monto(), "10.123");
    await u.click(guardar());
    expect(screen.getByRole("alert")).toHaveTextContent("El monto admite hasta 2 decimales");
    expect(registrar).not.toHaveBeenCalled();
  });

  it("el campo monto solo acepta digitos, punto y coma", async () => {
    const u = userEvent.setup();
    abrirNuevo();
    await u.type(monto(), "a1b2,5-x");
    expect(monto()).toHaveValue("12,5");
  });

  it("un gasto sin categoria no se guarda", async () => {
    const u = userEvent.setup();
    abrirNuevo();
    await u.type(monto(), "10");
    await u.click(guardar());
    expect(screen.getByRole("alert")).toHaveTextContent("Elige una categoría");
    expect(registrar).not.toHaveBeenCalled();
  });

  it("un apoyo sin beneficiario no se guarda", async () => {
    const u = userEvent.setup();
    abrirNuevo();
    await u.click(screen.getByRole("tab", { name: "Apoyo" }));
    await u.type(monto(), "100");
    await u.click(guardar());
    expect(screen.getByRole("alert")).toHaveTextContent("Escribe quién recibe el apoyo");
    expect(registrar).not.toHaveBeenCalled();
  });
});

describe("Nuevo movimiento: Bloque A (Guardar a la vista, error enfocado, atajos de fecha)", () => {
  it("Hoy y Ayer cambian la fecha que se manda; Hoy esta marcado al empezar", async () => {
    const u = userEvent.setup();
    abrirNuevo();
    expect(screen.getByRole("button", { name: "Hoy" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Ayer" })).toHaveAttribute("aria-pressed", "false");
    await u.click(screen.getByRole("button", { name: "Ayer" }));
    expect(screen.getByRole("button", { name: "Ayer" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Hoy" })).toHaveAttribute("aria-pressed", "false");
    await u.type(monto(), "10");
    await u.click(await screen.findByRole("radio", { name: /Comida/ }));
    await u.click(guardar());
    await waitFor(() => expect(registrar).toHaveBeenCalledTimes(1));
    expect(vi.mocked(registrar).mock.calls[0][0].datos.fecha).toBe(ayerISO());
    expect(ayerISO() < hoyISO()).toBe(true);
  });

  it("Guardar vive en la barra fija sobre la navegacion y sigue enviando el formulario", async () => {
    abrirNuevo();
    const barra = guardar().closest(".fixed");
    expect(barra).not.toBeNull();
    expect(guardar()).toHaveAttribute("type", "submit");
  });

  it("al fallar una validacion se baja al mensaje y se enfoca (sigue siendo un alert)", async () => {
    const u = userEvent.setup();
    const bajar = vi.fn();
    Element.prototype.scrollIntoView = bajar;
    abrirNuevo();
    await u.type(monto(), "10");
    await u.click(guardar());
    const alerta = screen.getByRole("alert");
    expect(alerta).toHaveTextContent("Elige una categoría");
    expect(bajar).toHaveBeenCalled();
    expect(document.activeElement).toBe(alerta.parentElement); // el contenedor del mensaje recibe el foco
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });
});

describe("Nuevo movimiento: guardar", () => {
  it("gasto: manda tipo, monto (coma decimal), fecha de hoy, categoria y nota; luego vuelve a Inicio", async () => {
    const u = userEvent.setup();
    abrirNuevo();
    await u.type(monto(), "45,5");
    await u.click(await screen.findByRole("radio", { name: /Comida/ }));
    await u.type(screen.getByLabelText("Nota (opcional)"), "  Almuerzo  ");
    await u.click(guardar());
    await waitFor(() => expect(registrar).toHaveBeenCalledTimes(1));
    expect(registrar).toHaveBeenCalledWith({
      clase: "movimiento",
      datos: { tipo: "gasto", monto: 45.5, fecha: hoyISO(), categoria_id: 2, nota: "Almuerzo", visibilidad: "familia", compartido_con: [] },
    });
    expect(await screen.findByText("Guardado")).toBeInTheDocument();
    expect(screen.getByTestId("ruta-actual")).toHaveTextContent("/");
    expect(screen.getByTestId("otra-pantalla")).toBeInTheDocument();
  });

  it("solo ofrece categorias activas", async () => {
    abrirNuevo();
    expect(await screen.findByRole("radio", { name: /Comida/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Transporte/ })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Antojos/ })).not.toBeInTheDocument();
  });

  it("ingreso: sin categoria y sin selector de categorias", async () => {
    const u = userEvent.setup();
    abrirNuevo();
    await u.click(screen.getByRole("tab", { name: "Ingreso" }));
    expect(screen.queryByRole("radiogroup", { name: "Categoría" })).not.toBeInTheDocument();
    await u.type(monto(), "1000");
    await u.click(guardar());
    await waitFor(() => expect(registrar).toHaveBeenCalled());
    expect(registrar).toHaveBeenCalledWith({
      clase: "movimiento",
      datos: { tipo: "ingreso", monto: 1000, fecha: hoyISO(), categoria_id: null, nota: null, visibilidad: "familia", compartido_con: [] },
    });
  });

  it("apoyo: manda beneficiario sin espacios sobrantes", async () => {
    const u = userEvent.setup();
    vi.mocked(apoyos.listarApoyos).mockResolvedValue([{ beneficiario: "Tia Rosa" }] as never);
    abrirNuevo();
    await u.click(screen.getByRole("tab", { name: "Apoyo" }));
    await u.type(monto(), "300");
    await u.type(screen.getByLabelText(/Beneficiario/), "  Tia Rosa ");
    await u.click(guardar());
    await waitFor(() => expect(registrar).toHaveBeenCalled());
    expect(registrar).toHaveBeenCalledWith({
      clase: "apoyo",
      datos: { beneficiario: "Tia Rosa", monto: 300, fecha: hoyISO(), nota: null, visibilidad: "familia", compartido_con: [] },
    });
  });

  it("ofrece los beneficiarios ya conocidos (sin repetir)", async () => {
    const u = userEvent.setup();
    vi.mocked(apoyos.listarApoyos).mockResolvedValue([{ beneficiario: "Tia Rosa" }, { beneficiario: "Luis" }, { beneficiario: "Tia Rosa" }] as never);
    const { container } = abrirNuevo();
    await u.click(screen.getByRole("tab", { name: "Apoyo" }));
    await waitFor(() => expect(container.querySelectorAll("datalist option")).toHaveLength(2));
  });

  it("sin internet el registro queda en cola y se avisa, pero igual vuelve a Inicio", async () => {
    const u = userEvent.setup();
    vi.mocked(registrar).mockResolvedValue("en_cola");
    abrirNuevo();
    await u.type(monto(), "10");
    await u.click(await screen.findByRole("radio", { name: /Transporte/ }));
    await u.click(guardar());
    expect(await screen.findByText("Sin internet: se guardó en el teléfono y se enviará luego")).toBeInTheDocument();
    expect(screen.getByTestId("otra-pantalla")).toBeInTheDocument();
  });

  it("si el servidor rechaza, muestra el motivo y no sale de la pantalla", async () => {
    const u = userEvent.setup();
    vi.mocked(registrar).mockRejectedValue(new ErrorApi(422, "La categoria esta desactivada"));
    abrirNuevo();
    await u.type(monto(), "10");
    await u.click(await screen.findByRole("radio", { name: /Comida/ }));
    await u.click(guardar());
    expect(await screen.findByRole("alert")).toHaveTextContent("La categoria esta desactivada");
    expect(screen.queryByTestId("otra-pantalla")).not.toBeInTheDocument();
    expect(guardar()).toBeEnabled();
  });

  it("sin conexion para las categorias, usa las guardadas en el telefono", async () => {
    vi.mocked(familia.listarCategorias).mockRejectedValue(new Error("sin red"));
    localStorage.setItem("arca-categorias", JSON.stringify([CATEGORIAS[0]]));
    abrirNuevo();
    expect(await screen.findByRole("radio", { name: /Transporte/ })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Comida/ })).not.toBeInTheDocument();
  });
});

describe("Editar (misma pantalla)", () => {
  const movimiento = (c = {}) => ({
    id: 9, tipo: "gasto" as const, monto: 45, fecha: "2026-11-03", categoria_id: 3, categoria_nombre: "Antojos",
    categoria_icono: "cookie", nota: "Helado", usuario_id: 1, usuario_nombre: "Ana", ...sinAuditoria, ...c,
  });
  const abrirEditar = (clase: string, id: number) =>
    renderPantalla(<PaginaNuevo />, { ruta: `/editar/${clase}/${id}`, patron: "/editar/:clase/:id" });

  it("movimiento: carga los datos, ofrece solo Gasto/Ingreso y conserva su categoria desactivada", async () => {
    vi.mocked(mov.obtenerMovimiento).mockResolvedValue(movimiento());
    abrirEditar("movimiento", 9);
    expect(await screen.findByRole("heading", { name: "Editar movimiento" })).toBeInTheDocument();
    expect(monto()).toHaveValue("45");
    expect(screen.getByLabelText("Nota (opcional)")).toHaveValue("Helado");
    expect(screen.getByLabelText("Fecha")).toHaveValue("2026-11-03");
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Gasto", "Ingreso"]);
    const actual = await screen.findByRole("radio", { name: /Antojos \(desactivada\)/ });
    expect(actual).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeInTheDocument();
  });

  it("movimiento: guarda solo con editarMovimiento (no crea uno nuevo)", async () => {
    const u = userEvent.setup();
    vi.mocked(mov.obtenerMovimiento).mockResolvedValue(movimiento({ categoria_id: 2, categoria_nombre: "Comida" }));
    vi.mocked(mov.editarMovimiento).mockResolvedValue({} as never);
    abrirEditar("movimiento", 9);
    await screen.findByRole("heading", { name: "Editar movimiento" });
    await u.clear(monto());
    await u.type(monto(), "60");
    await u.click(await screen.findByRole("radio", { name: /Transporte/ }));
    await u.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(mov.editarMovimiento).toHaveBeenCalledTimes(1));
    expect(mov.editarMovimiento).toHaveBeenCalledWith(9, { tipo: "gasto", monto: 60, fecha: "2026-11-03", categoria_id: 1, nota: "Helado" });  // (sin sesion en esta prueba: no se manda "quien lo ve")
    expect(registrar).not.toHaveBeenCalled();
    expect(await screen.findByText("Cambios guardados")).toBeInTheDocument();
  });

  it("movimiento: pasar a Ingreso no manda categoria", async () => {
    const u = userEvent.setup();
    vi.mocked(mov.obtenerMovimiento).mockResolvedValue(movimiento({ categoria_id: 2, categoria_nombre: "Comida" }));
    vi.mocked(mov.editarMovimiento).mockResolvedValue({} as never);
    abrirEditar("movimiento", 9);
    await screen.findByRole("heading", { name: "Editar movimiento" });
    await u.click(screen.getByRole("tab", { name: "Ingreso" }));
    await u.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(mov.editarMovimiento).toHaveBeenCalled());
    const [, cambios] = vi.mocked(mov.editarMovimiento).mock.calls[0];
    expect(cambios).toMatchObject({ tipo: "ingreso" });
    expect(cambios).not.toHaveProperty("categoria_id");
  });

  it("apoyo: sin selector de tipo, edita con editarApoyo y muestra el error del servidor", async () => {
    const u = userEvent.setup();
    vi.mocked(apoyos.obtenerApoyo).mockResolvedValue({
      id: 4, beneficiario: "Tia Rosa", monto: 500, fecha: "2026-11-01", nota: null,
    } as never);
    vi.mocked(apoyos.editarApoyo).mockRejectedValue(new ErrorApi(400, "El monto no puede ser menor a lo ya devuelto y consumido (Bs 300.00)"));
    abrirEditar("apoyo", 4);
    expect(await screen.findByRole("heading", { name: "Editar apoyo" })).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Beneficiario/)).toHaveValue("Tia Rosa");
    await u.clear(monto());
    await u.type(monto(), "100");
    await u.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("lo ya devuelto y consumido (Bs 300.00)");
    expect(apoyos.editarApoyo).toHaveBeenCalledWith(4, { beneficiario: "Tia Rosa", monto: 100, fecha: "2026-11-01", nota: null, visibilidad: "familia", compartido_con: [] });
  });

  it("en desarrollo (StrictMode) una respuesta tardia de la 1a ejecucion NO pisa lo que el usuario ya escribio", async () => {
    const u = userEvent.setup();
    // StrictMode ejecuta el efecto dos veces: [0] es la ejecucion cancelada y [1] la vigente.
    const respuestas: ((m: mov.Movimiento) => void)[] = [];
    vi.mocked(mov.obtenerMovimiento).mockImplementation(() => new Promise((res) => { respuestas.push(res as never); }));
    vi.mocked(mov.editarMovimiento).mockResolvedValue({} as never);
    renderPantalla(<PaginaNuevo />, { ruta: "/editar/movimiento/9", patron: "/editar/:clase/:id", estricto: true });
    await waitFor(() => expect(respuestas.length).toBeGreaterThanOrEqual(2));

    const datos = movimiento({ categoria_id: 2, categoria_nombre: "Comida" });
    respuestas[respuestas.length - 1](datos); // llega primero la respuesta vigente: aparece el formulario
    const campo = await screen.findByLabelText("Monto");
    await u.clear(campo);
    await u.type(campo, "60");
    respuestas.slice(0, -1).forEach((r) => r(datos)); // y despues llega la respuesta rezagada de la ejecucion cancelada
    await new Promise((r) => setTimeout(r, 50));
    expect(campo).toHaveValue("60"); // no se vuelve a "45"
    await u.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(mov.editarMovimiento).toHaveBeenCalled());
    expect(vi.mocked(mov.editarMovimiento).mock.calls[0][1]).toMatchObject({ monto: 60 });
  });

  it("si el registro no se puede cargar, muestra el error", async () => {
    vi.mocked(mov.obtenerMovimiento).mockRejectedValue(new Error("Movimiento no encontrado"));
    abrirEditar("movimiento", 99);
    const alerta = await screen.findByRole("alert");
    expect(within(alerta.parentElement!).getByText("Movimiento no encontrado")).toBeInTheDocument();
  });
});
