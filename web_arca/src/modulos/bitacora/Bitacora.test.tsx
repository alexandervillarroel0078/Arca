import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { admin, miembro, renderPantalla } from "../../test/ayudas";
import type { Yo } from "../auth/api";
import * as familia from "../familia/api";
import * as api from "./api";
import { FILTROS_VACIOS } from "./api";
import EntradaBitacoraVista, { estiloEntrada } from "./EntradaBitacoraVista";
import PaginaBitacora, { opcionesDeEvento, rangoAFiltro } from "./PaginaBitacora";
import { resumenDispositivo } from "./dispositivo";

const sesion = vi.hoisted(() => ({ usuario: null as Yo | null }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => sesion }));
vi.mock("../familia/api", () => ({ listarMiembros: vi.fn() }));
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  listarBitacora: vi.fn(),
  resumenBitacora: vi.fn(),
  exportarCsv: vi.fn(),
}));
const A = vi.mocked(api);
const F = vi.mocked(familia);

const fecha = new Date(2026, 10, 3, 14, 5).toISOString();
const entrada = (n: number, c: Partial<api.EntradaBitacora> = {}): api.EntradaBitacora => ({
  clave: `acceso-${n}`, origen: "acceso", evento: "login_ok", etiqueta: "Entrada", titulo: "Ana Admin inicio sesion", resultado: "ok",
  fecha, fecha_real: fecha, fecha_sincronizacion: null, usuario_id: 1, usuario_nombre: "Ana Admin", correo_intentado: "ana@t.com",
  ip: "190.1.2.3", dispositivo: "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36", detalle: [], motivo: null,
  entidad: null, entidad_id: null, ...c,
});
const datos = (n: number, c: Partial<api.EntradaBitacora> = {}) =>
  entrada(n, {
    clave: `datos-${n}`, origen: "datos", evento: "editar", etiqueta: "Editado", titulo: "Edito gasto Comida Bs 60.00", ip: null,
    dispositivo: null, correo_intentado: null, detalle: ["Monto: Bs 45.00 -> Bs 60.00"], entidad: "movimiento", entidad_id: 7, ...c,
  });
const pagina = (items: api.EntradaBitacora[], hay_mas = false, siguiente: string | null = null): api.PaginaBitacora => ({ items, hay_mas, siguiente });
const resumen = (c: Partial<api.ResumenBitacora> = {}): api.ResumenBitacora => ({
  ultimos_accesos: [
    { usuario_id: 1, nombre: "Ana Admin", rol: "admin", activo: true, ultimo_login: fecha, ip: "190.1.2.3", dispositivo: "Mozilla/5.0 (Android 14) Chrome/120" },
    { usuario_id: 2, nombre: "Beto Miembro", rol: "miembro", activo: true, ultimo_login: null, ip: null, dispositivo: null },
  ],
  fallos_login_7d: 0, bloqueos_login_7d: 0, fallos_por_usuario: [], novedades: [], ...c,
});

const abrir = (usuario: Yo = admin) => {
  sesion.usuario = usuario;
  return renderPantalla(<PaginaBitacora />, { ruta: "/familia/bitacora" });
};
const ultimaLlamada = () => A.listarBitacora.mock.calls[A.listarBitacora.mock.calls.length - 1];

beforeEach(() => {
  A.listarBitacora.mockReset().mockResolvedValue(pagina([entrada(1), datos(2)]));
  A.resumenBitacora.mockReset().mockResolvedValue(resumen());
  A.exportarCsv.mockReset().mockResolvedValue();
  F.listarMiembros.mockReset().mockResolvedValue([
    { usuario_id: 1, nombre: "Ana Admin", email: "ana@t.com", rol: "admin", activo: true },
    { usuario_id: 2, nombre: "Beto Miembro", email: "beto@t.com", rol: "miembro", activo: true },
  ]);
});

