import { useState } from "react";
import { useAviso } from "./Aviso";
import DialogoAnular, { type PedidoAnular } from "./DialogoAnular";

interface Opciones {
  titulo: string; // "Anular gasto"
  detalle: string; // nombre y monto
  advertencia?: string;
  anular: (motivo: string) => Promise<unknown>;
  reactivar: () => Promise<unknown>;
}

/** Flujo comun de anulacion: dialogo de confirmacion -> aviso "Anulado. Reactivar". */
export function useAnular(alCambiar: () => void) {
  const avisar = useAviso();
  const [pedido, setPedido] = useState<PedidoAnular | null>(null);

  async function reactivarAhora(reactivar: () => Promise<unknown>) {
    try {
      await reactivar();
      avisar("Reactivado");
    } catch (e) {
      avisar((e as Error).message, "error");
    }
    alCambiar();
  }

  function pedirAnular(o: Opciones) {
    setPedido({
      titulo: o.titulo,
      detalle: o.detalle,
      advertencia: o.advertencia,
      ejecutar: async (motivo) => {
        await o.anular(motivo);
        alCambiar();
        avisar("Anulado", "ok", { texto: "Reactivar", alAccionar: () => reactivarAhora(o.reactivar) });
      },
    });
  }

  const dialogo = pedido ? <DialogoAnular pedido={pedido} alCerrar={() => setPedido(null)} /> : null;
  return { pedirAnular, reactivarAhora, dialogo };
}
