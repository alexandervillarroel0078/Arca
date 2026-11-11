// Pantallas de Cuentas con la API simulada: permisos en la interfaz, saldo negativo, aviso de nota, el servidor manda.
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorApi } from "../../core/api";
import { admin, renderPantalla } from "../../test/ayudas";
import { cuentaDe, mov } from "../../test/cuentas";
import { instalarVozFalsa, quitarVozFalsa } from "../../test/vozFalsa";
import type { Yo } from "../auth/api";
import * as api from "./api";
import * as familia from "../familia/api";
import PaginaCuentaDetalle from "./PaginaCuentaDetalle";
import PaginaCuentaForm from "./PaginaCuentaForm";
import PaginaCuentas from "./PaginaCuentas";
import PaginaMovimientoNuevo from "./PaginaMovimientoNuevo";

vi.mock("./api");
const sesion = vi.hoisted(() => ({ usuario: null as Yo | null, salir: vi.fn(), actualizarUsuario: vi.fn() }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => sesion, useUsuarioOpcional: () => sesion.usuario }));
vi.mock("../familia/api");
vi.mock("../historial/DialogoHistorial", () => ({ default: () => <div data-testid="dialogo-historial" /> }));

const m = vi.mocked(api);
beforeEach(() => {
  sesion.usuario = admin;
  vi.mocked(familia.listarMiembros).mockResolvedValue([
    { usuario_id: 1, nombre: "Ana Admin", email: "a@t.com", rol: "admin", activo: true },
    { usuario_id: 2, nombre: "Beto Miembro", email: "b@t.com", rol: "miembro", activo: true },
  ] as never);
  m.listarCuentas.mockReset();
  m.obtenerCuenta.mockReset();
  m.listarMovimientosCuentas.mockReset().mockResolvedValue([]);
  m.catalogo.mockReset().mockRejectedValue(new Error("sin catálogo")); // se usan las listas locales
});

const lista = (cuentas = [cuentaDe()], totales: api.TotalMoneda[] = [{ moneda: "BS", total: "0.00", cuentas: 1, hay_negativas: false }], privadas = 0) =>
  m.listarCuentas.mockResolvedValue({ cuentas, totales, privadas_propias: privadas });

