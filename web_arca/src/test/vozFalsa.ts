// Reconocedor de voz FALSO para las pruebas (Vitest). Imita el orden de eventos de Chrome: resultados, y luego `end`.
import type { Reconocedor } from "../modulos/cuentas/dictadoVoz";

export class VozFalsa implements Reconocedor {
  static instancias: VozFalsa[] = [];
  /** Si no es null, `start()` lanza esta excepción (como un reconocedor ya iniciado). */
  static fallaAlIniciar: Error | null = null;

  lang = "";
  continuous = true;
  interimResults = false;
  maxAlternatives = 1;
  onresult: Reconocedor["onresult"] = null;
  onerror: Reconocedor["onerror"] = null;
  onend: Reconocedor["onend"] = null;
  iniciada = false;
  abortada = false;
  detenida = false;

  constructor() {
    VozFalsa.instancias.push(this);
  }
  start() {
    if (VozFalsa.fallaAlIniciar) throw VozFalsa.fallaAlIniciar;
    this.iniciada = true;
  }
  stop() {
    this.detenida = true;
    this.onend?.();
  }
  abort() {
    this.abortada = true;
  }

  /** Lo que se va entendiendo (no es el resultado final). */
  parcial(texto: string) {
    this.onresult?.({ results: { length: 1, 0: { isFinal: false, length: 1, 0: { transcript: texto } } } });
  }
  /** El usuario terminó de hablar: llega el resultado final con sus alternativas y se cierra. */
  decir(...alternativas: string[]) {
    const res: Record<number, { transcript: string }> & { isFinal: boolean; length: number } = { isFinal: true, length: alternativas.length };
    alternativas.forEach((a, i) => (res[i] = { transcript: a }));
    this.onresult?.({ results: { length: 1, 0: res } });
    this.onend?.();
  }
  /** Un error del servicio de voz (`not-allowed`, `network`, `no-speech`, `language-not-supported`...) y se cierra. */
  fallar(error: string) {
    this.onerror?.({ error });
    this.onend?.();
  }
  /** Se cierra sin entender nada. */
  silencio() {
    this.onend?.();
  }
}

type VentanaVoz = { webkitSpeechRecognition?: unknown; SpeechRecognition?: unknown };

/** Instala la voz falsa como `webkitSpeechRecognition`. Devuelve la última instancia creada y cómo quitarla. */
export function instalarVozFalsa() {
  VozFalsa.instancias = [];
  VozFalsa.fallaAlIniciar = null;
  (window as unknown as VentanaVoz).webkitSpeechRecognition = VozFalsa;
  return {
    ultima: () => VozFalsa.instancias[VozFalsa.instancias.length - 1],
    todas: () => VozFalsa.instancias,
    quitar: quitarVozFalsa,
  };
}

export function quitarVozFalsa() {
  delete (window as unknown as VentanaVoz).webkitSpeechRecognition;
  delete (window as unknown as VentanaVoz).SpeechRecognition;
  VozFalsa.instancias = [];
  VozFalsa.fallaAlIniciar = null;
}
