from typing import Literal

from pydantic import BaseModel, EmailStr, Field


class InvitarIn(BaseModel):
    """El admin crea la cuenta del nuevo miembro con una clave temporal."""

    nombre: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)
    rol: Literal["admin", "miembro"] = "miembro"


class FamiliaOut(BaseModel):
    id: int
    nombre: str
    dia_inicio_mes: int


class FamiliaEditar(BaseModel):
    dia_inicio_mes: int = Field(ge=1, le=28)


class MiembroEditar(BaseModel):
    rol: Literal["admin", "miembro"] | None = None
    activo: bool | None = None


class MiembroOut(BaseModel):
    usuario_id: int
    nombre: str
    email: str
    rol: str
    activo: bool = True


class ClaveTemporalOut(BaseModel):
    clave_temporal: str
