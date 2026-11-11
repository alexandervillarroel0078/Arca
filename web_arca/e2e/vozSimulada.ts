// SpeechRecognition SIMULADO para las E2E del dictado. El reconocimiento real depende del navegador y de un servicio externo,
// así que aquí se imita su orden de eventos (resultado final y luego `end`) para probar la pantalla, no el servicio de voz.
import type { Page } from "@playwright/test";

/** Instala un reconocedor falso en TODAS las páginas que abra `page` (también tras recargar). */
export async function instalarVoz(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.__voz = { instancias: [] as any[] };
    class VozFalsa {
      lang = "";
      continuous = true;
      interimResults = false;
      maxAlternatives = 1;
      onresult: any = null;
      onerror: any = null;
      onend: any = null;
      iniciada = false;
      abortada = false;
      constructor() {
        w.__voz.instancias.push(this);
      }
      start() {
        this.iniciada = true;
      }
      stop() {
        this.onend?.();
      }
      abort() {
        this.abortada = true;
      }
    }
    for (const n of ["SpeechRecognition", "webkitSpeechRecognition"]) Object.defineProperty(window, n, { value: VozFalsa, configurable: true, writable: true });
  });
}

/** El navegador NO ofrece reconocimiento de voz (como Firefox). */
export async function sinVoz(page: Page) {
  await page.addInitScript(() => {
    for (const n of ["SpeechRecognition", "webkitSpeechRecognition"]) Object.defineProperty(window, n, { value: undefined, configurable: true, writable: true });
  });
}

/** El usuario habla: llega el resultado final con estas alternativas y el reconocedor se cierra. */
export async function decir(page: Page, ...alternativas: string[]) {
  await page.evaluate((alts) => {
    const v = (window as any).__voz.instancias.at(-1);
    const res: any = { isFinal: true, length: alts.length };
    alts.forEach((a, i) => (res[i] = { transcript: a }));
    v.onresult?.({ results: { length: 1, 0: res } });
    v.onend?.();
  }, alternativas);
}

/** El servicio de voz falla (`not-allowed`, `network`, `no-speech`, `language-not-supported`...). */
export async function fallarVoz(page: Page, codigo: string) {
  await page.evaluate((c) => {
    const v = (window as any).__voz.instancias.at(-1);
    v.onerror?.({ error: c });
    v.onend?.();
  }, codigo);
}

/** Idiomas con los que se creó cada reconocedor, en orden. */
export const idiomasUsados = (page: Page) => page.evaluate(() => (window as any).__voz.instancias.map((v: any) => v.lang as string));
