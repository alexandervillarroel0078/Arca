// Botón «Dictar movimiento» con una voz falsa: soporte, conexión, idiomas, errores y que nada se guarda en el aparato.
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { instalarVozFalsa, quitarVozFalsa } from "../../test/vozFalsa";
import BotonDictar, { AVISO_PRIVACIDAD_DICTADO } from "./BotonDictar";

const boton = () => screen.getByTestId("boton-dictar");
let voz: ReturnType<typeof instalarVozFalsa>;
let enLinea: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  enLinea = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  voz = instalarVozFalsa();
});
afterEach(() => {
  quitarVozFalsa();
  enLinea.mockRestore();
});

function pantalla(alTerminar = vi.fn(), listo = true, mensaje = "") {
  const r = render(<BotonDictar listo={listo} alTerminar={alTerminar} mensaje={mensaje} />);
  return { alTerminar, ...r };
}

describe("botón de dictado: visible siempre, activo solo si se puede", () => {
  it("con soporte y conexión: activo, y el texto de privacidad siempre visible", () => {
    pantalla();
    expect(boton()).toBeEnabled();
    expect(boton()).toHaveTextContent("Dictar movimiento");
    expect(screen.queryByTestId("dictado-explicacion")).not.toBeInTheDocument();
    expect(screen.getByTestId("dictado-privacidad")).toHaveTextContent(
      "El dictado lo procesa el servicio de voz de tu navegador. Arca no guarda ni recibe el audio. No dictes claves ni frases semilla.",
    );
    expect(AVISO_PRIVACIDAD_DICTADO).toBe(
      "El dictado lo procesa el servicio de voz de tu navegador. Arca no guarda ni recibe el audio. No dictes claves ni frases semilla.",
    );
  });

  it("sin soporte del navegador: visible pero desactivado, con una línea de explicación (y el aviso sigue)", () => {
    quitarVozFalsa();
    pantalla();
    expect(boton()).toBeVisible();
    expect(boton()).toBeDisabled();
    expect(screen.getByTestId("dictado-explicacion")).toHaveTextContent("Tu navegador no permite dictar. Prueba con Chrome o Edge.");
    expect(boton()).toHaveAttribute("aria-describedby", "dictado-explicacion");
    expect(screen.getByTestId("dictado-privacidad")).toBeVisible();
  });

  it("sin conexión: desactivado con explicación, y se activa al volver la conexión", () => {
    enLinea.mockReturnValue(false);
    pantalla();
    expect(boton()).toBeDisabled();
    expect(screen.getByTestId("dictado-explicacion")).toHaveTextContent("Necesitas conexión a internet para dictar.");
    enLinea.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(boton()).toBeEnabled();
    expect(screen.queryByTestId("dictado-explicacion")).not.toBeInTheDocument();
  });

  it("hasta que la pantalla carga sus datos, el botón espera (sin explicación)", () => {
    pantalla(vi.fn(), false);
    expect(boton()).toBeDisabled();
    expect(screen.queryByTestId("dictado-explicacion")).not.toBeInTheDocument();
  });

  it("también funciona con el nombre sin prefijo (SpeechRecognition)", () => {
    const Ctor = class {
      static n = 0;
      lang = "";
      continuous = true;
      interimResults = false;
      maxAlternatives = 1;
      onresult = null;
      onerror = null;
      onend = null;
      constructor() {
        Ctor.n++;
      }
      start() {}
      stop() {}
      abort() {}
    };
    quitarVozFalsa();
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = Ctor;
    pantalla();
    expect(boton()).toBeEnabled();
  });
});