describe("Bitacora: permisos", () => {
  it("un miembro es redirigido a Familia y no se pide nada al servidor", async () => {
    abrir(miembro);
    expect(await screen.findByTestId("otra-pantalla")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Bitácora" })).not.toBeInTheDocument();
    expect(A.listarBitacora).not.toHaveBeenCalled();
    expect(A.resumenBitacora).not.toHaveBeenCalled();
  });

  it("el admin ve la pantalla con '< Volver' hacia Familia", async () => {
    abrir();
    expect(await screen.findByRole("heading", { name: "Bitácora" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Volver" })).toBeInTheDocument();
    await screen.findAllByTestId("entrada-bitacora");
  });
});

describe("Bitacora: resumen", () => {
  it("muestra el ultimo acceso de cada persona (o 'Nunca entro')", async () => {
    abrir();
    const filas = await screen.findAllByTestId("ultimo-acceso");
    expect(filas).toHaveLength(2);
    expect(filas[0]).toHaveTextContent("Ana Admin");
    expect(filas[0]).toHaveTextContent("3 nov 14:05");
    expect(filas[0]).toHaveTextContent("IP 190.1.2.3");
    expect(filas[0]).toHaveTextContent("Chrome en Android");
    expect(filas[1]).toHaveTextContent("Beto Miembro");
    expect(filas[1]).toHaveTextContent("Nunca entró");
  });

  it("sin fallos dice que todo esta tranquilo; con fallos muestra el numero y quienes", async () => {
    abrir();
    expect(await screen.findByTestId("fallos-semana")).toHaveTextContent("Sin intentos fallidos en los últimos 7 días");
  });

  it("con fallos y bloqueos los cuenta y los reparte por persona", async () => {
    A.resumenBitacora.mockResolvedValue(resumen({
      fallos_login_7d: 3, bloqueos_login_7d: 1, fallos_por_usuario: [{ usuario_id: 2, nombre: "Beto Miembro", fallos: 3 }],
      novedades: [{ usuario_id: 1, nombre: "Ana Admin", tipo: "ip", valor: "200.5.5.5", primera_vez: fecha }],
    }));
    abrir();
    const f = await screen.findByTestId("fallos-semana");
    expect(f).toHaveTextContent("3 intentos fallidos de entrada");
    expect(f).toHaveTextContent("1 bloqueo");
    expect(screen.getByText("Beto Miembro: 3")).toBeInTheDocument();
    expect(screen.getByTestId("novedades")).toHaveTextContent("Ana Admin entro por primera vez con la IP 200.5.5.5");
  });

  it("si el resumen falla, la lista igual se muestra", async () => {
    A.resumenBitacora.mockRejectedValue(new Error("x"));
    abrir();
    expect(await screen.findAllByTestId("entrada-bitacora")).toHaveLength(2);
    expect(screen.queryByTestId("resumen-bitacora")).not.toBeInTheDocument();
  });
});

describe("Bitacora: lista", () => {
  it("mezcla accesos y datos con icono, etiqueta y texto; IP y dispositivo en una linea secundaria", async () => {
    abrir();
    const filas = await screen.findAllByTestId("entrada-bitacora");
    expect(filas.map((f) => f.getAttribute("data-origen"))).toEqual(["acceso", "datos"]);
    expect(filas[0]).toHaveTextContent("Acceso · Entrada");
    expect(filas[0]).toHaveTextContent("Ana Admin inicio sesion");
    expect(within(filas[0]).getByTestId("origen-acceso")).toHaveTextContent("IP 190.1.2.3 · Chrome en Windows");
    expect(filas[1]).toHaveTextContent("Datos · Editado");
    expect(filas[1]).toHaveTextContent("Edito gasto Comida Bs 60.00");
    expect(filas[1]).toHaveTextContent("Monto: Bs 45.00 -> Bs 60.00");
    expect(within(filas[1]).queryByTestId("origen-acceso")).not.toBeInTheDocument(); // los datos no tienen IP
  });

  it("un fallo se distingue por texto y color (no solo color)", () => {
    const fallo = entrada(3, { evento: "login_fallido", etiqueta: "Entrada fallida", resultado: "fallo", titulo: "Intento fallido de entrada con x@y.com" });
    render(<ul><EntradaBitacoraVista e={fallo} /></ul>);
    expect(screen.getByTestId("entrada-bitacora")).toHaveTextContent("Acceso · Fallo · Entrada fallida");
    expect(estiloEntrada(fallo).fondo).toBe("bg-red-50");
    expect(estiloEntrada(entrada(1)).fondo).toBe("bg-arca-claro");
    expect(estiloEntrada(datos(2)).fondo).toBe("bg-stone-100");
    expect(new Set([estiloEntrada(fallo).icono, estiloEntrada(entrada(1)).icono, estiloEntrada(datos(2)).icono]).size).toBe(3);
  });

  it("'Anulado' muestra el motivo y la accion hecha sin conexion muestra su fecha real y la de sincronizacion", () => {
    const sync = new Date(2026, 10, 5, 9, 30).toISOString();
    render(
      <ul>
        <EntradaBitacoraVista
          e={datos(4, { evento: "anular", etiqueta: "Anulado", titulo: "Anulo gasto Transporte Bs 50.00", motivo: "Se pago dos veces", detalle: [], fecha: sync, fecha_real: fecha, fecha_sincronizacion: sync })}
        />
      </ul>,
    );
    const fila = screen.getByTestId("entrada-bitacora");
    expect(fila).toHaveTextContent("Datos · Anulado");
    expect(fila).toHaveTextContent("Motivo: Se pago dos veces");
    expect(fila).toHaveTextContent("3 nov 14:05"); // la fecha real
    expect(screen.getByTestId("sincronizado-en")).toHaveTextContent("Hecho sin conexión · sincronizado 5 nov 09:30");
  });

  it("estado vacio amable sin filtros, y con filtros ofrece 'Quitar filtros'", async () => {
    A.listarBitacora.mockResolvedValue(pagina([]));
    abrir();
    expect(await screen.findByTestId("estado-vacio")).toHaveTextContent("Todavía no hay nada en la bitácora");
    expect(screen.queryByRole("button", { name: "Quitar filtros" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Accesos" }));
    expect(await screen.findByText("No hay nada en la bitácora con estos filtros.")).toBeInTheDocument();
    A.listarBitacora.mockResolvedValue(pagina([entrada(1)]));
    await userEvent.click(screen.getByRole("button", { name: "Quitar filtros" }));
    await screen.findAllByTestId("entrada-bitacora");
    expect(ultimaLlamada()[0]).toEqual(FILTROS_VACIOS);
  });

  it("muestra esqueletos mientras carga", async () => {
    let resolver!: (p: api.PaginaBitacora) => void;
    A.listarBitacora.mockReturnValue(new Promise((r) => (resolver = r)));
    abrir();
    expect(screen.getByText("Cargando la bitácora...")).toBeInTheDocument();
    expect(document.querySelectorAll(".esqueleto").length).toBeGreaterThan(0);
    resolver(pagina([entrada(1)]));
    await screen.findAllByTestId("entrada-bitacora");
    expect(screen.queryByText("Cargando la bitácora...")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".esqueleto")).toHaveLength(0);
  });

  it("un error del servidor se muestra y no deja la lista a medias", async () => {
    A.listarBitacora.mockRejectedValue(new Error("Sin conexión con el servidor"));
    abrir();
    expect(await screen.findByRole("alert")).toHaveTextContent("Sin conexión con el servidor");
    expect(screen.queryAllByTestId("entrada-bitacora")).toHaveLength(0);
  });

  it("'Cargar mas' pide la pagina siguiente con el cursor y agrega sin repetir", async () => {
    A.listarBitacora
      .mockResolvedValueOnce(pagina([entrada(1), entrada(2)], true, "CURSOR1"))
      .mockResolvedValueOnce(pagina([entrada(3)], false, null));
    abrir();
    await screen.findAllByTestId("entrada-bitacora");
    await userEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    await waitFor(() => expect(screen.getAllByTestId("entrada-bitacora")).toHaveLength(3));
    expect(A.listarBitacora).toHaveBeenLastCalledWith(FILTROS_VACIOS, "CURSOR1", 20);
    expect(screen.queryByRole("button", { name: "Cargar más" })).not.toBeInTheDocument(); // ya no hay mas
  });

  it("sin mas paginas no ofrece 'Cargar mas'", async () => {
    abrir();
    await screen.findAllByTestId("entrada-bitacora");
    expect(screen.queryByRole("button", { name: "Cargar más" })).not.toBeInTheDocument();
  });
});

describe("Bitacora: filtros", () => {
  it("los chips Todo | Accesos | Datos filtran por origen", async () => {
    abrir();
    await screen.findAllByTestId("entrada-bitacora");
    const grupo = screen.getByRole("group", { name: "Origen" });
    expect(within(grupo).getByRole("button", { name: "Todo" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(within(grupo).getByRole("button", { name: "Accesos" }));
    await waitFor(() => expect(ultimaLlamada()[0]).toMatchObject({ origen: "acceso" }));
    expect(within(grupo).getByRole("button", { name: "Accesos" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(within(grupo).getByRole("button", { name: "Datos" }));
    await waitFor(() => expect(ultimaLlamada()[0]).toMatchObject({ origen: "datos" }));
    // cada chip mide 44px o mas
    for (const b of within(grupo).getAllByRole("button")) expect(b.className).toContain("min-h-[44px]");
  });

  it("filtra por evento, resultado y persona desde las hojas de opciones", async () => {
    abrir();
    await screen.findAllByTestId("entrada-bitacora");
    await userEvent.click(screen.getByRole("button", { name: /^Evento:/ }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "Evento" })).getByRole("radio", { name: "Acceso · Entrada fallida" }));
    await waitFor(() => expect(ultimaLlamada()[0]).toMatchObject({ evento: "login_fallido" }));
    expect(screen.getByRole("button", { name: /^Evento: Acceso · Entrada fallida/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^Resultado:/ }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "Resultado" })).getByRole("radio", { name: "Con fallo" }));
    await waitFor(() => expect(ultimaLlamada()[0]).toMatchObject({ evento: "login_fallido", resultado: "fallo" }));

    await userEvent.click(screen.getByRole("button", { name: /^Persona:/ }));
    await userEvent.click(await within(screen.getByRole("dialog", { name: "Persona" })).findByRole("radio", { name: "Beto Miembro" }));
    await waitFor(() => expect(ultimaLlamada()[0]).toMatchObject({ evento: "login_fallido", resultado: "fallo", persona: "2" }));
  });

  it("al cambiar de origen se limpia un evento que ya no corresponde", async () => {
    abrir();
    await screen.findAllByTestId("entrada-bitacora");
    await userEvent.click(screen.getByRole("button", { name: "Datos" }));
    await userEvent.click(screen.getByRole("button", { name: /^Evento:/ }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "Evento" })).getByRole("radio", { name: "Anulado" }));
    await waitFor(() => expect(ultimaLlamada()[0]).toMatchObject({ origen: "datos", evento: "anular" }));
    await userEvent.click(screen.getByRole("button", { name: "Accesos" })); // "anular" no es un evento de acceso
    await waitFor(() => expect(ultimaLlamada()[0]).toMatchObject({ origen: "acceso", evento: "" }));
  });

  it("Fechas: presets y rango propio (con validacion)", async () => {
    abrir();
    await screen.findAllByTestId("entrada-bitacora");
    await userEvent.click(screen.getByRole("button", { name: /^Fechas:/ }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "Fechas" })).getByRole("radio", { name: "Hoy" }));
    await waitFor(() => expect(ultimaLlamada()[0].desde).not.toBe(""));
    const f = ultimaLlamada()[0];
    expect(new Date(f.hasta).getTime() - new Date(f.desde).getTime()).toBeGreaterThan(23 * 3600_000);

    await userEvent.click(screen.getByRole("button", { name: /^Fechas:/ }));
    const hoja = screen.getByRole("dialog", { name: "Fechas" });
    await userEvent.type(within(hoja).getByLabelText("Desde"), "2026-11-10");
    await userEvent.type(within(hoja).getByLabelText("Hasta"), "2026-11-02");
    expect(within(hoja).getByRole("alert")).toHaveTextContent('"Desde" no puede ser posterior');
    expect(within(hoja).getByRole("button", { name: "Aplicar rango" })).toBeDisabled();
    await userEvent.clear(within(hoja).getByLabelText("Hasta"));
    await userEvent.type(within(hoja).getByLabelText("Hasta"), "2026-11-12");
    await userEvent.click(within(hoja).getByRole("button", { name: "Aplicar rango" }));
    await waitFor(() => expect(new Date(ultimaLlamada()[0].desde).getDate()).toBe(10));
    expect(new Date(ultimaLlamada()[0].hasta).getDate()).toBe(12);
    expect(screen.getByRole("button", { name: /^Fechas: 2026-11-10 a 2026-11-12/ })).toBeInTheDocument();
  });

  it("una respuesta vieja no pisa a la del filtro mas nuevo", async () => {
    let lenta!: (p: api.PaginaBitacora) => void;
    A.listarBitacora.mockReturnValueOnce(new Promise((r) => (lenta = r))); // carga inicial, tarda
    abrir();
    A.listarBitacora.mockResolvedValue(pagina([datos(9)]));
    await userEvent.click(screen.getByRole("button", { name: "Datos" }));
    await screen.findAllByTestId("entrada-bitacora");
    lenta(pagina([entrada(1), entrada(2), entrada(3)]));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getAllByTestId("entrada-bitacora")).toHaveLength(1);
  });
});

describe("Bitacora: exportar CSV", () => {
  it("exporta con los filtros elegidos", async () => {
    abrir();
    await screen.findAllByTestId("entrada-bitacora");
    await userEvent.click(screen.getByRole("button", { name: "Accesos" }));
    await waitFor(() => expect(ultimaLlamada()[0].origen).toBe("acceso"));
    await userEvent.click(screen.getByRole("button", { name: "Exportar CSV" }));
    await waitFor(() => expect(A.exportarCsv).toHaveBeenCalledWith(expect.objectContaining({ origen: "acceso" })));
  });

  it("si falla, lo dice", async () => {
    A.exportarCsv.mockRejectedValue(new Error("No se pudo exportar"));
    abrir();
    await screen.findAllByTestId("entrada-bitacora");
    await userEvent.click(screen.getByRole("button", { name: "Exportar CSV" }));
    expect(await screen.findByText("No se pudo exportar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exportar CSV" })).toBeEnabled();
  });
});

describe("Bitacora: ayudas", () => {
  it("resumenDispositivo reconoce navegador y sistema, y recorta lo desconocido", () => {
    expect(resumenDispositivo("Mozilla/5.0 (Windows NT 10.0) Edg/120.0 Chrome/120 Safari/537")).toBe("Edge en Windows");
    expect(resumenDispositivo("Mozilla/5.0 (iPhone; CPU iPhone OS 17) AppleWebKit Version/17 Safari/604")).toBe("Safari en iPhone/iPad");
    expect(resumenDispositivo("Mozilla/5.0 (X11; Linux) Gecko Firefox/121.0")).toBe("Firefox en Linux");
    expect(resumenDispositivo("curl/8.0")).toBe("curl/8.0");
    expect(resumenDispositivo("Playwright/1.49.1 (x64; windows 10.0) node/22.14")).toBe("Windows"); // sin navegador conocido
    expect(resumenDispositivo("RobotRaro/2.0 (cosas)")).toBe("RobotRaro/2.0");
    expect(resumenDispositivo("x".repeat(100))).toHaveLength(43);
    expect(resumenDispositivo(null)).toBe("");
  });

  it("opcionesDeEvento: por origen, sin repetir 'Clave restablecida'", () => {
    expect(opcionesDeEvento("acceso").map((o) => o.valor)).toContain("login_fallido");
    expect(opcionesDeEvento("acceso").map((o) => o.valor)).not.toContain("anular");
    expect(opcionesDeEvento("datos").map((o) => o.valor)).toContain("anular");
    const todos = opcionesDeEvento("").map((o) => o.valor);
    expect(todos.filter((v) => v === "restablecer_clave")).toHaveLength(1);
    expect(new Set(todos).size).toBe(todos.length);
  });

  it("rangoAFiltro: hoy, ultimos 7 y 30 dias, y rango propio, en la hora del aparato", () => {
    const hoy = new Date(2026, 10, 8, 15, 0);
    const { desde, hasta } = rangoAFiltro({ clave: "7", desde: "", hasta: "" }, hoy);
    expect(new Date(desde)).toEqual(new Date(2026, 10, 2, 0, 0, 0, 0));
    expect(new Date(hasta)).toEqual(new Date(2026, 10, 8, 23, 59, 59, 999));
    expect(new Date(rangoAFiltro({ clave: "30", desde: "", hasta: "" }, hoy).desde)).toEqual(new Date(2026, 9, 10, 0, 0, 0, 0));
    expect(rangoAFiltro({ clave: "", desde: "", hasta: "" }, hoy)).toEqual({ desde: "", hasta: "" });
    expect(rangoAFiltro({ clave: "otro", desde: "2026-11-01", hasta: "" }, hoy).hasta).toBe("");
  });
});
