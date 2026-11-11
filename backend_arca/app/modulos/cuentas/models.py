"""Cuentas (bancos, cripto y efectivo de la familia) y sus movimientos. NO son ingresos, gastos ni apoyos: ningun
reporte, periodo ni apoyo las lee.

Dinero: Numeric(24,8) siempre; cuantos decimales admite cada moneda se valida en `monedas.py`. El saldo NUNCA se guarda:
se calcula (saldo_inicial + movimientos activos). Nunca se guardan numeros completos de cuenta, claves ni frases semilla.
"""
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint, Date, DateTime, ForeignKey, ForeignKeyConstraint, Index, Numeric, String, UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.anulable import Anulable
from app.core.db import Base
from app.modulos.visibilidad.models import CHECK_VISIBILIDAD, ConVisibilidad

DINERO = Numeric(24, 8)


class Cuenta(ConVisibilidad, Anulable, Base):
    __tablename__ = "cuentas"
    __table_args__ = (
        UniqueConstraint("id", "moneda", name="uq_cuenta_id_moneda"),  # blanco de las FK compuestas de los traspasos
        CheckConstraint("tipo in ('ahorro','corriente','cripto','efectivo')", name="ck_cuenta_tipo"),
        CheckConstraint("moneda in ('BS','USD','USDT','BTC')", name="ck_cuenta_moneda"),
        CheckConstraint(
            "(tipo = 'cripto' and moneda in ('USDT','BTC')) or (tipo <> 'cripto' and moneda in ('BS','USD'))",
            name="ck_cuenta_matriz",
        ),
        CheckConstraint(
            "tipo <> 'efectivo' or (banco is null and banco_otro is null and ultimos4 is null)", name="ck_cuenta_efectivo"
        ),
        CheckConstraint("ultimos4 is null or ultimos4 ~ '^[0-9]{4}$'", name="ck_cuenta_ultimos4"),
        CheckConstraint("banco_otro is null or banco = 'Otro'", name="ck_cuenta_banco_otro"),
        CheckConstraint("saldo_inicial >= 0", name="ck_cuenta_saldo_inicial"),
        CheckConstraint(CHECK_VISIBILIDAD, name="ck_cuenta_visibilidad"),
        Index("ix_cuentas_usuario", "usuario_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    familia_id: Mapped[int] = mapped_column(ForeignKey("familias.id", ondelete="CASCADE"), index=True)
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuarios.id"))  # dueno: quien la creo
    encargado_id: Mapped[int | None] = mapped_column(ForeignKey("usuarios.id"), nullable=True)
    nombre: Mapped[str] = mapped_column(String(80))
    tipo: Mapped[str] = mapped_column(String(10))  # ahorro | corriente | cripto | efectivo
    banco: Mapped[str | None] = mapped_column(String(60), nullable=True)  # banco o plataforma ('Otro' = ver banco_otro)
    banco_otro: Mapped[str | None] = mapped_column(String(60), nullable=True)
    moneda: Mapped[str] = mapped_column(String(4))  # BS | USD | USDT | BTC
    ultimos4: Mapped[str | None] = mapped_column(String(4), nullable=True)  # JAMAS el numero completo
    saldo_inicial: Mapped[Decimal] = mapped_column(DINERO, default=0, server_default="0")
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CuentaMovimiento(Anulable, Base):
    """Deposito, retiro, traspaso (UNA fila: sale de `cuenta_id` y entra en `cuenta_destino_id`) o ajuste por conteo.

    Hereda la visibilidad de su cuenta (de las dos, en un traspaso). `moneda` esta denormalizada para que las FK
    compuestas garanticen en la base que un traspaso solo une cuentas de la misma moneda."""

    __tablename__ = "cuenta_movimientos"
    __table_args__ = (
        ForeignKeyConstraint(["cuenta_id", "moneda"], ["cuentas.id", "cuentas.moneda"], name="fk_cmov_cuenta_moneda"),
        ForeignKeyConstraint(
            ["cuenta_destino_id", "moneda"], ["cuentas.id", "cuentas.moneda"], name="fk_cmov_destino_moneda"
        ),
        CheckConstraint("tipo in ('deposito','retiro','traspaso','ajuste')", name="ck_cmov_tipo"),
        CheckConstraint("monto > 0", name="ck_cmov_monto"),
        CheckConstraint("comision is null or (tipo = 'retiro' and comision >= 0)", name="ck_cmov_comision"),
        CheckConstraint("(tipo = 'traspaso') = (cuenta_destino_id is not null)", name="ck_cmov_traspaso"),
        CheckConstraint("cuenta_destino_id is null or cuenta_destino_id <> cuenta_id", name="ck_cmov_distintas"),
        CheckConstraint(
            "(tipo = 'ajuste') = (sentido is not null) and (tipo = 'ajuste') = (saldo_previo is not null) "
            "and (tipo = 'ajuste') = (saldo_declarado is not null)",
            name="ck_cmov_ajuste",
        ),
        CheckConstraint("sentido is null or sentido in ('entrada','salida')", name="ck_cmov_sentido"),
        CheckConstraint("persona_tipo in ('miembro','otra','sin_identificar')", name="ck_cmov_persona_tipo"),
        CheckConstraint(
            "(persona_tipo = 'miembro' and persona_usuario_id is not null and persona_nombre is null) "
            "or (persona_tipo = 'otra' and persona_usuario_id is null and persona_nombre is not null) "
            "or (persona_tipo = 'sin_identificar' and persona_usuario_id is null and persona_nombre is null)",
            name="ck_cmov_persona",
        ),
        Index("ix_cmov_cuenta_fecha", "cuenta_id", "fecha"),
        Index("ix_cmov_destino", "cuenta_destino_id"),
        Index("ix_cmov_familia_fecha", "familia_id", "fecha"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    familia_id: Mapped[int] = mapped_column(ForeignKey("familias.id", ondelete="CASCADE"))
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuarios.id"))  # quien lo registro
    cuenta_id: Mapped[int] = mapped_column()
    cuenta_destino_id: Mapped[int | None] = mapped_column(nullable=True)
    moneda: Mapped[str] = mapped_column(String(4))
    tipo: Mapped[str] = mapped_column(String(10))
    monto: Mapped[Decimal] = mapped_column(DINERO)  # siempre positivo; el efecto lo da el tipo (y `sentido` en ajustes)
    comision: Mapped[Decimal | None] = mapped_column(DINERO, nullable=True)  # comision de red: se descuenta ademas del monto
    sentido: Mapped[str | None] = mapped_column(String(7), nullable=True)  # solo ajuste: entrada | salida
    saldo_previo: Mapped[Decimal | None] = mapped_column(DINERO, nullable=True)  # solo ajuste
    saldo_declarado: Mapped[Decimal | None] = mapped_column(DINERO, nullable=True)  # solo ajuste
    fecha: Mapped[date] = mapped_column(Date)
    nota: Mapped[str | None] = mapped_column(String(500), nullable=True)
    persona_tipo: Mapped[str] = mapped_column(String(15), default="sin_identificar", server_default="sin_identificar")
    persona_usuario_id: Mapped[int | None] = mapped_column(ForeignKey("usuarios.id"), nullable=True)
    persona_nombre: Mapped[str | None] = mapped_column(String(80), nullable=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
