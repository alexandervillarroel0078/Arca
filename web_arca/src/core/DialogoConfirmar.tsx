import { useState, type ReactNode } from "react";
import { useAviso } from "./Aviso";
import { Fondo } from "./DialogoAnular";
import { Boton } from "./ui";

export interface PedidoConfirmar {
  titulo: string; // "Marcar consumido"
  mensaje: string; // la pregunta y lo que pasara
  /** Lo que se hace al confirmar. Si falla con un error, se avisa (el dialogo ya se cerro). */
  ejecutar: () => void | Promise<unknown>;
}

/**
 * Confirmacion de una accion que no se deshace facil (reemplaza al `window.confirm` del navegador).
 * El foco empieza en "Cancelar" (un Enter distraido no ejecuta nada), Escape o tocar el fondo cancelan.
 * Al confirmar se cierra primero y luego se ejecuta: asi, si la accion abre otro dialogo, el foco no se pelea.
 */
export default function DialogoConfirmar({ pedido, alCerrar }: { pedido: PedidoConfirmar; alCerrar: () => void }) {
  const avisar = useAviso();

  function confirmar() {
    alCerrar();
    void Promise.resolve()
      .then(pedido.ejecutar)
      .catch((e: Error) => avisar(e.message, "error"));
  }

  return (
    <Fondo alCerrar={alCerrar}>
      <div role="dialog" aria-modal="true" aria-label={pedido.titulo} className="bg-white rounded-tarjeta p-5 w-full max-w-[400px] max-h-[calc(100dvh-2rem)] overflow-y-auto space-y-3">
        <h2 className="font-titulo text-xl font-bold">{pedido.titulo}</h2>
        <p className="text-stone-700" data-testid="mensaje-confirmar">{pedido.mensaje}</p>
        <div className="grid grid-cols-2 gap-2">
          <Boton variante="suave" onClick={alCerrar} data-autofoco="">Cancelar</Boton>
          <Boton onClick={confirmar}>Confirmar</Boton>
        </div>
      </div>
    </Fondo>
  );
}

/** Estado del dialogo de confirmacion: `confirmar(pedido)` lo abre y `dialogo` va una vez en la pantalla. */
export function useConfirmar(): { confirmar: (p: PedidoConfirmar) => void; dialogo: ReactNode } {
  const [pedido, setPedido] = useState<PedidoConfirmar | null>(null);
  return {
    confirmar: setPedido,
    dialogo: pedido ? <DialogoConfirmar pedido={pedido} alCerrar={() => setPedido(null)} /> : null,
  };
}
