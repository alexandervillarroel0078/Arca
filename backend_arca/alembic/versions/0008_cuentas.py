"""cuentas: cuentas bancarias, cripto y efectivo de la familia y sus movimientos (Cuentas, etapa 2)

- `cuentas`: dueno, encargado opcional, tipo/moneda (matriz validada con CHECK), banco o plataforma, ultimos 4 digitos
  (nunca el numero completo), saldo inicial, visibilidad por cuenta y las columnas de `Anulable` (anular/reactivar,
  version, uuid_cliente). El saldo NO se guarda: se calcula.
- `cuenta_movimientos`: deposito, retiro, traspaso (una sola fila; FK compuestas con la moneda: la base rechaza
  un traspaso entre monedas distintas) y ajuste por conteo. Dinero en Numeric(24,8).
No toca `historial` ni `bitacora` ni sus triggers ni ninguna tabla existente.

Revision ID: 0008
Revises: 0007
"""
from alembic import op
import sqlalchemy as sa

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None

DINERO = sa.Numeric(24, 8)


def _anulable() -> list[sa.Column]:
    return [
        sa.Column("anulado", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("anulado_por", sa.Integer(), sa.ForeignKey("usuarios.id"), nullable=True),
        sa.Column("anulado_en", sa.DateTime(timezone=True), nullable=True),
        sa.Column("motivo_anulacion", sa.String(300), nullable=True),
        sa.Column("editado_por", sa.Integer(), sa.ForeignKey("usuarios.id"), nullable=True),
        sa.Column("editado_en", sa.DateTime(timezone=True), nullable=True),
        sa.Column("uuid_cliente", sa.String(36), nullable=True, unique=True),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "cuentas",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("familia_id", sa.Integer(), sa.ForeignKey("familias.id", ondelete="CASCADE"), nullable=False),
        sa.Column("usuario_id", sa.Integer(), sa.ForeignKey("usuarios.id"), nullable=False),
        sa.Column("encargado_id", sa.Integer(), sa.ForeignKey("usuarios.id"), nullable=True),
        sa.Column("nombre", sa.String(80), nullable=False),
        sa.Column("tipo", sa.String(10), nullable=False),
        sa.Column("banco", sa.String(60), nullable=True),
        sa.Column("banco_otro", sa.String(60), nullable=True),
        sa.Column("moneda", sa.String(4), nullable=False),
        sa.Column("ultimos4", sa.String(4), nullable=True),
        sa.Column("saldo_inicial", DINERO, server_default="0", nullable=False),
        sa.Column("creado_en", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("visibilidad", sa.String(10), server_default="familia", nullable=False),
        *_anulable(),
        sa.UniqueConstraint("id", "moneda", name="uq_cuenta_id_moneda"),
        sa.CheckConstraint("tipo in ('ahorro','corriente','cripto','efectivo')", name="ck_cuenta_tipo"),
        sa.CheckConstraint("moneda in ('BS','USD','USDT','BTC')", name="ck_cuenta_moneda"),
        sa.CheckConstraint(
            "(tipo = 'cripto' and moneda in ('USDT','BTC')) or (tipo <> 'cripto' and moneda in ('BS','USD'))",
            name="ck_cuenta_matriz",
        ),
        sa.CheckConstraint(
            "tipo <> 'efectivo' or (banco is null and banco_otro is null and ultimos4 is null)", name="ck_cuenta_efectivo"
        ),
        sa.CheckConstraint("ultimos4 is null or ultimos4 ~ '^[0-9]{4}$'", name="ck_cuenta_ultimos4"),
        sa.CheckConstraint("banco_otro is null or banco = 'Otro'", name="ck_cuenta_banco_otro"),
        sa.CheckConstraint("saldo_inicial >= 0", name="ck_cuenta_saldo_inicial"),
        sa.CheckConstraint("visibilidad in ('solo_yo','familia','elegidas')", name="ck_cuenta_visibilidad"),
    )
    op.create_index("ix_cuentas_familia_id", "cuentas", ["familia_id"])
    op.create_index("ix_cuentas_usuario", "cuentas", ["usuario_id"])

    op.create_table(
        "cuenta_movimientos",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("familia_id", sa.Integer(), sa.ForeignKey("familias.id", ondelete="CASCADE"), nullable=False),
        sa.Column("usuario_id", sa.Integer(), sa.ForeignKey("usuarios.id"), nullable=False),
        sa.Column("cuenta_id", sa.Integer(), nullable=False),
        sa.Column("cuenta_destino_id", sa.Integer(), nullable=True),
        sa.Column("moneda", sa.String(4), nullable=False),
        sa.Column("tipo", sa.String(10), nullable=False),
        sa.Column("monto", DINERO, nullable=False),
        sa.Column("comision", DINERO, nullable=True),
        sa.Column("sentido", sa.String(7), nullable=True),
        sa.Column("saldo_previo", DINERO, nullable=True),
        sa.Column("saldo_declarado", DINERO, nullable=True),
        sa.Column("fecha", sa.Date(), nullable=False),
        sa.Column("nota", sa.String(500), nullable=True),
        sa.Column("persona_tipo", sa.String(15), server_default="sin_identificar", nullable=False),
        sa.Column("persona_usuario_id", sa.Integer(), sa.ForeignKey("usuarios.id"), nullable=True),
        sa.Column("persona_nombre", sa.String(80), nullable=True),
        sa.Column("creado_en", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        *_anulable(),
        sa.ForeignKeyConstraint(["cuenta_id", "moneda"], ["cuentas.id", "cuentas.moneda"], name="fk_cmov_cuenta_moneda"),
        sa.ForeignKeyConstraint(
            ["cuenta_destino_id", "moneda"], ["cuentas.id", "cuentas.moneda"], name="fk_cmov_destino_moneda"
        ),
        sa.CheckConstraint("tipo in ('deposito','retiro','traspaso','ajuste')", name="ck_cmov_tipo"),
        sa.CheckConstraint("monto > 0", name="ck_cmov_monto"),
        sa.CheckConstraint("comision is null or (tipo = 'retiro' and comision >= 0)", name="ck_cmov_comision"),
        sa.CheckConstraint("(tipo = 'traspaso') = (cuenta_destino_id is not null)", name="ck_cmov_traspaso"),
        sa.CheckConstraint("cuenta_destino_id is null or cuenta_destino_id <> cuenta_id", name="ck_cmov_distintas"),
        sa.CheckConstraint(
            "(tipo = 'ajuste') = (sentido is not null) and (tipo = 'ajuste') = (saldo_previo is not null) "
            "and (tipo = 'ajuste') = (saldo_declarado is not null)",
            name="ck_cmov_ajuste",
        ),
        sa.CheckConstraint("sentido is null or sentido in ('entrada','salida')", name="ck_cmov_sentido"),
        sa.CheckConstraint("persona_tipo in ('miembro','otra','sin_identificar')", name="ck_cmov_persona_tipo"),
        sa.CheckConstraint(
            "(persona_tipo = 'miembro' and persona_usuario_id is not null and persona_nombre is null) "
            "or (persona_tipo = 'otra' and persona_usuario_id is null and persona_nombre is not null) "
            "or (persona_tipo = 'sin_identificar' and persona_usuario_id is null and persona_nombre is null)",
            name="ck_cmov_persona",
        ),
    )
    op.create_index("ix_cmov_cuenta_fecha", "cuenta_movimientos", ["cuenta_id", "fecha"])
    op.create_index("ix_cmov_destino", "cuenta_movimientos", ["cuenta_destino_id"])
    op.create_index("ix_cmov_familia_fecha", "cuenta_movimientos", ["familia_id", "fecha"])


def downgrade() -> None:
    op.drop_table("cuenta_movimientos")
    op.drop_table("cuentas")
    # los 'compartidos' de cuentas ya no apuntan a nada: se limpian (sin tocar los de movimientos ni apoyos)
    op.execute("DELETE FROM compartidos WHERE entidad = 'cuenta'")
