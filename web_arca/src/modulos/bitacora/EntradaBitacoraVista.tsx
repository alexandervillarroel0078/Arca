import { fechaHora } from "../../core/tipos";
import type { EntradaBitacora } from "./api";
import { resumenDispositivo } from "./dispositivo";

/** Icono y colores segun origen y resultado (siempre van acompanados de texto: etiqueta y titulo). */
export function estiloEntrada(e: Pick<EntradaBitacora, "origen" | "resultado">) {
  if (e.resultado === "fallo") return { icono: "⚠️", fondo: "bg-red-50", texto: "text-red-700", tipo: "Acceso · Fallo" };
  if (e.origen === "acceso") return { icono: "🔑", fondo: "bg-arca-claro", texto: "text-arca", tipo: "Acceso" };
  return { icono: "📝", fondo: "bg-stone-100", texto: "text-stone-700", tipo: "Datos" };
}

/** Una linea de la bitacora: que paso, quien, cuando y, en pequeno, desde donde (IP y dispositivo). */
export default function EntradaBitacoraVista({ e }: { e: EntradaBitacora }) {
  const est = estiloEntrada(e);
  const sinConexion = !!e.fecha_sincronizacion;
  const dispositivo = resumenDispositivo(e.dispositivo);
  const desde = [e.ip && `IP ${e.ip}`, dispositivo].filter(Boolean).join(" · ");
  return (
    <li data-testid="entrada-bitacora" data-clave={e.clave} data-origen={e.origen} data-evento={e.evento} data-resultado={e.resultado} className="flex gap-3 py-3">
      <span className={`shrink-0 w-11 h-11 rounded-2xl flex items-center justify-center text-xl ${est.fondo}`} aria-hidden>
        {est.icono}
      </span>
      <div className="min-w-0 flex-1 break-words">
        <p className={`text-xs font-bold uppercase tracking-wide ${est.texto}`}>
          {est.tipo} · {e.etiqueta}
        </p>
        <p className="font-semibold leading-snug">{e.titulo}</p>
        <p className="text-sm text-stone-600">
          {e.usuario_nombre ? `${e.usuario_nombre} · ` : ""}
          {fechaHora(e.fecha_real)}
        </p>
        {sinConexion && (
          <p className="text-xs text-stone-500" data-testid="sincronizado-en">
            Hecho sin conexión · sincronizado {fechaHora(e.fecha_sincronizacion!)}
          </p>
        )}
        {e.motivo && <p className="text-sm text-stone-700">Motivo: {e.motivo}</p>}
        {e.detalle.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-sm text-stone-700 border-l-2 border-stone-200 pl-2">
            {e.detalle.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        )}
        {desde && (
          <p className="text-xs text-stone-500 mt-0.5" title={e.dispositivo ?? undefined} data-testid="origen-acceso">
            {desde}
          </p>
        )}
      </div>
    </li>
  );
}
