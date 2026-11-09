import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorRed } from "../../core/api";
import { admin, renderPantalla, sinAuditoria } from "../../test/ayudas";
import type { Yo } from "../auth/api";
import { nuevoUuid } from "../../core/uuid";
import { encolar } from "../sync/cola";
import * as mov from "../movimientos/api";
import * as rep from "../reportes/api";
import PaginaInicio from "./PaginaInicio";

const sesion = vi.hoisted(() => ({ usuario: null as Yo | null, salir: vi.fn() }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => sesion }));
vi.mock("../reportes/api", () => ({ resumenPeriodo: vi.fn() }));
vi.mock("../movimientos/api", () => ({ listarMovimientos: vi.fn(), anularMovimiento: vi.fn(), reactivarMovimiento: vi.fn() }));
vi.mock("../apoyos/api", () => ({ anularApoyo: vi.fn(), reactivarApoyo: vi.fn() }));

const cmp = { anterior: 0, diferencia: 0, porcentaje: null };
const resumen = (c: Partial<rep.Resumen> = {}): rep.Resumen => ({
  mes: "2026-11", desde: "2026-11-01", hasta: "2026-11-30",
  comparacion: { desde: "2026-10-01", hasta: "2026-10-31", etiqueta: "vs octubre 2026", ingresos: cmp, gastos: cmp, saldo: cmp },
  ingresos: 6500, gastos: 990.5, apoyos_entregados: 1200, devoluciones: 600, saldo: 4909.5, consumido: 0,
  gasto_familiar_total: 990.5, apoyos_pendientes_total: 0, apoyos_pendientes_cantidad: 0, ...c,
});
const gasto = (id: number, c: Partial<mov.Movimiento> = {}): mov.Movimiento => ({
  id, tipo: "gasto", monto: 10, fecha: "2026-11-03", categoria_id: 2, categoria_nombre: "Comida", categoria_icono: "utensils",
  nota: `Gasto ${id}`, usuario_id: 1, usuario_nombre: "Ana Admin", ...sinAuditoria, ...c,
});
const miembroSesion: Yo = { ...admin, id: 2, nombre: "Beto Miembro", rol: "miembro" };
const abrir = () => {
  sesion.usuario = admin;
  return renderPantalla(<PaginaInicio />, { ruta: "/", hoy: "2026-11-08" });
};
const seccionSaldo = () => within(screen.getByLabelText("Saldo del periodo"));

beforeEach(() => {
  sesion.salir.mockReset();
  vi.mocked(rep.resumenPeriodo).mockResolvedValue(resumen());
  vi.mocked(mov.listarMovimientos).mockResolvedValue([]);
});

describe("Inicio: saldo y desglose", () => {
  it("muestra el saldo de efectivo del mes y el desglose completo", async () => {
    abrir();
    expect(await screen.findByTestId("saldo")).toHaveTextContent("Bs 4,909.50");
    const s = seccionSaldo();
    expect(s.getByText(/Ingresos/).parentElement).toHaveTextContent("Bs 6,500.00");
    expect(s.getByText(/Gastos/).parentElement).toHaveTextContent("Bs 990.50");
    expect(s.getByText(/Apoyos entregados/).parentElement).toHaveTextContent("Bs 1,200.00");
    expect(s.getByText(/Devoluciones/).parentElement).toHaveTextContent("Bs 600.00");
    expect(s.getByText(/Saldo de efectivo/)).toHaveTextContent("Saldo de efectivo · Noviembre 2026");
  });

  it("pide el resumen y los movimientos del mes actual (desde y hasta del periodo)", async () => {
    abrir();
    await screen.findByTestId("saldo");
    const noviembre = { desde: "2026-11-01", hasta: "2026-11-30" };
    expect(rep.resumenPeriodo).toHaveBeenCalledWith(noviembre);
    expect(mov.listarMovimientos).toHaveBeenCalledWith(noviembre);
  });

  it("un saldo negativo se muestra con el signo antes de Bs", async () => {
    vi.mocked(rep.resumenPeriodo).mockResolvedValue(resumen({ saldo: -45.5 }));
    abrir();
    expect(await screen.findByTestId("saldo")).toHaveTextContent("-Bs 45.50");
  });

  it("los apoyos consumidos van aparte y solo si hay", async () => {
    abrir();
    await screen.findByTestId("saldo");
    expect(screen.queryByText(/Apoyos consumidos/)).not.toBeInTheDocument();
  });

  it("con consumido > 0 aparece su linea aparte (no cambia el saldo mostrado)", async () => {
    vi.mocked(rep.resumenPeriodo).mockResolvedValue(resumen({ consumido: 300 }));
    abrir();
    expect(await screen.findByText("Apoyos consumidos (gasto familiar, aparte): Bs 300.00")).toBeInTheDocument();
    expect(screen.getByTestId("saldo")).toHaveTextContent("Bs 4,909.50");
  });
});

