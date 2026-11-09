import { useEffect, useRef, useState } from "react";

// Comportamiento comun de dialogos y hojas (una sola logica para todos):
//  - Escape cierra;
//  - al abrir, el foco pasa al primer elemento util (o al propio dialogo) y al cerrar vuelve a quien lo abrio;
//  - Tab y Shift+Tab no salen del dialogo.
// Lo usan `Fondo` (todos los dialogos centrados) y `HojaOpciones` (hojas que suben desde abajo).

const ENFOCABLES =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Elementos a los que se llega con Tab dentro de `raiz` (los de tabindex="-1", como el boton que cubre el fondo, se saltan). */
export function enfocables(raiz: HTMLElement): HTMLElement[] {
  return Array.from(raiz.querySelectorAll<HTMLElement>(ENFOCABLES)).filter(
    (e) => !e.hidden && e.getAttribute("tabindex") !== "-1" && !e.closest('[aria-hidden="true"]'),
  );
}

// Dialogos abiertos, el ultimo es el de encima: solo el atiende el teclado.
const pila: HTMLElement[] = [];

export interface OpcionesDialogo {
  /** Se llama al pulsar Escape. Sin esto Escape no hace nada. */
  alCerrar?: () => void;
  /**
   * "primero": el foco va al primer elemento util (o al que tenga `data-autofoco`).
   * "dialogo": el foco va al dialogo mismo (para no abrir el teclado del telefono de golpe).
   */
  enfoque?: "primero" | "dialogo";
}

/**
 * Pon el `ref` que devuelve en el contenedor del dialogo (el que envuelve al elemento con role="dialog").
 * Un campo que ya tenga el foco al abrir (por `autoFocus`) se respeta.
 */
export function useDialogo<T extends HTMLElement = HTMLDivElement>({ alCerrar, enfoque = "primero" }: OpcionesDialogo = {}) {
  const ref = useRef<T>(null);
  const cerrar = useRef(alCerrar);
  cerrar.current = alCerrar;
  // Quien tenia el foco al abrir. Se lee al RENDERIZAR (antes de montar): un `autoFocus` de adentro mueve el foco al
  // montarse y, si se leyera en el efecto, se recordaria al propio campo del dialogo (que desaparece al cerrar).
  const [abridor] = useState<HTMLElement | null>(() =>
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );

  useEffect(() => {
    const raiz = ref.current;
    if (!raiz) return;
    const dialogo = raiz.querySelector<HTMLElement>('[role="dialog"]') ?? raiz;

    if (!raiz.contains(document.activeElement)) {
      const destino =
        (enfoque === "primero" ? raiz.querySelector<HTMLElement>("[data-autofoco]") ?? enfocables(dialogo)[0] : null) ?? dialogo;
      if (destino === dialogo) {
        if (!dialogo.hasAttribute("tabindex")) dialogo.setAttribute("tabindex", "-1");
        dialogo.style.outline = "none";
      }
      destino.focus({ preventScroll: true });
    }

    function alTeclear(e: KeyboardEvent) {
      if (pila[pila.length - 1] !== raiz) return; // hay otro dialogo encima
      const objetivo = e.target instanceof Element ? e.target : null;
      const interior = objetivo?.closest('[role="dialog"]');
      if (interior && interior !== dialogo) return; // una capa propia dentro de este dialogo maneja su teclado

      if (e.key === "Escape") {
        if (!cerrar.current) return;
        e.preventDefault();
        e.stopPropagation();
        cerrar.current();
        return;
      }
      if (e.key !== "Tab") return;
      const lista = enfocables(dialogo);
      if (lista.length === 0) {
        e.preventDefault();
        dialogo.focus();
        return;
      }
      const primero = lista[0];
      const ultimo = lista[lista.length - 1];
      const activo = document.activeElement;
      if (!dialogo.contains(activo) || activo === dialogo) {
        e.preventDefault();
        (e.shiftKey ? ultimo : primero).focus();
      } else if (e.shiftKey && activo === primero) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && activo === ultimo) {
        e.preventDefault();
        primero.focus();
      }
    }

    pila.push(raiz);
    document.addEventListener("keydown", alTeclear);
    return () => {
      document.removeEventListener("keydown", alTeclear);
      const i = pila.indexOf(raiz);
      if (i >= 0) pila.splice(i, 1);
      if (abridor && abridor.isConnected) abridor.focus({ preventScroll: true }); // vuelve a quien lo abrio
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return ref;
}
