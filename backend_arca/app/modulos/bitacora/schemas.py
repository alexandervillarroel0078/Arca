from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class BitacoraItem(BaseModel):
    clave: str  # "acceso-12" | "datos-30": unica entre los dos origenes
    origen: Literal["acceso", "datos"]
    evento: str  # acceso: evento de la bitacora; datos: accion del historial
    etiqueta: str  # texto corto del chip ("Anulado", "Entrada fallida")
    titulo: str  # frase legible ("Anulo gasto Transporte Bs 50.00")
    resultado: Literal["ok", "fallo"]
    fecha: datetime  # cuando quedo registrado en el servidor (UTC)
    fecha_real: datetime  # cuando ocurrio la accion (si se hizo sin internet, la del aparato del usuario)
    fecha_sincronizacion: datetime | None = None  # solo si se hizo sin internet: cuando llego al servidor
    usuario_id: int | None = None
    usuario_nombre: str | None = None
    correo_intentado: str | None = None
    ip: str | None = None
    dispositivo: str | None = None
    detalle: list[str] = []  # lineas legibles ("Monto: Bs 45.00 -> Bs 60.00")
    motivo: str | None = None
    entidad: str | None = None
    entidad_id: int | None = None


class BitacoraPagina(BaseModel):
    items: list[BitacoraItem]
    hay_mas: bool
    siguiente: str | None = None  # cursor opaco para la pagina siguiente


class UltimoAcceso(BaseModel):
    usuario_id: int
    nombre: str
    rol: str
    activo: bool
    ultimo_login: datetime | None
    ip: str | None
    dispositivo: str | None


class FalloUsuario(BaseModel):
    usuario_id: int
    nombre: str
    fallos: int


class NovedadAcceso(BaseModel):
    usuario_id: int
    nombre: str
    tipo: Literal["ip", "dispositivo"]
    valor: str
    primera_vez: datetime


class ResumenBitacora(BaseModel):
    ultimos_accesos: list[UltimoAcceso]
    fallos_login_7d: int
    bloqueos_login_7d: int
    fallos_por_usuario: list[FalloUsuario]
    novedades: list[NovedadAcceso]  # IP o dispositivos que un usuario uso por primera vez en los ultimos 7 dias
