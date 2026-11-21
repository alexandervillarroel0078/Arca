"""fuente de pago: gastos, ingresos y apoyos pagados con Efectivo o con una cuenta (Banco), con confirmacion

- `movimientos.cuenta_id` y `apoyos.cuenta_id` (NULL = Efectivo). Todo lo existente queda en Efectivo: no se rellena.
- `cuenta_movimientos`:
  - `origen_tipo` / `origen_id`: el gasto/ingreso ('movimiento') o apoyo que lo creo (las dos vacias en lo registrado
    en Cuentas). Indice unico parcial: un solo vinculo VIGENTE (activo y no rechazado) por registro de Arca.
  - `estado`: pendiente | confirmado | rechazado (default confirmado: lo existente queda igual). Solo lo confirmado
    (y activo) suma al saldo. Solo un movimiento con origen puede quedar pendiente o rechazado.
  - `confirmado_por`, `confirmado_en`, `motivo_rechazo`, `hora_registrada` (la hora real al registrar el gasto,
    cuando la confirmacion mueve `fecha`/`hora` al momento de confirmar).
No toca `historial` ni `bitacora` ni sus triggers.

Revision ID: 0010
Revises: 0009
"""
from alembic import op
import sqlalchemy as sa

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("movimientos", sa.Column("cuenta_id", sa.Integer(), sa.ForeignKey("cuentas.id"), nullable=True))
    op.add_column("apoyos", sa.Column("cuenta_id", sa.Integer(), sa.ForeignKey("cuentas.id"), nullable=True))

    op.add_column("cuenta_movimientos", sa.Column("origen_tipo", sa.String(10), nullable=True))
    op.add_column("cuenta_movimientos", sa.Column("origen_id", sa.Integer(), nullable=True))
    op.add_column(
        "cuenta_movimientos", sa.Column("estado", sa.String(10), server_default="confirmado", nullable=False)
    )
    op.add_column(
        "cuenta_movimientos", sa.Column("confirmado_por", sa.Integer(), sa.ForeignKey("usuarios.id"), nullable=True)
    )
    op.add_column("cuenta_movimientos", sa.Column("confirmado_en", sa.DateTime(timezone=True), nullable=True))
    op.add_column("cuenta_movimientos", sa.Column("motivo_rechazo", sa.String(300), nullable=True))
    op.add_column("cuenta_movimientos", sa.Column("hora_registrada", sa.Time(), nullable=True))
    op.create_check_constraint(
        "ck_cmov_origen_tipo", "cuenta_movimientos", "origen_tipo is null or origen_tipo in ('movimiento','apoyo')"
    )
    op.create_check_constraint(
        "ck_cmov_origen", "cuenta_movimientos", "(origen_tipo is null) = (origen_id is null)"
    )
    op.create_check_constraint(
        "ck_cmov_estado", "cuenta_movimientos", "estado in ('pendiente','confirmado','rechazado')"
    )
    op.create_check_constraint(
        "ck_cmov_estado_origen", "cuenta_movimientos", "estado = 'confirmado' or origen_id is not null"
    )
    op.create_check_constraint(
        "ck_cmov_origen_tipos", "cuenta_movimientos", "origen_id is null or tipo in ('deposito','retiro')"
    )
    # Un solo vinculo VIGENTE por registro de Arca: los rechazados y los anulados quedan como rastro.
    op.create_index(
        "uq_cmov_origen_vigente", "cuenta_movimientos", ["origen_tipo", "origen_id"], unique=True,
        postgresql_where=sa.text("origen_id is not null and estado <> 'rechazado' and not anulado"),
    )
    op.create_index(
        "ix_cmov_por_confirmar", "cuenta_movimientos", ["cuenta_id"],
        postgresql_where=sa.text("estado = 'pendiente' and not anulado"),
    )


def downgrade() -> None:
    # Sin `estado`, un pendiente o rechazado contaria en el saldo: se anulan para que los saldos no cambien al bajar.
    op.execute(
        "UPDATE cuenta_movimientos SET anulado = true, anulado_en = now(), "
        "motivo_anulacion = 'Sin confirmar al quitar la fuente de pago' WHERE estado <> 'confirmado' AND NOT anulado"
    )
    op.drop_index("ix_cmov_por_confirmar", table_name="cuenta_movimientos")
    op.drop_index("uq_cmov_origen_vigente", table_name="cuenta_movimientos")
    for ck in ("ck_cmov_origen_tipos", "ck_cmov_estado_origen", "ck_cmov_estado", "ck_cmov_origen", "ck_cmov_origen_tipo"):
        op.drop_constraint(ck, "cuenta_movimientos", type_="check")
    for col in ("hora_registrada", "motivo_rechazo", "confirmado_en", "confirmado_por", "estado", "origen_id", "origen_tipo"):
        op.drop_column("cuenta_movimientos", col)
    op.drop_column("apoyos", "cuenta_id")
    op.drop_column("movimientos", "cuenta_id")
