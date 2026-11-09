"""Configuracion de la aplicacion: SOLO variables de entorno.

En desarrollo se puede usar un archivo `.env` (opcional, nunca se versiona); en produccion todo viene del entorno
del servicio. Variables: DATABASE_URL, JWT_SECRET, CORS_ORIGENES, ENTORNO, REGISTRO_ABIERTO (+ JWT_EXPIRA_MINUTOS).
"""
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

RAIZ = Path(__file__).resolve().parents[2]
ARCHIVO_ENV = RAIZ / ".env"  # opcional: solo para desarrollo

ENTORNOS_PRODUCCION = ("produccion", "producción", "prod", "production")
# Valores de ejemplo que NUNCA sirven como secreto real (estan en el repositorio o en tutoriales).
SECRETOS_DE_EJEMPLO = {
    "dev-secreto-cambiar", "cambiar-por-un-secreto-largo", "un-secreto-largo", "secret", "secreto", "changeme", "change-me",
}
LARGO_MINIMO_SECRETO = 32


class ConfiguracionInvalida(RuntimeError):
    """La configuracion no es segura para produccion: la app no arranca."""


def normalizar_url_base(url: str) -> str:
    """Neon/Render entregan `postgres://` o `postgresql://`; SQLAlchemy 2 necesita un dialecto valido.
    `?sslmode=require` (y demas parametros de libpq) se conservan tal cual: psycopg2 los entiende."""
    url = url.strip()
    if url.startswith("postgres://"):
        return "postgresql://" + url[len("postgres://"):]
    return url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(ARCHIVO_ENV) if ARCHIVO_ENV.exists() else None, extra="ignore")

    entorno: str = "desarrollo"  # 'produccion' endurece la app (ver validar_produccion)
    database_url: str = "postgresql+psycopg2://postgres:CAMBIAR@localhost:5432/arca2"
    test_database_url: str = "postgresql+psycopg2://postgres:CAMBIAR@localhost:5432/arca_test"  # solo pruebas
    jwt_secret: str = "dev-secreto-cambiar"
    jwt_expira_minutos: int = 1440
    cors_origenes: str = "http://localhost:5173"  # lista separada por comas
    # None = segun el entorno: abierto en desarrollo, cerrado en produccion
    registro_abierto: bool | None = None

    @field_validator("database_url", "test_database_url")
    @classmethod
    def _url(cls, v: str) -> str:
        return normalizar_url_base(v)

    @property
    def es_produccion(self) -> bool:
        return self.entorno.strip().lower() in ENTORNOS_PRODUCCION

    @property
    def registro_esta_abierto(self) -> bool:
        return self.registro_abierto if self.registro_abierto is not None else not self.es_produccion

    @property
    def origenes_cors(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.cors_origenes.split(",") if o.strip()]


def validar_produccion(s: Settings) -> None:
    """Con ENTORNO=produccion la app NO arranca con una configuracion insegura o incompleta."""
    if not s.es_produccion:
        return
    problemas: list[str] = []
    secreto = (s.jwt_secret or "").strip()
    if "jwt_secret" not in s.model_fields_set or not secreto:
        problemas.append("JWT_SECRET no esta definido")
    elif secreto.lower() in SECRETOS_DE_EJEMPLO or "cambiar" in secreto.lower() or "changeme" in secreto.lower():
        problemas.append("JWT_SECRET es un valor de ejemplo")
    elif len(secreto) < LARGO_MINIMO_SECRETO:
        problemas.append(f"JWT_SECRET tiene {len(secreto)} caracteres (minimo {LARGO_MINIMO_SECRETO})")
    if "database_url" not in s.model_fields_set or "CAMBIAR" in s.database_url:
        problemas.append("DATABASE_URL no esta definido")
    if "cors_origenes" not in s.model_fields_set or not s.origenes_cors:
        problemas.append("CORS_ORIGENES no esta definido (lista separada por comas con la URL del frontend)")
    elif "*" in s.origenes_cors:
        problemas.append("CORS_ORIGENES no puede ser '*'")
    if problemas:
        raise ConfiguracionInvalida(
            "Configuracion insegura para ENTORNO=produccion: " + "; ".join(problemas)
            + ". Genera un secreto con: python -c \"import secrets; print(secrets.token_urlsafe(48))\""
        )


settings = Settings()
validar_produccion(settings)  # se ejecuta al importar: si falla, la app no arranca


# En desarrollo se aceptan correos de dominios reservados como @arca.test (usados por el seed).
if not settings.es_produccion:
    import email_validator

    email_validator.TEST_ENVIRONMENT = True