describe("Inicio: aviso de apoyos pendientes", () => {
  it("no aparece si no hay pendientes", async () => {
    abrir();
    await screen.findByTestId("saldo");
    expect(screen.queryByText(/Apoyos pendientes/)).not.toBeInTheDocument();
  });

  it("una persona: singular y enlace a Apoyos", async () => {
    vi.mocked(rep.resumenPeriodo).mockResolvedValue(resumen({ apoyos_pendientes_total: 300, apoyos_pendientes_cantidad: 1 }));
    abrir();
    const aviso = (await screen.findByText(/Apoyos pendientes: Bs 300.00/)).closest("a")!;
    expect(aviso).toHaveAttribute("href", "/apoyos");
    expect(aviso).toHaveTextContent("1 persona por devolver");
  });

  it("varias personas: plural", async () => {
    vi.mocked(rep.resumenPeriodo).mockResolvedValue(resumen({ apoyos_pendientes_total: 1234.5, apoyos_pendientes_cantidad: 3 }));
    abrir();
    const aviso = (await screen.findByText(/Apoyos pendientes: Bs 1,234.50/)).closest("a")!;
    expect(aviso).toHaveTextContent("3 personas por devolver");
  });
});

describe("Inicio: ultimos movimientos", () => {
  it("sin movimientos invita a registrar el primero", async () => {
    abrir();
    expect(await screen.findByText("Sin movimientos en este periodo. Toca + para registrar uno.")).toBeInTheDocument();
  });

  it("muestra solo los 8 ultimos, con signo y color segun el tipo", async () => {
    const lista = [
      gasto(1, { nota: "Almuerzo", monto: 45 }),
      gasto(2, { tipo: "ingreso", nota: "Sueldo", monto: 1000, categoria_id: null, categoria_nombre: null, categoria_icono: null }),
      ...Array.from({ length: 8 }, (_, i) => gasto(10 + i, { nota: `Extra ${i}` })),
    ];
    vi.mocked(mov.listarMovimientos).mockResolvedValue(lista);
    abrir();
    await screen.findByText("Almuerzo");
    expect(screen.getByText("Almuerzo").closest("[data-testid=fila-inicio]")).toHaveTextContent("-Bs 45.00");
    const sueldo = screen.getByText("Sueldo").closest("[data-testid=fila-inicio]") as HTMLElement;
    expect(sueldo).toHaveTextContent("+Bs 1,000.00");
    expect(sueldo).toHaveTextContent("Ingreso · Ana Admin");
    expect(screen.getByText("Extra 5")).toBeInTheDocument();
    expect(screen.queryByText("Extra 6")).not.toBeInTheDocument(); // el noveno ya no entra
    expect(screen.getByText("Extra 5").closest(".divide-y")!.children).toHaveLength(8);
  });

  it("'Ver todos' lleva a la lista completa; el + de Nuevo movimiento ya no es de esta pantalla (vive en la barra: Layout)", async () => {
    abrir();
    expect(await screen.findByRole("link", { name: /Ver todos/ })).toHaveAttribute("href", "/todos");
    expect(screen.queryByRole("link", { name: "Nuevo movimiento" })).not.toBeInTheDocument();
  });
});

const pendiente = () =>
  encolar({ entidad: "movimiento", accion: "crear", uuid: nuevoUuid(), datos: { tipo: "gasto", monto: 5, fecha: "2026-11-07", categoria_id: 2, nota: null } });

describe("Inicio: sin internet", () => {
  it("si no puede cargar (sin conexion ni datos guardados de ese periodo) lo dice y deja el selector de periodo", async () => {
    vi.mocked(rep.resumenPeriodo).mockRejectedValue(new ErrorRed());
    await pendiente();
    abrir();
    expect(await screen.findByTestId("sin-datos-periodo")).toHaveTextContent("Sin datos guardados para este periodo");
    expect(screen.getByTestId("selector-periodo")).toBeInTheDocument(); // se puede volver a otro periodo
  });

  it("marca los movimientos que aun no se enviaron", async () => {
    vi.mocked(mov.listarMovimientos).mockResolvedValue([gasto(-1, { sinSincronizar: true, nota: "Gasto recien hecho" }), gasto(2)]);
    abrir();
    const fila = (await screen.findByText("Gasto recien hecho")).closest("[data-testid=fila-inicio]") as HTMLElement;
    expect(within(fila).getByText(/⏳ sin enviar/)).toBeInTheDocument();
    expect(within(screen.getAllByTestId("fila-inicio")[1]).queryByText(/sin enviar/)).not.toBeInTheDocument();
  });
});

