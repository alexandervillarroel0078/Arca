from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class Categoria(Base):
    __tablename__ = "categorias"

    id: Mapped[int] = mapped_column(primary_key=True)
    familia_id: Mapped[int] = mapped_column(ForeignKey("familias.id", ondelete="CASCADE"), index=True)
    nombre: Mapped[str] = mapped_column(String(60))
    icono: Mapped[str] = mapped_column(String(40), default="tag")
    activa: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