describe("escuchar", () => {
  it("es-BO, una sola frase, interinos, 3 alternativas; entrega las alternativas y se olvida de ellas", async () => {
    const { alTerminar } = pantalla();
    await userEvent.click(boton());
    const v = voz.ultima();
    expect(v).toMatchObject({ lang: "es-BO", continuous: false, interimResults: true, maxAlternatives: 3, iniciada: true });
    expect(boton()).toHaveTextContent("Escuchando");
    expect(boton()).toHaveAttribute("aria-pressed", "true");

    act(() => v.parcial("depósito de mil"));
    expect(screen.getByTestId("dictado-parcial")).toHaveTextContent("depósito de mil");

    act(() => v.decir("depósito de mil bolivianos", "deposito de mil bolivianos", "deposito de 1000"));
    expect(alTerminar).toHaveBeenCalledTimes(1);
    expect(alTerminar).toHaveBeenCalledWith(["depósito de mil bolivianos", "deposito de mil bolivianos", "deposito de 1000"]);
    // al terminar, lo escuchado ya no está en pantalla
    expect(screen.queryByTestId("dictado-parcial")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("mil bolivianos");
    expect(boton()).toHaveTextContent("Dictar movimiento");
    expect(boton()).toHaveAttribute("aria-pressed", "false");
  });

  it("tocar de nuevo mientras escucha termina y entrega lo entendido", async () => {
    const { alTerminar } = pantalla();
    await userEvent.click(boton());
    const v = voz.ultima();
    v.onresult?.({ results: { length: 1, 0: { isFinal: true, length: 1, 0: { transcript: "retiro de cien" } } } });
    await userEvent.click(boton());
    expect(v.detenida).toBe(true);
    expect(alTerminar).toHaveBeenCalledWith(["retiro de cien"]);
  });

  it("si es-BO no existe, reintenta con es-419 sin molestar al usuario", async () => {
    const { alTerminar } = pantalla();
    await userEvent.click(boton());
    act(() => voz.ultima().fallar("language-not-supported"));
    expect(voz.todas()).toHaveLength(2);
    expect(voz.ultima()).toMatchObject({ lang: "es-419", iniciada: true, maxAlternatives: 3 });
    expect(boton()).toHaveTextContent("Escuchando");
    expect(screen.getByTestId("dictado-estado")).toHaveTextContent("");
    act(() => voz.ultima().decir("traspaso de 200"));
    expect(alTerminar).toHaveBeenCalledWith(["traspaso de 200"]);
  });

  it("si tampoco existe es-419, lo dice", async () => {
    const { alTerminar } = pantalla();
    await userEvent.click(boton());
    act(() => voz.ultima().fallar("language-not-supported"));
    act(() => voz.ultima().fallar("language-not-supported"));
    expect(screen.getByTestId("dictado-estado")).toHaveTextContent("Tu navegador no sabe dictar en español.");
    expect(alTerminar).not.toHaveBeenCalled();
  });

  const errores: [string, string][] = [
    ["not-allowed", "No tengo permiso para usar el micrófono"],
    ["service-not-allowed", "No tengo permiso para usar el micrófono"],
    ["audio-capture", "No encontré un micrófono"],
    ["network", "El servicio de voz de tu navegador no responde"],
    ["no-speech", "No te escuché"],
    ["algo-raro", "No pude dictar"],
  ];
  for (const [codigo, texto] of errores) {
    it(`error «${codigo}»: se explica y no se entrega nada`, async () => {
      const { alTerminar } = pantalla();
      await userEvent.click(boton());
      act(() => voz.ultima().fallar(codigo));
      expect(screen.getByTestId("dictado-estado")).toHaveTextContent(texto);
      expect(alTerminar).not.toHaveBeenCalled();
      expect(boton()).toBeEnabled();
      expect(boton()).toHaveTextContent("Dictar movimiento");
    });
  }

  it("terminar sin decir nada: «No te escuché»", async () => {
    const { alTerminar } = pantalla();
    await userEvent.click(boton());
    act(() => voz.ultima().silencio());
    expect(screen.getByTestId("dictado-estado")).toHaveTextContent("No te escuché");
    expect(alTerminar).not.toHaveBeenCalled();
  });

  it("si el navegador no deja iniciar, lo dice y no se queda «escuchando»", async () => {
    const { alTerminar } = pantalla();
    const { VozFalsa } = await import("../../test/vozFalsa");
    VozFalsa.fallaAlIniciar = new Error("InvalidStateError");
    await userEvent.click(boton());
    expect(screen.getByTestId("dictado-estado")).toHaveTextContent("No pude dictar");
    expect(boton()).toHaveTextContent("Dictar movimiento");
    expect(alTerminar).not.toHaveBeenCalled();
  });

  it("al salir de la pantalla se corta el micrófono y no se entrega nada", async () => {
    const { alTerminar, unmount } = pantalla();
    await userEvent.click(boton());
    const v = voz.ultima();
    unmount();
    expect(v.abortada).toBe(true);
    expect(v.onresult).toBeNull();
    expect(alTerminar).not.toHaveBeenCalled();
  });

  it("si se pierde la conexión mientras escucha, se corta", async () => {
    const { alTerminar } = pantalla();
    await userEvent.click(boton());
    const v = voz.ultima();
    enLinea.mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(v.abortada).toBe(true);
    expect(boton()).toBeDisabled();
    expect(alTerminar).not.toHaveBeenCalled();
  });

  it("el mensaje del último dictado se anuncia en una región aria-live", () => {
    pantalla(vi.fn(), true, "Dictado aplicado: 3 campos rellenados, 1 por revisar.");
    const estado = screen.getByTestId("dictado-estado");
    expect(estado).toHaveAttribute("role", "status");
    expect(estado).toHaveAttribute("aria-live", "polite");
    expect(estado).toHaveTextContent("3 campos rellenados, 1 por revisar");
  });
});

describe("nada se guarda en el aparato", () => {
  it("tras dictar no hay nada en localStorage ni en sessionStorage", async () => {
    pantalla();
    await userEvent.click(boton());
    act(() => voz.ultima().decir("retiro de cien con cincuenta de la caja"));
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
