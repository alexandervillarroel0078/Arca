"""version de registros y operaciones sin internet (Fase 12)

- `version` (entero que sube con cada cambio) en movimientos, apoyos y devoluciones: detecta conflictos (409).
- `historial.fecha_cliente`: cuando el usuario hizo la accion en su aparato (aparte de `fecha`, la de sincronizacion).
- `historial.uuid_operacion`: UUID de la operacion de la cola del cliente. Indice unico parcial: idempotencia.

Solo se AGREGAN columnas (ALTER TABLE ADD COLUMN): no se toca ninguna fila del historial, asi que el trigger
`historial_inmutable` (rechaza UPDATE y DELETE) sigue intacto.

Revision ID: 0004
Revises: 0003
"""
from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

TABLAS = ("movimientos", "apoyos", "devoluciones")


def upgrade() -> None:
    for t in TABLAS:
        op.add_column(t, sa.Column("version", sa.Integer(), server_default="1", nullable=False))
    op.add_column("historial", sa.Column("fecha_cliente", sa.DateTime(timezone=True), nullable=True))
    op.add_column("historial", sa.Column("uuid_operacion", sa.String(length=36), nullable=True))
    op.create_index(
        "uq_historial_operacion",
        "historial",
        ["familia_id", "uuid_operacion", "entidad", "entidad_id", "accion"],
        unique=True,
        postgresql_where=sa.text("uuid_operacion is not null"),
    )


def downgrade() -> None:
    op.drop_index("uq_historial_operacion", table_name="historial")
    op.drop_column("historial", "uuid_operacion")
    op.drop_column("historial", "fecha_cliente")
    for t in TABLAS:
        op.drop_column(t, "version")
