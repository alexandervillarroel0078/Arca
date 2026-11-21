import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { bs, fechaCorta } from "../../core/formato";
import { usePorConfirmar } from "../cuentas/porConfirmar";
import { marcarRechazoVisto, rechazosVistos } from "../cuentas/recordar";

/**
 * Aviso al autor: el dueño de la cuenta rechazó su pago con banco y el registro pasó a Efectivo (no se anuló). Ofrece
 * "Cambiar fuente" (abre el registro con la hoja de fuente) o "Entendido". Se lee al abrir la app; cerrarlo lo recuerda
 * (solo el id) para no repetirlo.
 */
export default function AvisoRechazo() {
  const { rechazos } = usePorConfirmar();
  const navegar = useNavigate();
  const [vistos, setVistos] = useState<number[]>(() => rechazosVistos());
  const r = rechazos.find((x) => !vistos.includes(x.id));
  if (!r) return null;

  const cerrar = () => {
    marcarRechazoVisto(r.id);
    setVistos((v) => [...v, r.id]);
  };
  const que = r.origen_tipo === "apoyo" ? "tu apoyo" : r.origen_tipo === "ingreso" ? "tu ingreso" : "tu gasto";
  return (
    <div role="alert" data-testid="aviso-rechazo" className="mb-3 rounded-tarjeta border border-red-200 bg-red-50 p-3 space-y-2">
      <p className="text-sm font-medium text-red-900">
        <span aria-hidden>↩ </span>
        {r.rechazado_por_nombre} rechazó el pago con {r.cuenta_nombre} de {que} de {bs(Number(r.monto))} ({fechaCorta(r.fecha)}).
        Quedó en efectivo.{r.motivo ? ` Motivo: ${r.motivo}` : ""}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={cerrar} className="min-h-[44px] rounded-campo border-[1.5px] border-stone-300 bg-white font-semibold active:bg-stone-100">
          Entendido
        </button>
        <button
          type="button"
          onClick={() => {
            cerrar();
            navegar(`/editar/${r.origen_clase}/${r.origen_id}`, { state: { cambiarFuente: true } });
          }}
          className="min-h-[44px] rounded-campo bg-arca font-semibold text-white active:bg-arca-oscuro"
        >
          Cambiar fuente
        </button>
      </div>
    </div>
  );
}
