import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorRed } from "../../core/api";
import { admin, apoyoDe, devolucionDe, miembro, renderPantalla } from "../../test/ayudas";
import type { Yo } from "../auth/api";
import * as hist from "../historial/api";
import * as api from "./api";
import PaginaApoyos from "./PaginaApoyos";

const sesion = vi.hoisted(() => ({ usuario: null as Yo | null }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => sesion }));
vi.mock("../historial/api", () => ({ cadenaHistorial: vi.fn() }));
vi.mock("./api", () => ({
  resumenApoyos: vi.fn(), listarApoyos: vi.fn(), devolverApoyo: vi.fn(), consumirApoyo: vi.fn(), reabrirApoyo: vi.fn(),
  anularApoyo: vi.fn(), reactivarApoyo: vi.fn(), editarDevolucion: vi.fn(), anularDevolucion: vi.fn(), reactivarDevolucion: vi.fn(),
}));

const A = vi.mocked(api);
const benef = (b: string, entregado: number, devuelto: number, consumido: number, estado: api.EstadoApoyo, n = 1) => ({
  beneficiario: b, entregado, devuelto, consumido, pendiente: entregado - devuelto - consumido, estado, cantidad_apoyos: n,
  entregado_periodo: entregado, devuelto_periodo: devuelto,
});
const resumen = (beneficiarios: ReturnType<typeof benef>[]) => ({
  total_entregado: beneficiarios.reduce((s, b) => s + b.entregado, 0),
  total_devuelto: beneficiarios.reduce((s, b) => s + b.devuelto, 0),
  total_consumido: beneficiarios.reduce((s, b) => s + b.consumido, 0),
  total_pendiente: beneficiarios.reduce((s, b) => s + b.pendiente, 0),
  total_entregado_periodo: beneficiarios.reduce((s, b) => s + b.entregado_periodo, 0),
  total_devuelto_periodo: beneficiarios.reduce((s, b) => s + b.devuelto_periodo, 0),
  beneficiarios,
});
const tarjeta = (nombre: string) => within(screen.getByRole("heading", { name: nombre }).closest(".rounded-tarjeta") as HTMLElement);

function datos(apoyos: api.Apoyo[], r = resumen([benef("Tia Rosa", 300, 0, 0, "Pendiente")])) {
  A.resumenApoyos.mockResolvedValue(r);
  A.listarApoyos.mockResolvedValue(apoyos);
}
const abrir = (usuario: Yo = admin) => {
  sesion.usuario = usuario;
  return renderPantalla(<PaginaApoyos />, { ruta: "/apoyos", hoy: "2026-11-08" });
};
const menuItems = async (u: ReturnType<typeof userEvent.setup>, etiqueta: string) => {
  await u.click(await screen.findByRole("button", { name: etiqueta }));
  return screen.getAllByRole("menuitem").map((i) => i.textContent);
};

beforeEach(() => {
  vi.mocked(hist.cadenaHistorial).mockResolvedValue({ items: [], total: 0, hay_mas: false });
});

