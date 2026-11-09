import { useAuth } from "../auth/AuthContext";
import { etiquetaVisibilidad, textoPrivados, visibilidadDe, type ConVisibilidad } from "./visibilidad";

/** Candado con texto ("Solo tú", "Compartido con 2", "Compartido por Ana"); nada para lo de la familia. */
export function EtiquetaPrivacidad({ registro }: { registro: ConVisibilidad }) {
  const { usuario } = useAuth();
  const texto = etiquetaVisibilidad(registro, usuario);
  if (!texto) return null;
  return (
    <span
      data-testid="etiqueta-privacidad"
      data-visibilidad={visibilidadDe(registro)}
      className="inline-flex items-center gap-1 text-xs font-semibold text-arca bg-arca-claro rounded-full px-2 py-0.5"
    >
      <span aria-hidden>🔒</span>
      {texto}
    </span>
  );
}

/** "Incluye tus N registros privados": solo si hay (los totales ya los cuentan). */
export function NotaPrivados({ n, className = "" }: { n: number | undefined | null; className?: string }) {
  const texto = textoPrivados(n);
  if (!texto) return null;
  return (
    <p data-testid="nota-privados" className={`text-xs font-medium flex items-center gap-1 ${className}`}>
      <span aria-hidden>🔒</span>
      {texto}
    </p>
  );
}
