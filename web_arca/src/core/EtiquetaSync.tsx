/**
 * Estado de sincronizacion de un registro, como pildora con icono y texto (nunca solo color):
 *  - "sin enviar": cambio hecho en el telefono que aun no llego al servidor;
 *  - "en conflicto": ese cambio choco con otro y espera una decision.
 * Un registro ya sincronizado no muestra nada. Colores con contraste AA (8.5:1 y 7.6:1 aprox.).
 */
export function EtiquetaSync({ sinSincronizar, enConflicto }: { sinSincronizar?: boolean; enConflicto?: boolean }) {
  if (!sinSincronizar && !enConflicto) return null;
  return (
    <>
      {sinSincronizar && (
        <span
          data-testid="etiqueta-sin-enviar"
          className="inline-flex items-center rounded-full border border-apoyo/40 bg-apoyo-claro px-2.5 py-0.5 text-xs font-bold text-apoyo-texto whitespace-nowrap"
        >
          ⏳ sin enviar
        </span>
      )}
      {enConflicto && (
        <span
          data-testid="etiqueta-en-conflicto"
          className="inline-flex items-center rounded-full border border-red-300 bg-red-50 px-2.5 py-0.5 text-xs font-bold text-red-800 whitespace-nowrap"
        >
          ⚠ en conflicto
        </span>
      )}
    </>
  );
}
