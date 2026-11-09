from pydantic import BaseModel, ConfigDict, Field


class CategoriaCrear(BaseModel):
    nombre: str = Field(min_length=1, max_length=60)
    icono: str = Field(default="tag", max_length=40)


class CategoriaEditar(BaseModel):
    nombre: str | None = Field(default=None, min_length=1, max_length=60)
    icono: str | None = Field(default=None, max_length=40)
    activa: bool | None = None


class CategoriaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nombre: str
    icono: str
    activa: bool
