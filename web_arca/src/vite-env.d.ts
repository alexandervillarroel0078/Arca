/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL del backend (sin barra final). Obligatoria al compilar para produccion. */
  readonly VITE_API_URL?: string;
  /** Identificador de la compilacion (se muestra en el login; ayuda a saber que version tiene cada persona). */
  readonly VITE_BUILD_ID?: string;
}
