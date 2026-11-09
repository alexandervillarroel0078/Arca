// Pantalla del chip "Rango": dos campos de fecha (desde y hasta, inclusivos).
import { useState } from "react";
import Encabezado, { AccionFija, useVolver } from "./Encabezado";
import { usePeriodo } from "./PeriodoContext";
import { Boton, Campo, claseInput } from "./ui";

export default function PaginaRango() {
  const { periodo, elegirRango } = usePeriodo();
  const volver = useVolver("/");
  const [desde, setDesde] = useState(periodo.desde);
  const [hasta, setHasta] = useState(periodo.hasta);
  const [intento, setIntento] = useState(false);

  const error = !desde || !hasta ? "Elige las dos fechas" : desde > hasta ? "La fecha desde no puede ser posterior a la fecha hasta" : null;

  function aplicar() {
    setIntento(true);
    if (error) return;
    elegirRango(desde, hasta);
    volver();
  }

  return (
    <div className="space-y-4">
      <Encabezado titulo="Rango de fechas" volverA="/" />
      <p className="text-sm text-stone-600">Elige el primer y el último día. Los dos días cuentan.</p>
      <Campo etiqueta="Desde">
        <input type="date" className={claseInput} value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} />
      </Campo>
      <Campo etiqueta="Hasta" error={intento ? error : null}>
        <input type="date" className={claseInput} value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} />
      </Campo>
      <AccionFija>
        <Boton onClick={aplicar}>Aplicar rango</Boton>
      </AccionFija>
    </div>
  );
}