describe("Inicio: perfil y diseno", () => {
  it("el avatar de arriba a la derecha abre directamente 'Mi perfil' y ya no hay boton Salir aqui", async () => {
    abrir();
    const avatar = await screen.findByRole("link", { name: "Mi perfil" });
    expect(avatar).toHaveAttribute("href", "/familia/perfil");
    expect(avatar).toHaveTextContent("AA"); // iniciales de Ana Admin
    expect(avatar.className).toContain("w-11");
    expect(screen.queryByRole("button", { name: "Salir" })).not.toBeInTheDocument();
  });

  it("el saldo va en la tarjeta verde grande con ingresos y gastos debajo en cifras destacadas", async () => {
    abrir();
    expect((await screen.findByLabelText("Saldo del periodo")).className).toContain("bg-arca");
    const s = seccionSaldo();
    expect(s.getByText("Ingresos").parentElement).toHaveTextContent("Bs 6,500.00");
    expect(s.getByText("Gastos").parentElement).toHaveTextContent("Bs 990.50");
  });

  it("la tarjeta de apoyos pendientes es naranja y se puede tocar entera", async () => {
    vi.mocked(rep.resumenPeriodo).mockResolvedValue(resumen({ apoyos_pendientes_total: 300, apoyos_pendientes_cantidad: 1 }));
    abrir();
    const aviso = (await screen.findByText(/Apoyos pendientes: Bs 300.00/)).closest("a")!;
    expect(aviso.className).toContain("bg-apoyo-claro");
    expect(aviso.className).toContain("min-h-[56px]");
  });

  it("mientras carga muestra esqueletos (no una pantalla en blanco)", () => {
    vi.mocked(rep.resumenPeriodo).mockReturnValue(new Promise(() => {}));
    abrir();
    expect(screen.getByText("Cargando...")).toBeInTheDocument();
    expect(document.querySelectorAll(".esqueleto").length).toBeGreaterThan(0);
  });

  it("sin movimientos: estado vacio amable con una accion para registrar", async () => {
    abrir();
    const vacio = await screen.findByTestId("estado-vacio");
    expect(within(vacio).getByRole("link", { name: "Registrar un movimiento" })).toHaveAttribute("href", "/nuevo");
  });
});

describe("Inicio: menu '...' de los ultimos movimientos (mismos permisos que la lista completa)", () => {
  const abrirComo = (u: Yo) => {
    sesion.usuario = u;
    return renderPantalla(<PaginaInicio />, { ruta: "/" });
  };
  const opciones = async (etiqueta: string) => {
    await userEvent.setup().click(await screen.findByRole("button", { name: etiqueta }));
    return screen.getAllByRole("menuitem").map((i) => i.textContent);
  };

  it("el admin puede Editar, Ver historial y Anular lo de cualquiera", async () => {
    vi.mocked(mov.listarMovimientos).mockResolvedValue([gasto(1, { nota: "Del miembro", usuario_id: 2, usuario_nombre: "Beto Miembro" })]);
    abrirComo(admin);
    expect(await opciones("Acciones de Del miembro")).toEqual(["Editar", "Ver historial", "Anular"]);
  });

  it("el miembro: lo suyo si; lo del admin solo 'Ver historial'", async () => {
    vi.mocked(mov.listarMovimientos).mockResolvedValue([
      gasto(1, { nota: "Mio", usuario_id: 2, usuario_nombre: "Beto Miembro" }),
      gasto(2, { nota: "Del admin", usuario_id: 1 }),
    ]);
    abrirComo(miembroSesion);
    await screen.findByText("Mio");
    expect(await opciones("Acciones de Mio")).toEqual(["Editar", "Compartir...", "Ver historial", "Anular"]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Cerrar menu" }));
    expect(await opciones("Acciones de Del admin")).toEqual(["Ver historial"]);
  });

  it("Editar lleva a la pantalla de edicion del movimiento", async () => {
    vi.mocked(mov.listarMovimientos).mockResolvedValue([gasto(7, { nota: "Cena" })]);
    abrirComo(admin);
    await opciones("Acciones de Cena");
    await userEvent.setup().click(screen.getByRole("menuitem", { name: "Editar" }));
    expect(screen.getByTestId("ruta-actual")).toHaveTextContent("/editar/movimiento/7");
  });

  it("Anular pide confirmacion con nombre y monto; luego recarga y ofrece Reactivar", async () => {
    const u = userEvent.setup();
    vi.mocked(mov.listarMovimientos).mockResolvedValue([gasto(7, { nota: "Cena", monto: 30 })]);
    vi.mocked(mov.anularMovimiento).mockResolvedValue(gasto(7, { anulado: true }));
    abrirComo(admin);
    await opciones("Acciones de Cena");
    await u.click(screen.getByRole("menuitem", { name: "Anular" }));
    const d = await screen.findByRole("dialog", { name: "Anular gasto" });
    expect(within(d).getByTestId("detalle-anular")).toHaveTextContent("Cena · Bs 30.00");
    await u.type(within(d).getByLabelText("Motivo (opcional)"), "Duplicado");
    await u.click(within(d).getByRole("button", { name: "Anular" }));
    await vi.waitFor(() => expect(mov.anularMovimiento).toHaveBeenCalledWith(7, "Duplicado"));
    expect(await screen.findByRole("button", { name: "Reactivar" })).toBeInTheDocument();
    expect(vi.mocked(mov.listarMovimientos).mock.calls.length).toBeGreaterThan(1); // volvio a leer
  });

  it("un movimiento anulado muestra Reactivar (no Editar ni Anular)", async () => {
    vi.mocked(mov.listarMovimientos).mockResolvedValue([gasto(7, { nota: "Cena", anulado: true })]);
    abrirComo(admin);
    expect(await opciones("Acciones de Cena")).toEqual(["Reactivar", "Ver historial"]);
  });
});
