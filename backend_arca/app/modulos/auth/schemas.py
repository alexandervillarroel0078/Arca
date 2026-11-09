from pydantic import BaseModel, EmailStr, Field


class RegistroIn(BaseModel):
    nombre: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)
    nombre_familia: str | None = Field(default=None, max_length=120)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class PerfilIn(BaseModel):
    nombre: str = Field(min_length=1, max_length=120)


class CambiarClaveIn(BaseModel):
    clave_actual: str
    clave_nueva: str = Field(min_length=8, max_length=72)


class YoOut(BaseModel):
    id: int
    nombre: str
    email: str
    familia_id: int
    familia_nombre: str
    rol: str
    visibilidad_defecto: str = "familia"  # Fase 17: lo que heredan tus registros nuevos
    dia_inicio_mes: int = 1  # Fase 16: desde que dia empieza el "mes" de los periodos


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    usuario: YoOut
