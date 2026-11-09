from datetime import date
from typing import Literal

from pydantic import BaseModel

from app.core.anulable import AuditoriaOut
from app.core.tipos import Monto


class ActividadItem(AuditoriaOut):
    """Una fila de la lista completa: un movimiento (gasto/ingreso) o un apoyo."""

    clase: Literal["movimiento", "apoyo"]
    id: int
    tipo: Literal["gasto", "ingreso", "apoyo"]
    titulo: str
    monto: Monto
    fecha: date
    nota: str | None
    usuario_id: int
    usuario_nombre: str
    visibilidad: str = "familia"
    compartido_con: list[int] = []  # solo lo ve el dueno
    categoria_id: int | None = None
    categoria_nombre: str | None = None
    categoria_icono: str | None = None
    beneficiario: str | None = None
    estado: str | None = None  # solo apoyos
    pendiente: Monto | None = None  # solo apoyos
    devuelto: Monto | None = None  # solo apoyos
    consumido: Monto | None = None  # solo apoyos
    devoluciones_activas: int | None = None  # solo apoyos


class ActividadPagina(BaseModel):
    items: list[ActividadItem]
    total: int
    hay_mas: bool