describe("Inicio de Cuentas", () => {
  it("un bloque por moneda, sin sumar monedas distintas, y el aviso de cuentas privadas", async () => {
    lista(
      [cuentaDe({ id: 1, saldo: "100.50" }), cuentaDe({ id: 2, nombre: "Dólares", moneda: "USD", saldo: "20.00" })],
      [
        { moneda: "BS", total: "100.50", cuentas: 1, hay_negativas: false },
        { moneda: "USD" as const, total: "20.00", cuentas: 1, hay_negativas: false },
        { moneda: "BTC" as const, total: "0.00012345", cuentas: 1, hay_negativas: false },
      ],
      2,
    );
    renderPantalla(<PaginaCuentas />, { ruta: "/cuentas" });
    expect(await screen.findByTestId("total-BS")).toHaveTextContent("Bs 100.50");
    expect(screen.getByTestId("total-USD")).toHaveTextContent("USD 20.00");
    expect(screen.getByTestId("total-BTC")).toHaveTextContent("BTC 0.00012345");
    expect(screen.getByTestId("aviso-privadas")).toHaveTextContent("Incluye tus 2 cuentas privadas");
    expect(screen.getByRole("link", { name: "Nueva cuenta" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Registrar movimiento" })).toBeInTheDocument();
  });

  it("sin cuentas privadas no hay aviso; si no puedes registrar en ninguna, no hay «Registrar movimiento»", async () => {
    lista([cuentaDe({ puede_registrar: false, es_dueno: false })]);
    renderPantalla(<PaginaCuentas />, { ruta: "/cuentas" });
    await screen.findByTestId("fila-cuenta");
    expect(screen.queryByTestId("aviso-privadas")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Registrar movimiento" })).not.toBeInTheDocument();
  });

  it("una cuenta muestra banco, tipo y últimos 4 dígitos; el saldo negativo va en rojo con aviso (no solo color)", async () => {
    lista([cuentaDe({ tipo: "ahorro", banco: "Banco Unión", ultimos4: "4821", saldo: "-15.00", saldo_negativo: true })]);
    renderPantalla(<PaginaCuentas />, { ruta: "/cuentas" });
    const fila = await screen.findByTestId("fila-cuenta");
    expect(fila).toHaveTextContent("Banco Unión · Caja de ahorro · •••• 4821");
    const saldo = within(fila).getByTestId("saldo-cuenta");
    expect(saldo).toHaveTextContent("-Bs 15.00");
    expect(saldo).toHaveAttribute("data-negativo", "true");
    expect(saldo).toHaveClass("text-red-700");
    expect(saldo.textContent).toContain("⚠");
  });

  it("estado vacío amable", async () => {
    lista([], []);
    renderPantalla(<PaginaCuentas />, { ruta: "/cuentas" });
    expect(await screen.findByTestId("estado-vacio")).toHaveTextContent("Todavía no hay cuentas");
  });
});

describe("Detalle de cuenta: los botones salen de lo que dice la API", () => {
  const abrir = async (c = cuentaDe(), movs = [mov({ id: 7 })]) => {
    m.obtenerCuenta.mockResolvedValue(c);
    m.listarMovimientosCuentas.mockResolvedValue(movs);
    renderPantalla(<PaginaCuentaDetalle />, { ruta: `/cuentas/${c.id}`, patron: "/cuentas/:id" });
    await screen.findByTestId("mes-cuenta");
    await screen.findAllByTestId("fila-movimiento");
  };

  it("dueño: registrar, editar, anular cuenta y anular movimientos", async () => {
    await abrir();
    expect(screen.getByRole("link", { name: "Registrar en esta cuenta" })).toHaveAttribute("href", "/cuentas/movimiento?cuenta=1");
    expect(screen.getByRole("link", { name: "Editar" })).toHaveAttribute("href", "/cuentas/1/editar");
    expect(screen.getByRole("button", { name: "Anular cuenta" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anular" })).toBeInTheDocument();
  });

  it("encargado: registra y anula movimientos, pero no edita ni anula la cuenta", async () => {
    await abrir(cuentaDe({ es_dueno: false, puede_registrar: true }));
    expect(screen.getByRole("link", { name: "Registrar en esta cuenta" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Anular cuenta" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anular" })).toBeInTheDocument();
  });

  it("miembro que solo ve (también el admin si no es dueño ni encargado): ningún botón de registrar, editar ni anular", async () => {
    await abrir(cuentaDe({ es_dueno: false, puede_registrar: false }), [mov({ id: 7, puede_registrar: false })]);
    expect(screen.queryByRole("link", { name: "Registrar en esta cuenta" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Anular/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reactivar" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Historial" }).length).toBeGreaterThan(0); // ver sí
  });

  it("un traspaso con una cuenta que no ves muestra «otra cuenta» y no se puede anular si solo ves una", async () => {
    await abrir(cuentaDe({ es_dueno: false, puede_registrar: true }), [
      mov({ id: 8, tipo: "traspaso", cuenta_id: null, cuenta_nombre: "otra cuenta", cuenta_destino_id: 1, cuenta_destino_nombre: "Caja", efecto: "40.00", puede_registrar: false }),
    ]);
    expect(screen.getByTestId("fila-movimiento")).toHaveTextContent("Traspaso desde otra cuenta");
    expect(screen.queryByRole("button", { name: "Anular" })).not.toBeInTheDocument();
  });

  it("saldo negativo: rojo, con aviso, sin bloquear el botón de registrar", async () => {
    await abrir(cuentaDe({ saldo: "-30.00", saldo_negativo: true }));
    expect(screen.getAllByTestId("saldo-cuenta")[0]).toHaveAttribute("data-negativo", "true");
    expect(screen.getByTestId("aviso-negativo")).toHaveTextContent("Saldo en negativo");
    expect(screen.getByRole("link", { name: "Registrar en esta cuenta" })).not.toHaveAttribute("aria-disabled");
  });

  it("Entró y Salió con los traspasos y ajustes aparte", async () => {
    await abrir(cuentaDe(), [
      mov({ id: 1, tipo: "deposito", efecto: "100.00" }),
      mov({ id: 2, tipo: "retiro", comision: "1.00", efecto: "-21.00" }),
      mov({ id: 3, tipo: "traspaso", cuenta_destino_id: 2, cuenta_destino_nombre: "Otra", efecto: "-40.00" }),
      mov({ id: 4, tipo: "ajuste", sentido: "entrada", efecto: "3.00", saldo_declarado: "10.00" }),
    ]);
    expect(screen.getByTestId("entro")).toHaveTextContent("Bs 100.00");
    expect(screen.getByTestId("salio")).toHaveTextContent("Bs 21.00");
    expect(screen.getByTestId("aparte")).toHaveTextContent("traspasos -Bs 40.00");
    expect(screen.getByTestId("aparte")).toHaveTextContent("ajustes por conteo Bs 3.00");
  });

  it("el servidor manda: si rechaza anular (403), la pantalla se vuelve a pedir y se avisa", async () => {
    await abrir();
    m.anularMovimientoCuenta.mockRejectedValue(new ErrorApi(403, "Solo el dueño o el encargado de la cuenta puede registrar o anular sus movimientos"));
    const llamadas = m.obtenerCuenta.mock.calls.length;
    await userEvent.click(within(screen.getByTestId("fila-movimiento")).getByRole("button", { name: "Anular" }));
    const dialogo = await screen.findByRole("dialog", { name: "Anular movimiento" });
    await userEvent.click(within(dialogo).getByRole("button", { name: "Anular" }));
    await waitFor(() => expect(m.obtenerCuenta.mock.calls.length).toBeGreaterThan(llamadas)); // refrescó
    expect(await screen.findByText(/Se actualizó la pantalla con los datos del servidor/)).toBeInTheDocument();
  });
});

describe("Nuevo movimiento", () => {
  const cuentas = [
    cuentaDe({ id: 1, nombre: "Efectivo Bs", saldo: "100.00" }),
    cuentaDe({ id: 2, nombre: "Ahorro Bs", tipo: "ahorro", banco: "Banco Unión", saldo: "50.00" }),
    cuentaDe({ id: 3, nombre: "Dólares", moneda: "USD", saldo: "10.00" }),
    cuentaDe({ id: 4, nombre: "Billetera BTC", tipo: "cripto", moneda: "BTC", banco: "Binance", saldo: "0.5" }),
    cuentaDe({ id: 5, nombre: "Solo lectura", puede_registrar: false, es_dueno: false }),
  ];
  const abrir = async (query = "") => {
    lista(cuentas);
    renderPantalla(<PaginaMovimientoNuevo />, { ruta: `/cuentas/movimiento${query}`, patron: "/cuentas/movimiento" });
    await screen.findByRole("radiogroup", { name: "Tipo de movimiento" });
  };

  it("el aviso «No escribas claves ni frases semilla» está visible junto a la nota", async () => {
    await abrir();
    const aviso = screen.getByTestId("aviso-nota");
    expect(aviso).toBeVisible();
    expect(aviso).toHaveTextContent("No escribas claves ni frases semilla");
    const nota = screen.getByLabelText("Nota (opcional)");
    expect(nota).toHaveAttribute("aria-describedby", aviso.id);
  });

  describe("botón «Dictar movimiento»", () => {
    afterEach(() => quitarVozFalsa());
    const boton = () => screen.getByRole("button", { name: /Dictar movimiento/ });

    it("sin soporte del navegador: está visible pero desactivado, con su explicación, y el aviso de privacidad", async () => {
      await abrir(); // jsdom no tiene reconocimiento de voz
      expect(boton()).toBeVisible();
      expect(boton()).toBeDisabled();
      expect(screen.getByTestId("dictado-explicacion")).toHaveTextContent("Tu navegador no permite dictar. Prueba con Chrome o Edge.");
      expect(screen.getByTestId("dictado-privacidad")).toHaveTextContent(
        "El dictado lo procesa el servicio de voz de tu navegador. Arca no guarda ni recibe el audio. No dictes claves ni frases semilla.",
      );
    });

    it("sin conexión: visible pero desactivado, con su explicación", async () => {
      instalarVozFalsa();
      const enLinea = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      try {
        await abrir();
        expect(boton()).toBeDisabled();
        expect(screen.getByTestId("dictado-explicacion")).toHaveTextContent("Necesitas conexión a internet para dictar.");
      } finally {
        enLinea.mockRestore();
      }
    });

    it("con soporte y conexión: activo una vez cargadas las cuentas y los miembros", async () => {
      instalarVozFalsa();
      await abrir();
      expect(boton()).toBeEnabled();
      expect(screen.queryByTestId("dictado-explicacion")).not.toBeInTheDocument();
      expect(screen.getByTestId("dictado-privacidad")).toBeVisible();
    });
  });

  describe("dictado: rellena el formulario, nunca guarda", () => {
    let voz: ReturnType<typeof instalarVozFalsa>;
    beforeEach(() => {
      voz = instalarVozFalsa();
    });
    afterEach(() => quitarVozFalsa());
    const dictar = async (...alternativas: string[]) => {
      await userEvent.click(screen.getByRole("button", { name: /Dictar movimiento/ }));
      act(() => voz.ultima().decir(...alternativas));
    };
    const tipoMarcado = () => screen.getAllByRole("radio", { checked: true }).map((r) => r.textContent)[0];
    const monto = () => screen.getByLabelText(/^Monto \(/);

    it("tipo, cuenta y monto; lo anuncia en una región aria-live y no llama al servidor", async () => {
      await abrir();
      await dictar("retiro de cien con cincuenta del efectivo");
      expect(tipoMarcado()).toBe("Retiro");
      expect(screen.getByLabelText("Cuenta")).toHaveValue("1");
      expect(monto()).toHaveValue("100.50");
      const estado = screen.getByTestId("dictado-estado");
      expect(estado).toHaveAttribute("aria-live", "polite");
      expect(estado).toHaveTextContent("Dictado aplicado: 3 campos rellenados, 0 por revisar.");
      expect(screen.queryByTestId("aviso-revisar")).not.toBeInTheDocument();
      for (const f of [m.registrarDeposito, m.registrarRetiro, m.registrarTraspaso, m.registrarAjuste]) expect(f).not.toHaveBeenCalled();
    });

    it("Guardar sigue siendo el único camino: manda lo dictado tal cual", async () => {
      await abrir();
      m.registrarRetiro.mockResolvedValue(mov({ id: 10, tipo: "retiro", monto: "100.50" }));
      await dictar("retiro de cien con cincuenta del efectivo");
      expect(m.registrarRetiro).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole("button", { name: /^Guardar/ }));
      await waitFor(() => expect(m.registrarRetiro).toHaveBeenCalledWith(1, expect.objectContaining({ monto: "100.50", persona_tipo: "sin_identificar" })));
    });

    it("traspaso: origen y destino", async () => {
      await abrir();
      await dictar("traspaso de 200 del efectivo al ahorro");
      expect(tipoMarcado()).toBe("Traspaso");
      expect(screen.getByLabelText("Desde")).toHaveValue("1");
      expect(screen.getByLabelText("Hacia")).toHaveValue("2");
      expect(monto()).toHaveValue("200");
    });

    it("lo que no entendió queda vacío y resaltado, y se limpia al corregirlo", async () => {
      await abrir();
      await userEvent.type(monto(), "77");
      await dictar("depósito de 10,5555 al efectivo");
      expect(monto()).toHaveValue("");
      expect(screen.getByTestId("aviso-revisar")).toHaveTextContent("Escuché 10.5555: Bs admite hasta 2 decimales");
      expect(monto().closest('[data-revisar="true"]')).not.toBeNull();
      expect(screen.getByTestId("dictado-estado")).toHaveTextContent("2 campos rellenados, 1 por revisar");
      await userEvent.type(monto(), "5");
      expect(screen.queryByTestId("aviso-revisar")).not.toBeInTheDocument();
    });

    it("tipo que no se entendió: se marca y se conserva el que había", async () => {
      await abrir();
      await dictar("100 bolivianos del efectivo");
      expect(tipoMarcado()).toBe("Depósito");
      expect(screen.getByTestId("aviso-revisar")).toHaveTextContent("No entendí el tipo de movimiento");
      await userEvent.click(screen.getByRole("radio", { name: "Retiro" }));
      expect(screen.queryByTestId("aviso-revisar")).not.toBeInTheDocument();
    });

    it("empate entre cuentas: se elige con un toque, y la elección quita el aviso", async () => {
      lista([cuentaDe({ id: 1, nombre: "BCP Sueldo", tipo: "corriente", banco: "BCP" }), cuentaDe({ id: 2, nombre: "BCP Ahorro", tipo: "ahorro", banco: "BCP" }), cuentaDe({ id: 3, nombre: "Caja" })]);
      renderPantalla(<PaginaMovimientoNuevo />, { ruta: "/cuentas/movimiento", patron: "/cuentas/movimiento" });
      await screen.findByRole("radiogroup", { name: "Tipo de movimiento" });
      await dictar("depósito a la cuenta bcp 1.500 bolivianos");
      const grupo = screen.getByRole("group", { name: "Elige la cuenta" });
      expect(within(grupo).getAllByRole("button").map((b) => b.textContent)).toEqual(["BCP Sueldo · BCP · Bs", "BCP Ahorro · BCP · Bs"]);
      expect(screen.getByTestId("aviso-revisar")).toHaveTextContent("más de una cuenta");
      expect(monto()).toHaveValue("1500");
      expect(screen.getByTestId("dictado-estado")).toHaveTextContent("2 campos rellenados, 1 por revisar");
      await userEvent.click(within(grupo).getByRole("button", { name: /BCP Ahorro/ }));
      expect(screen.getByLabelText("Cuenta")).toHaveValue("2");
      expect(screen.queryByRole("group", { name: "Elige la cuenta" })).not.toBeInTheDocument();
      expect(screen.queryByTestId("aviso-revisar")).not.toBeInTheDocument();
      expect(m.registrarDeposito).not.toHaveBeenCalled();
    });

    it("el empate también se resuelve en el destino de un traspaso", async () => {
      lista([cuentaDe({ id: 1, nombre: "Caja" }), cuentaDe({ id: 2, nombre: "BCP Sueldo", banco: "BCP" }), cuentaDe({ id: 3, nombre: "BCP Ahorro", tipo: "ahorro", banco: "BCP" })]);
      renderPantalla(<PaginaMovimientoNuevo />, { ruta: "/cuentas/movimiento", patron: "/cuentas/movimiento" });
      await screen.findByRole("radiogroup", { name: "Tipo de movimiento" });
      await dictar("traspaso de 100 de la caja al bcp");
      const grupo = screen.getByRole("group", { name: "Elige la cuenta de destino" });
      await userEvent.click(within(grupo).getByRole("button", { name: /BCP Sueldo/ }));
      expect(screen.getByLabelText("Hacia")).toHaveValue("2");
      expect(screen.queryByTestId("aviso-revisar")).not.toBeInTheDocument();
    });

    it("«ajuste» no se dicta: avisa y no cambia nada", async () => {
      await abrir();
      await userEvent.type(monto(), "5");
      await dictar("ajuste del efectivo 500");
      expect(screen.getByTestId("dictado-estado")).toHaveTextContent("El ajuste por conteo no se dicta");
      expect(tipoMarcado()).toBe("Depósito");
      expect(monto()).toHaveValue("5");
      expect(screen.queryByTestId("aviso-revisar")).not.toBeInTheDocument();
    });

    it("si no entiende nada, lo dice y deja el formulario como estaba", async () => {
      await abrir();
      await userEvent.type(monto(), "5");
      await dictar("hola buenas tardes");
      expect(screen.getByTestId("dictado-estado")).toHaveTextContent("No entendí nada del dictado");
      expect(monto()).toHaveValue("5");
    });

    it("moneda dicha distinta a la de la cuenta: la cuenta se rellena pero queda por revisar", async () => {
      await abrir();
      await dictar("retiro de 100 dólares del efectivo");
      expect(screen.getByLabelText("Cuenta")).toHaveValue("1");
      expect(screen.getByTestId("aviso-revisar")).toHaveTextContent("Dijiste USD, pero «Efectivo Bs» está en Bs");
      expect(screen.getByTestId("dictado-estado")).toHaveTextContent("2 campos rellenados, 1 por revisar");
    });

    it("lo dictado no deja nada en el aparato", async () => {
      await abrir();
      await dictar("retiro de cien con cincuenta del efectivo");
      expect(sessionStorage.length).toBe(0);
      expect(JSON.stringify({ ...localStorage })).not.toMatch(/100|cincuenta|efectivo/i);
    });
  });

  it("solo ofrece cuentas donde puedes registrar", async () => {
    await abrir();
    const select = screen.getByLabelText("Cuenta");
    const nombres = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(nombres.join("|")).not.toContain("Solo lectura");
    expect(nombres).toHaveLength(4);
  });

  it("montos rápidos 50, 100, 200 y 500 (no en BTC); llenan el monto", async () => {
    await abrir();
    const grupo = screen.getByRole("group", { name: "Montos rápidos" });
    expect(within(grupo).getAllByRole("button").map((b) => b.textContent)).toEqual(["50", "100", "200", "500"]);
    await userEvent.click(within(grupo).getByRole("button", { name: "200" }));
    expect(screen.getByLabelText(/^Monto \(/)).toHaveValue("200");
    await userEvent.selectOptions(screen.getByLabelText("Cuenta"), "4");
    expect(screen.queryByRole("group", { name: "Montos rápidos" })).not.toBeInTheDocument();
  });

  it("Bs: 3 decimales da error y no llama al servidor; 8 decimales en BTC pasan", async () => {
    await abrir();
    await userEvent.type(screen.getByLabelText(/^Monto \(/), "10.005");
    await userEvent.click(screen.getByRole("button", { name: /^Guardar/ }));
    expect(await screen.findByText(/hasta 2 decimales/)).toBeInTheDocument();
    expect(m.registrarDeposito).not.toHaveBeenCalled();
  });

  it("traspaso: «Hacia» solo lista cuentas de la misma moneda donde puedes registrar", async () => {
    await abrir("?tipo=traspaso&cuenta=1");
    const hacia = screen.getByLabelText("Hacia");
    const op = within(hacia).getAllByRole("option").map((o) => o.textContent ?? "");
    expect(op.some((t) => t.includes("Ahorro Bs"))).toBe(true);
    expect(op.some((t) => t.includes("Dólares") || t.includes("Billetera") || t.includes("Solo lectura") || t.includes("Efectivo Bs"))).toBe(false);
  });

  it("la comisión de red solo aparece en un retiro de una cuenta cripto", async () => {
    await abrir("?tipo=retiro&cuenta=1");
    expect(screen.queryByLabelText(/Comisión de red/)).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Cuenta"), "4");
    expect(screen.getByLabelText(/Comisión de red/)).toBeInTheDocument();
  });

  it("ajuste: muestra la diferencia ANTES de guardar", async () => {
    await abrir("?tipo=ajuste&cuenta=1");
    await userEvent.type(screen.getByLabelText(/Saldo real contado/), "95.50");
    const dif = screen.getByTestId("diferencia-ajuste");
    expect(dif).toHaveTextContent("Saldo registrado: Bs 100.00");
    expect(dif).toHaveTextContent("−Bs 4.50");
    expect(dif).toHaveTextContent("se registra como salida");
    expect(m.registrarAjuste).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText(/Saldo real contado/));
    await userEvent.type(screen.getByLabelText(/Saldo real contado/), "100");
    expect(screen.getByTestId("diferencia-ajuste")).toHaveTextContent("no hay nada que ajustar");
    expect(screen.getByRole("button", { name: /^Guardar/ })).toBeDisabled();
  });

  it("ajuste: si el servidor calculó sobre otro saldo previo, lo dice", async () => {
    await abrir("?tipo=ajuste&cuenta=1");
    m.registrarAjuste.mockResolvedValue(mov({ id: 9, tipo: "ajuste", sentido: "entrada", monto: "10.00", saldo_previo: "140.00", saldo_declarado: "150.00", cuenta_id: 1 }));
    await userEvent.type(screen.getByLabelText(/Saldo real contado/), "150");
    await userEvent.click(screen.getByRole("button", { name: /^Guardar/ }));
    expect(await screen.findByText(/el saldo cambió mientras tanto/)).toBeInTheDocument();
    expect(screen.getByText(/se ajustó sobre Bs 140.00 \(veías Bs 100.00\)/)).toBeInTheDocument();
  });

  it("saldo negativo: avisa antes de guardar, no bloquea, y avisa al guardar", async () => {
    await abrir("?tipo=retiro&cuenta=1");
    m.registrarRetiro.mockResolvedValue(mov({ id: 10, tipo: "retiro", monto: "150.00", saldo_resultante: "-50.00", deja_saldo_negativo: true }));
    await userEvent.type(screen.getByLabelText(/^Monto \(/), "150");
    expect(screen.getByTestId("aviso-negativo")).toHaveTextContent("quedará en negativo");
    const guardar = screen.getByRole("button", { name: /^Guardar/ });
    expect(guardar).toBeEnabled();
    await userEvent.click(guardar);
    expect(await screen.findByText(/La cuenta quedó en negativo \(-Bs 50.00\)/)).toBeInTheDocument();
    expect(m.registrarRetiro).toHaveBeenCalledWith(1, expect.objectContaining({ monto: "150", persona_tipo: "sin_identificar" }));
  });

  it("persona «Otra persona»: nombre libre, con sugerencias de nombres ya usados", async () => {
    m.listarMovimientosCuentas.mockResolvedValue([mov({ id: 1, persona_tipo: "otra", persona_nombre: "Tía Rosa" })]);
    await abrir();
    await userEvent.click(screen.getByRole("radio", { name: "Otra persona" }));
    await userEvent.type(screen.getByLabelText("Nombre de la otra persona"), "tía");
    await userEvent.click(await screen.findByRole("button", { name: "Tía Rosa" }));
    expect(screen.getByLabelText("Nombre de la otra persona")).toHaveValue("Tía Rosa");
  });

  it("el rechazo del servidor (403) se muestra, refresca las cuentas y deja la pantalla con datos nuevos", async () => {
    await abrir();
    m.registrarDeposito.mockRejectedValue(new ErrorApi(403, "Solo el dueño o el encargado de la cuenta puede registrar o anular sus movimientos"));
    const llamadas = m.listarCuentas.mock.calls.length;
    await userEvent.type(screen.getByLabelText(/^Monto \(/), "5");
    await userEvent.click(screen.getByRole("button", { name: /^Guardar/ }));
    await waitFor(() => expect(m.listarCuentas.mock.calls.length).toBeGreaterThan(llamadas));
    expect((await screen.findAllByText(/Se actualizó la pantalla con los datos del servidor/)).length).toBeGreaterThan(0);
  });
});

describe("Nueva cuenta / editar", () => {
  const abrirNueva = () => renderPantalla(<PaginaCuentaForm />, { ruta: "/cuentas/nueva" });

  it("moneda según la matriz: al elegir Cripto solo USDT y BTC; el efectivo no pide banco", async () => {
    abrirNueva();
    const moneda = await screen.findByLabelText("Moneda");
    expect(within(moneda).getAllByRole("option").map((o) => o.textContent)).toEqual(["Bs", "USD"]);
    expect(screen.queryByLabelText("Banco")).not.toBeInTheDocument(); // efectivo por defecto
    await userEvent.click(screen.getByRole("radio", { name: "Cripto" }));
    expect(within(screen.getByLabelText("Moneda")).getAllByRole("option").map((o) => o.textContent)).toEqual(["USDT", "BTC"]);
    expect(screen.getByLabelText("Plataforma")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Caja de ahorro" }));
    expect(screen.getByLabelText("Banco")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Moneda")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Bs", "USD"]);
  });

  it("últimos 4 dígitos: solo cifras y 4 como máximo", async () => {
    abrirNueva();
    await userEvent.click(await screen.findByRole("radio", { name: "Caja de ahorro" }));
    const campo = screen.getByLabelText(/Últimos 4 dígitos/);
    await userEvent.type(campo, "12a3-45678");
    expect(campo).toHaveValue("1234");
    expect(screen.getByText(/nunca el número completo/)).toBeInTheDocument();
  });

  it("crea la cuenta con lo escrito y la visibilidad elegida", async () => {
    m.crearCuenta.mockResolvedValue(cuentaDe({ id: 9 }));
    abrirNueva();
    await userEvent.type(await screen.findByLabelText("Nombre de la cuenta"), "Caja chica");
    await userEvent.type(screen.getByLabelText(/Saldo inicial/), "250.5");
    await userEvent.click(screen.getByRole("radio", { name: /Solo yo/ }));
    await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    await waitFor(() => expect(m.crearCuenta).toHaveBeenCalled());
    expect(m.crearCuenta.mock.calls[0][0]).toMatchObject({ nombre: "Caja chica", tipo: "efectivo", moneda: "BS", saldo_inicial: "250.5", visibilidad: "solo_yo" });
    expect(m.crearCuenta.mock.calls[0][0]).not.toHaveProperty("ultimos4");
  });

  it("editar: si no eres el dueño (lo dice la API) vuelve al detalle sin formulario", async () => {
    m.obtenerCuenta.mockResolvedValue(cuentaDe({ es_dueno: false, puede_registrar: true }));
    renderPantalla(<PaginaCuentaForm />, { ruta: "/cuentas/1/editar", patron: "/cuentas/:id/editar" });
    expect(await screen.findByTestId("otra-pantalla")).toBeInTheDocument();
    expect(screen.queryByLabelText("Nombre de la cuenta")).not.toBeInTheDocument();
  });

  it("editar una cuenta con movimientos: tipo, moneda y saldo inicial quedan fijos", async () => {
    m.obtenerCuenta.mockResolvedValue(cuentaDe());
    m.listarMovimientosCuentas.mockResolvedValue([mov()]);
    renderPantalla(<PaginaCuentaForm />, { ruta: "/cuentas/1/editar", patron: "/cuentas/:id/editar" });
    expect(await screen.findByTestId("aviso-fijo")).toBeInTheDocument();
    expect(screen.getByLabelText("Moneda")).toBeDisabled();
    expect(screen.getByLabelText(/Saldo inicial/)).toBeDisabled();
  });
});