describe("Apoyos: estados y totales", () => {
  const apoyos = [
    apoyoDe({ id: 1, beneficiario: "Tia Rosa", monto: 500, devuelto: 190, pendiente: 310, estado: "Pendiente" }),
    apoyoDe({ id: 2, beneficiario: "Hermano Luis", monto: 301, devuelto: 301, pendiente: 0, estado: "Saldado" }),
    apoyoDe({ id: 3, beneficiario: "Primo Pedro", monto: 402, devuelto: 102, consumido: 300, pendiente: 0, estado: "Cerrado" }),
  ];
  const r = resumen([benef("Tia Rosa", 500, 190, 0, "Pendiente"), benef("Hermano Luis", 301, 301, 0, "Saldado"), benef("Primo Pedro", 402, 102, 300, "Cerrado")]);

  it("muestra los totales del resumen con formato Bs", async () => {
    datos(apoyos, r);
    abrir();
    await screen.findByRole("heading", { name: "Tia Rosa" });
    const cuadros = screen.getByText("Pendiente total", { selector: "p" }).closest(".grid") as HTMLElement;
    const valorDe = (titulo: string) => (within(cuadros).getByText(titulo, { selector: "p" }).nextElementSibling as HTMLElement).textContent;
    expect(valorDe("Pendiente total")).toBe("Bs 310.00"); // solo Tia Rosa: 500 - 190
    expect(valorDe("Entregado en el periodo")).toBe("Bs 1,203.00"); // 500 + 301 + 402
    expect(valorDe("Devuelto en el periodo")).toBe("Bs 593.00"); // 190 + 301 + 102
    expect(valorDe("Consumido (acumulado)")).toBe("Bs 300.00"); // solo Primo Pedro
  });

  it("cada tarjeta lleva su estado: Pendiente, Saldado o Cerrado", async () => {
    datos(apoyos, r);
    abrir();
    await screen.findByRole("heading", { name: "Tia Rosa" });
    expect(tarjeta("Tia Rosa").getByText("Pendiente", { selector: "span.rounded-full" })).toBeInTheDocument(); // la insignia de estado (la etiqueta "Pendiente" de la barra inferior tambien es un span)
    expect(tarjeta("Hermano Luis").getByText("Saldado")).toBeInTheDocument();
    expect(tarjeta("Primo Pedro").getByText("Cerrado")).toBeInTheDocument();
  });

  it("solo lo Pendiente ofrece devolver y consumir", async () => {
    datos(apoyos, r);
    abrir();
    await screen.findByRole("heading", { name: "Tia Rosa" });
    expect(tarjeta("Tia Rosa").getByRole("button", { name: "Registrar devolución" })).toBeInTheDocument();
    expect(tarjeta("Tia Rosa").getByRole("button", { name: "Marcar consumido" })).toBeInTheDocument();
    for (const n of ["Hermano Luis", "Primo Pedro"]) {
      expect(tarjeta(n).queryByRole("button", { name: "Registrar devolución" })).not.toBeInTheDocument();
      expect(tarjeta(n).queryByRole("button", { name: "Marcar consumido" })).not.toBeInTheDocument();
    }
  });

  it("la barra de progreso suma devuelto + consumido sobre lo entregado", async () => {
    datos(apoyos, r);
    abrir();
    await screen.findByRole("heading", { name: "Tia Rosa" });
    expect(tarjeta("Tia Rosa").getByRole("progressbar")).toHaveAttribute("aria-valuenow", "38"); // 190/500
    expect(tarjeta("Hermano Luis").getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    expect(tarjeta("Primo Pedro").getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100"); // (102+300)/402
  });

  it("los apoyos anulados no son tarjetas; salen en su seccion solo con 'Ver anulados' (estado Anulado)", async () => {
    const anulado = apoyoDe({
      id: 9, beneficiario: "Don Pepe", monto: 77, estado: "Anulado", anulado: true, anulado_por_nombre: "Ana Admin",
      anulado_en: new Date(2026, 10, 3, 14, 5).toISOString(), motivo_anulacion: "Error",
    });
    datos([apoyos[0]], resumen([benef("Tia Rosa", 500, 190, 0, "Pendiente")]));
    const u = userEvent.setup();
    abrir();
    await screen.findByRole("heading", { name: "Tia Rosa" });
    expect(A.listarApoyos).toHaveBeenLastCalledWith(false);
    expect(screen.queryByText("Apoyos anulados")).not.toBeInTheDocument();

    A.listarApoyos.mockResolvedValue([apoyos[0], anulado]);
    await u.click(screen.getByLabelText("Ver anulados"));
    expect(await screen.findByText("Apoyos anulados")).toBeInTheDocument();
    expect(A.listarApoyos).toHaveBeenLastCalledWith(true);
    const fila = screen.getByText(/Don Pepe/, { selector: "p" }).parentElement as HTMLElement;
    expect(within(fila).getByText(/Anulado por Ana Admin · 3 nov 14:05 · Error/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Don Pepe" })).not.toBeInTheDocument();
    expect(screen.getAllByTestId("fila-apoyo").find((f) => f.getAttribute("data-anulado") === "true")).toBeTruthy();
  });

  it("sin apoyos muestra el mensaje vacio", async () => {
    datos([], resumen([]));
    abrir();
    expect(await screen.findByText(/No hay apoyos pendientes ni apoyos de este periodo/)).toBeInTheDocument();
  });
});

describe("Apoyos: registrar devolucion (reparto entre apoyos del mismo beneficiario)", () => {
  // dos apoyos de Tia Rosa: el mas viejo (id 2) debe cubrirse primero aunque venga despues en la lista
  const dosApoyos = [
    apoyoDe({ id: 1, beneficiario: "Tia Rosa", monto: 150, fecha: "2026-10-15", pendiente: 150 }),
    apoyoDe({ id: 2, beneficiario: "Tia Rosa", monto: 100, fecha: "2026-10-01", pendiente: 100 }),
  ];
  const r = resumen([benef("Tia Rosa", 250, 0, 0, "Pendiente", 2)]);

  async function abrirForm(u: ReturnType<typeof userEvent.setup>) {
    datos(dosApoyos, r);
    abrir();
    await u.click(await screen.findByRole("button", { name: "Registrar devolución" }));
    return screen.getByLabelText("Monto devuelto (Bs)");
  }

  it("el formulario sugiere devolver todo lo pendiente", async () => {
    const campo = await abrirForm(userEvent.setup());
    expect(campo).toHaveValue("250");
  });

  it("180 se reparte: primero el apoyo mas antiguo (100) y el resto (80) al siguiente", async () => {
    const u = userEvent.setup();
    A.devolverApoyo.mockResolvedValue(apoyoDe());
    const campo = await abrirForm(u);
    await u.clear(campo);
    await u.type(campo, "180");
    await u.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(A.devolverApoyo).toHaveBeenCalledTimes(2));
    expect(A.devolverApoyo.mock.calls).toEqual([[2, 100], [1, 80]]);
    expect(await screen.findByText("Devolución registrada")).toBeInTheDocument();
    await waitFor(() => expect(A.listarApoyos.mock.calls.length).toBeGreaterThan(1)); // recarga los datos
  });

  it("devolver exactamente todo cubre ambos apoyos; un monto chico solo toca el mas viejo", async () => {
    const u = userEvent.setup();
    A.devolverApoyo.mockResolvedValue(apoyoDe());
    let campo = await abrirForm(u);
    await u.click(screen.getByRole("button", { name: "Guardar" })); // 250 completo
    await waitFor(() => expect(A.devolverApoyo).toHaveBeenCalledTimes(2));
    expect(A.devolverApoyo.mock.calls).toEqual([[2, 100], [1, 150]]);
    A.devolverApoyo.mockClear();
    campo = await abrirForm(u).catch(() => screen.getByLabelText("Monto devuelto (Bs)"));
    await u.clear(campo);
    await u.type(campo, "30,5");
    await u.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(A.devolverApoyo).toHaveBeenCalledTimes(1));
    expect(A.devolverApoyo).toHaveBeenCalledWith(2, 30.5);
  });

  it("no deja devolver mas de lo pendiente, ni cero, ni mas de 2 decimales", async () => {
    const u = userEvent.setup();
    const campo = await abrirForm(u);
    const guardar = () => u.click(screen.getByRole("button", { name: "Guardar" }));
    await u.clear(campo); await u.type(campo, "250.01"); await guardar();
    expect(screen.getByRole("alert")).toHaveTextContent("No puede superar lo pendiente (Bs 250.00)");
    await u.clear(campo); await u.type(campo, "0"); await guardar();
    expect(screen.getByRole("alert")).toHaveTextContent("Escribe un monto mayor a cero");
    await u.clear(campo); await u.type(campo, "10.999"); await guardar();
    expect(screen.getByRole("alert")).toHaveTextContent("El monto admite hasta 2 decimales");
    expect(A.devolverApoyo).not.toHaveBeenCalled();
  });

  it("si el servidor rechaza, muestra el motivo y mantiene el formulario", async () => {
    const u = userEvent.setup();
    A.devolverApoyo.mockRejectedValue(new Error("La devolucion supera lo pendiente (Bs 10.00)"));
    await abrirForm(u);
    await u.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("La devolucion supera lo pendiente (Bs 10.00)");
    expect(screen.getByLabelText("Monto devuelto (Bs)")).toBeInTheDocument();
  });
});

describe("Apoyos: marcar consumido", () => {
  const dos = [
    apoyoDe({ id: 1, beneficiario: "Tia Rosa", monto: 150, fecha: "2026-10-15", pendiente: 150, usuario_id: 1 }),
    apoyoDe({ id: 2, beneficiario: "Tia Rosa", monto: 100, fecha: "2026-10-01", pendiente: 100, usuario_id: 2 }),
  ];
  const r = resumen([benef("Tia Rosa", 250, 0, 0, "Pendiente", 2)]);

  it("el admin consume el pendiente de todos los apoyos (tras confirmar con el total)", async () => {
    const u = userEvent.setup();
    A.consumirApoyo.mockResolvedValue(apoyoDe());
    datos(dos, r);
    abrir(admin);
    await u.click(await screen.findByRole("button", { name: "Marcar consumido" }));
    const d = screen.getByRole("dialog", { name: "Marcar consumido" });
    expect(within(d).getByTestId("mensaje-confirmar")).toHaveTextContent(
      "Marcar Bs 250.00 de Tia Rosa como consumido? Contará como gasto familiar. Puedes reabrirlo después.",
    );
    expect(A.consumirApoyo).not.toHaveBeenCalled(); // hasta confirmar no se consume nada
    await u.click(within(d).getByRole("button", { name: "Confirmar" }));
    expect(screen.queryByRole("dialog", { name: "Marcar consumido" })).not.toBeInTheDocument();
    await waitFor(() => expect(A.consumirApoyo).toHaveBeenCalledTimes(2));
    expect(A.consumirApoyo.mock.calls.map((c) => c[0]).sort()).toEqual([1, 2]);
    expect(await screen.findByText("Marcado como consumido")).toBeInTheDocument();
  });

  it("si se cancela la confirmacion no se consume nada", async () => {
    const u = userEvent.setup();
    datos(dos, r);
    abrir(admin);
    await u.click(await screen.findByRole("button", { name: "Marcar consumido" }));
    await u.click(within(screen.getByRole("dialog", { name: "Marcar consumido" })).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog", { name: "Marcar consumido" })).not.toBeInTheDocument();
    expect(A.consumirApoyo).not.toHaveBeenCalled();
  });

  it("un miembro solo consume lo suyo (suma solo sus apoyos)", async () => {
    const u = userEvent.setup();
    A.consumirApoyo.mockResolvedValue(apoyoDe());
    datos(dos, r);
    abrir(miembro); // id 2: dueno del apoyo 2 (Bs 100)
    await u.click(await screen.findByRole("button", { name: "Marcar consumido" }));
    const d = screen.getByRole("dialog", { name: "Marcar consumido" });
    expect(within(d).getByTestId("mensaje-confirmar")).toHaveTextContent("Marcar Bs 100.00 de Tia Rosa");
    await u.click(within(d).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(A.consumirApoyo).toHaveBeenCalledTimes(1));
    expect(A.consumirApoyo).toHaveBeenCalledWith(2);
  });

  it("un miembro sin apoyos propios con saldo no ve 'Marcar consumido' (si ve 'Registrar devolucion')", async () => {
    datos([dos[0]], resumen([benef("Tia Rosa", 150, 0, 0, "Pendiente")]));
    abrir(miembro);
    expect(await screen.findByRole("button", { name: "Registrar devolución" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Marcar consumido" })).not.toBeInTheDocument();
  });
});

describe("Apoyos: permisos del menu '...'", () => {
  // montos distintos para identificar cada menu por su etiqueta
  const delAdmin = apoyoDe({ id: 1, monto: 300, usuario_id: 1, usuario_nombre: "Ana Admin", devoluciones_activas: 1,
    devoluciones: [devolucionDe({ id: 10, monto: 111, usuario_id: 1 })] });
  const delMiembro = apoyoDe({ id: 2, monto: 400, usuario_id: 2, usuario_nombre: "Beto Miembro", consumido: 50, pendiente: 350,
    devoluciones: [devolucionDe({ id: 20, apoyo_id: 2, monto: 222, usuario_id: 2, usuario_nombre: "Beto Miembro" })], devoluciones_activas: 1 });
  const r = resumen([benef("Tia Rosa", 700, 333, 50, "Pendiente", 2)]);

  it("miembro: en el apoyo del admin solo puede ver el historial", async () => {
    const u = userEvent.setup();
    datos([delAdmin, delMiembro], r);
    abrir(miembro);
    expect(await menuItems(u, "Acciones del apoyo Bs 300.00")).toEqual(["Ver historial del apoyo"]);
  });

  it("miembro: en su propio apoyo puede editar, anular, reabrir (si hay consumido) y ver historial", async () => {
    const u = userEvent.setup();
    datos([delAdmin, delMiembro], r);
    abrir(miembro);
    // (el dueno tambien puede "Compartir...": Fase 17)
    expect(await menuItems(u, "Acciones del apoyo Bs 400.00")).toEqual(["Editar apoyo", "Ver historial del apoyo", "Compartir...", "Reabrir apoyo", "Anular apoyo"]);
  });

  it("admin: puede todo en el apoyo de otro; 'Reabrir' solo si hay consumido", async () => {
    const u = userEvent.setup();
    datos([delAdmin, delMiembro], r);
    abrir(admin);
    expect(await menuItems(u, "Acciones del apoyo Bs 300.00")).toEqual(["Editar apoyo", "Ver historial del apoyo", "Compartir...", "Anular apoyo"]); // el suyo
    await u.click(screen.getByRole("button", { name: "Cerrar menu" }));
    expect(await menuItems(u, "Acciones del apoyo Bs 400.00")).toEqual(["Editar apoyo", "Ver historial del apoyo", "Reabrir apoyo", "Anular apoyo"]); // el de otro: sin "Compartir..."
  });

  it("devoluciones: el miembro solo edita/anula las suyas; en las del admin solo ve el historial", async () => {
    const u = userEvent.setup();
    datos([delAdmin, delMiembro], r);
    abrir(miembro);
    expect(await menuItems(u, "Acciones de la devolución Bs 111.00")).toEqual(["Ver historial de la devolución"]);
    await u.click(screen.getByRole("button", { name: "Cerrar menu" }));
    expect(await menuItems(u, "Acciones de la devolución Bs 222.00")).toEqual(["Editar devolución", "Ver historial de la devolución", "Anular devolución"]);
  });

  it("devoluciones: el admin gestiona las de cualquiera; una anulada ofrece Reactivar", async () => {
    const u = userEvent.setup();
    const anulada = devolucionDe({ id: 30, monto: 333, usuario_id: 2, anulado: true, anulado_por_nombre: "Ana Admin", motivo_anulacion: "mal monto" });
    datos([apoyoDe({ id: 1, monto: 300, devoluciones: [devolucionDe({ id: 10, monto: 111, usuario_id: 2 }), anulada], devoluciones_activas: 1 })], r);
    abrir(admin);
    expect(await menuItems(u, "Acciones de la devolución Bs 111.00")).toEqual(["Editar devolución", "Ver historial de la devolución", "Anular devolución"]);
    await u.click(screen.getByRole("button", { name: "Cerrar menu" }));
    expect(await menuItems(u, "Acciones de la devolución Bs 333.00")).toEqual(["Reactivar devolución", "Ver historial de la devolución"]);
    const fila = screen.getAllByTestId("fila-devolucion").find((f) => f.getAttribute("data-anulado") === "true")!;
    expect(fila).toHaveTextContent("Anulado por Ana Admin");
    expect(fila).toHaveTextContent("mal monto");
  });

  it("un apoyo anulado: el admin puede reactivarlo; sus devoluciones ya no se editan", async () => {
    const u = userEvent.setup();
    const ap = apoyoDe({ id: 5, monto: 555, estado: "Anulado", anulado: true, anulado_por_nombre: "Ana Admin",
      devoluciones: [devolucionDe({ id: 50, apoyo_id: 5, monto: 55, anulado: true })] });
    datos([ap], resumen([]));
    abrir(admin);
    await u.click(await screen.findByLabelText("Ver anulados"));
    expect(await menuItems(u, "Acciones del apoyo Bs 555.00")).toEqual(["Reactivar", "Ver historial del apoyo"]);
    await u.click(screen.getByRole("button", { name: "Cerrar menu" }));
    expect(await menuItems(u, "Acciones de la devolución Bs 55.00")).toEqual(["Ver historial de la devolución"]);
  });
});

describe("Apoyos: acciones del menu", () => {
  const ap = apoyoDe({ id: 1, monto: 300, devoluciones_activas: 2,
    devoluciones: [devolucionDe({ id: 10, monto: 111 }), devolucionDe({ id: 11, monto: 112 })], pendiente: 77 });
  const r = resumen([benef("Tia Rosa", 300, 223, 0, "Pendiente")]);

  it("Anular apoyo avisa cuantas devoluciones se anulan tambien, manda el motivo y permite Reactivar", async () => {
    const u = userEvent.setup();
    A.anularApoyo.mockResolvedValue(ap);
    A.reactivarApoyo.mockResolvedValue(ap);
    datos([ap], r);
    abrir(admin);
    await menuItems(u, "Acciones del apoyo Bs 300.00");
    await u.click(screen.getByRole("menuitem", { name: "Anular apoyo" }));
    const dialogo = screen.getByRole("dialog", { name: "Anular apoyo" });
    expect(within(dialogo).getByTestId("detalle-anular")).toHaveTextContent("Tia Rosa · Bs 300.00");
    expect(within(dialogo).getByRole("alert")).toHaveTextContent("Se anularán también 2 devoluciones.");
    await u.type(within(dialogo).getByLabelText("Motivo (opcional)"), "Error de digitacion");
    await u.click(within(dialogo).getByRole("button", { name: "Anular" }));
    await waitFor(() => expect(A.anularApoyo).toHaveBeenCalledWith(1, "Error de digitacion"));
    expect(await screen.findByText("Anulado")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Reactivar" }));
    await waitFor(() => expect(A.reactivarApoyo).toHaveBeenCalledWith(1));
  });

  it("con una sola devolucion el aviso va en singular; sin devoluciones no hay aviso", async () => {
    const u = userEvent.setup();
    datos([{ ...ap, devoluciones_activas: 1 }], r);
    abrir(admin);
    await menuItems(u, "Acciones del apoyo Bs 300.00");
    await u.click(screen.getByRole("menuitem", { name: "Anular apoyo" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Se anularán también 1 devolución.");
    await u.click(screen.getByRole("button", { name: "Cancelar" }));
  });

  it("sin devoluciones activas no hay advertencia al anular", async () => {
    const u = userEvent.setup();
    datos([{ ...ap, devoluciones_activas: 0, devoluciones: [] }], r);
    abrir(admin);
    await menuItems(u, "Acciones del apoyo Bs 300.00");
    await u.click(screen.getByRole("menuitem", { name: "Anular apoyo" }));
    expect(within(screen.getByRole("dialog", { name: "Anular apoyo" })).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("Editar apoyo lleva a la pantalla de edicion", async () => {
    const u = userEvent.setup();
    datos([ap], r);
    abrir(admin);
    await menuItems(u, "Acciones del apoyo Bs 300.00");
    await u.click(screen.getByRole("menuitem", { name: "Editar apoyo" }));
    expect(screen.getByTestId("ruta-actual")).toHaveTextContent("/editar/apoyo/1");
  });

  it("Reabrir apoyo deshace lo consumido", async () => {
    const u = userEvent.setup();
    A.reabrirApoyo.mockResolvedValue(ap);
    datos([{ ...ap, consumido: 50 }], r);
    abrir(admin);
    await menuItems(u, "Acciones del apoyo Bs 300.00");
    await u.click(screen.getByRole("menuitem", { name: "Reabrir apoyo" }));
    await waitFor(() => expect(A.reabrirApoyo).toHaveBeenCalledWith(1));
    expect(await screen.findByText("Apoyo reabierto: lo consumido volvió a pendiente")).toBeInTheDocument();
  });

  it("Anular devolucion y Reactivar devolucion llaman a la API con los ids correctos", async () => {
    const u = userEvent.setup();
    A.anularDevolucion.mockResolvedValue(ap);
    A.reactivarDevolucion.mockResolvedValue(ap);
    datos([ap], r);
    abrir(admin);
    await menuItems(u, "Acciones de la devolución Bs 111.00");
    await u.click(screen.getByRole("menuitem", { name: "Anular devolución" }));
    await u.click(within(screen.getByRole("dialog", { name: "Anular devolución" })).getByRole("button", { name: "Anular" }));
    await waitFor(() => expect(A.anularDevolucion).toHaveBeenCalledWith(1, 10, ""));
    await u.click(await screen.findByRole("button", { name: "Reactivar" }));
    await waitFor(() => expect(A.reactivarDevolucion).toHaveBeenCalledWith(1, 10));
  });

  it("Editar devolucion abre el formulario con los datos y guarda los cambios", async () => {
    const u = userEvent.setup();
    A.editarDevolucion.mockResolvedValue(ap);
    datos([ap], r);
    abrir(admin);
    await menuItems(u, "Acciones de la devolución Bs 111.00");
    await u.click(screen.getByRole("menuitem", { name: "Editar devolución" }));
    const d = screen.getByRole("dialog", { name: "Editar devolución" });
    const campo = within(d).getByLabelText("Monto (Bs)");
    expect(campo).toHaveValue("111");
    await u.clear(campo);
    await u.type(campo, "120,50");
    await u.click(within(d).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(A.editarDevolucion).toHaveBeenCalledWith(1, 10, { monto: 120.5, fecha: "2026-11-02", nota: null }));
    expect(await screen.findByText("Devolución actualizada")).toBeInTheDocument();
  });

  it("Editar devolucion muestra el error del servidor (tope devuelto + consumido)", async () => {
    const u = userEvent.setup();
    A.editarDevolucion.mockRejectedValue(new Error("Las devoluciones y lo consumido no pueden superar el apoyo (maximo Bs 111.00)"));
    datos([ap], r);
    abrir(admin);
    await menuItems(u, "Acciones de la devolución Bs 111.00");
    await u.click(screen.getByRole("menuitem", { name: "Editar devolución" }));
    const d = screen.getByRole("dialog", { name: "Editar devolución" });
    await u.click(within(d).getByRole("button", { name: "Guardar" }));
    expect(await within(d).findByRole("alert")).toHaveTextContent("maximo Bs 111.00");
    const vacio = within(d).getByLabelText("Monto (Bs)");
    await u.clear(vacio);
    await u.click(within(d).getByRole("button", { name: "Guardar" }));
    expect(within(d).getByRole("alert")).toHaveTextContent("Escribe un monto mayor a cero");
  });

  it("Ver historial abre el dialogo con las entradas del apoyo", async () => {
    const u = userEvent.setup();
    vi.mocked(hist.cadenaHistorial).mockResolvedValue({
      total: 1, hay_mas: false,
      items: [{ id: 1, entidad: "apoyo", entidad_id: 1, accion: "crear", usuario_id: 1, usuario_nombre: "Ana Admin",
        fecha: new Date(2026, 10, 3, 14, 5).toISOString(), cambios: { monto: { antes: null, despues: "300.00" } }, motivo: null, etiqueta: null }],
    });
    datos([ap], r);
    abrir(miembro);
    await menuItems(u, "Acciones del apoyo Bs 300.00");
    await u.click(screen.getByRole("menuitem", { name: "Ver historial del apoyo" }));
    expect(await screen.findByRole("dialog", { name: "Historial" })).toBeInTheDocument();
    expect(hist.cadenaHistorial).toHaveBeenCalledWith("apoyo", 1);
    expect(await screen.findByText("Monto: Bs 300.00")).toBeInTheDocument();
    expect(screen.getByTestId("titulo-historial")).toHaveTextContent("Tia Rosa · Bs 300.00");
  });
});

describe("Apoyos: carga", () => {
  it("muestra el error si no se pueden cargar", async () => {
    A.resumenApoyos.mockRejectedValue(new Error("Sin conexión con el servidor"));
    A.listarApoyos.mockRejectedValue(new Error("Sin conexión con el servidor"));
    abrir();
    expect(await screen.findByRole("alert")).toHaveTextContent("Sin conexión con el servidor");
  });
  it("mientras carga muestra 'Cargando...'", () => {
    A.resumenApoyos.mockReturnValue(new Promise(() => {}));
    A.listarApoyos.mockReturnValue(new Promise(() => {}));
    abrir();
    expect(screen.getByText("Cargando...")).toBeInTheDocument();
  });
});


describe("Apoyos: periodo (el pendiente es acumulado, el selector solo filtra lo entregado y devuelto)", () => {
  const OCT = { desde: "2026-10-01", hasta: "2026-10-31" };
  const NOV = { desde: "2026-11-01", hasta: "2026-11-30" };
  const apoyoViejo = apoyoDe({ id: 7, beneficiario: "Tia Rosa", monto: 300, fecha: "2026-09-10", devuelto: 0, pendiente: 300 });
  const apoyoNuevo = apoyoDe({ id: 8, beneficiario: "Tia Rosa", monto: 100, fecha: "2026-11-03", devuelto: 0, pendiente: 100 });
  const rAcumulado = {
    ...resumen([{ ...benef("Tia Rosa", 400, 0, 0, "Pendiente", 2), entregado_periodo: 100, devuelto_periodo: 0 }]),
  };

  it("el total pendiente lo dice: 'Pendiente total, no depende del periodo', y se pide con desde y hasta", async () => {
    datos([apoyoViejo, apoyoNuevo], rAcumulado);
    abrir();
    expect(await screen.findByTestId("nota-pendiente-total")).toHaveTextContent("Pendiente total, no depende del periodo");
    expect(screen.getByTestId("pendiente-total")).toHaveTextContent("Bs 400.00");
    expect(A.resumenApoyos).toHaveBeenCalledWith(NOV);
  });

  it("lo entregado y devuelto del periodo se muestran aparte del acumulado", async () => {
    datos([apoyoViejo, apoyoNuevo], rAcumulado);
    abrir();
    await screen.findByRole("heading", { name: "Tia Rosa" });
    expect(screen.getByTestId("entregado-periodo")).toHaveTextContent("Bs 100.00");
    expect(screen.getByTestId("devuelto-periodo")).toHaveTextContent("Bs 0.00");
    // (cada monto va en un span que no se parte en dos lineas: el texto es el mismo pero ya no es un solo nodo de texto)
    expect(tarjeta("Tia Rosa").getByTestId("en-el-periodo")).toHaveTextContent("En el periodo: entregado Bs 100.00 · devuelto Bs 0.00");
  });

  it("la lista de la tarjeta muestra solo los apoyos del periodo, pero el pendiente y la barra siguen acumulados", async () => {
    datos([apoyoViejo, apoyoNuevo], rAcumulado);
    abrir();
    await screen.findByRole("heading", { name: "Tia Rosa" });
    const filas = tarjeta("Tia Rosa").getAllByTestId("fila-apoyo");
    expect(filas).toHaveLength(1);
    expect(filas[0]).toHaveTextContent("Bs 100.00");
    expect(tarjeta("Tia Rosa").getByRole("progressbar").parentElement).toHaveTextContent("Pendiente Bs 400.00"); // etiqueta y monto van apilados: mismo texto, dos spans
  });

  it("un apoyo viejo con una devolucion hecha en el periodo tambien aparece", async () => {
    const conDevolucion = apoyoDe({
      id: 7, monto: 300, fecha: "2026-09-10", devuelto: 50, pendiente: 250,
      devoluciones: [devolucionDe({ id: 70, apoyo_id: 7, monto: 50, fecha: "2026-11-05" })], devoluciones_activas: 1,
    });
    datos([conDevolucion], resumen([{ ...benef("Tia Rosa", 300, 50, 0, "Pendiente"), entregado_periodo: 0, devuelto_periodo: 50 }]));
    abrir();
    await screen.findByRole("heading", { name: "Tia Rosa" });
    expect(tarjeta("Tia Rosa").getAllByTestId("fila-apoyo")).toHaveLength(1);
  });

  it("al ir al periodo anterior vuelve a pedir el resumen de ese periodo (y no muestra el viejo mientras llega)", async () => {
    const u = userEvent.setup();
    datos([apoyoViejo, apoyoNuevo], rAcumulado);
    abrir();
    await screen.findByRole("heading", { name: "Tia Rosa" });
    await u.click(screen.getByLabelText("Periodo anterior"));
    await waitFor(() => expect(A.resumenApoyos).toHaveBeenLastCalledWith(OCT));
    expect(await screen.findByTestId("etiqueta-periodo")).toHaveTextContent("Octubre 2026");
    // el pendiente sigue siendo el acumulado aunque octubre no tenga movimientos de apoyos
    expect(await screen.findByTestId("pendiente-total")).toHaveTextContent("Bs 400.00");
  });

  it("sin conexion y sin copia de ese periodo: 'Sin datos guardados para este periodo'", async () => {
    A.resumenApoyos.mockRejectedValue(new ErrorRed());
    A.listarApoyos.mockResolvedValue([]);
    abrir();
    expect(await screen.findByTestId("sin-datos-periodo")).toHaveTextContent("Sin datos guardados para este periodo");
  });
});
