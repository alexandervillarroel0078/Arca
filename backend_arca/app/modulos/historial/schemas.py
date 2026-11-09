from datetime import datetime
from typing import Any

from pydantic import BaseModel


class HistorialItem(BaseModel):
    id: int
    entidad: str
    entidad_id: int
    accion: str
    usuario_id: int
    usuario_nombre: str
    fecha: datetime  # cuando se sincronizo (la hora del servidor)
    fecha_cliente: datetime | None = None  # cuando el usuario hizo la accion (si la hizo sin internet puede ser mucho antes)
    # campo -> {"antes": x, "despues": y}; en cambios de clave solo {"clave": "clave cambiada"}
    cambios: dict[str, Any]
    motivo: str | None
    etiqueta: str | None  # nombre legible del registro ("Gasto: Almuerzo (Bs 45.00)")


class HistorialPagina(BaseModel):
    items: list[HistorialItem]
    total: int
    hay_mas: bool
