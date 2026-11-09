"""bitacora de accesos y seguridad, de solo agregar (Fase 15)

Tabla nueva `bitacora` con un trigger que rechaza UPDATE y DELETE (igual que `historial`). No toca `historial`
ni su trigger: solo agrega una tabla.

Revision ID: 0005
Revises: 0004
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

SQL_FUNCION = """
CREATE OR REPLACE FUNCTION bitacora_solo_agregar() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'La bitacora es de solo agregar: no se puede editar ni borrar';
END;
$$ LANGUAGE plpgsql
"""
SQL_TRIGGER = """
CREATE TRIGGER bitacora_inmutable BEFORE UPDATE OR DELETE ON bitacora
FOR EACH ROW EXECUTE FUNCTION bitacora_solo_agregar()
"""


def upgrade() -> None:
    op.create_table(
        "bitacora",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("familia_id", sa.Integer(), nullable=True),
        sa.Column("usuario_id", sa.Integer(), nullable=True),
        sa.Column("correo_intentado", sa.String(length=254), nullable=True),
        sa.Column("evento", sa.String(length=40), nullable=False),
        sa.Column("resultado", sa.String(length=5), nullable=False),
        sa.Column("ip", sa.String(length=64), nullable=True),
        sa.Column("dispositivo", sa.String(length=200), nullable=True),
        sa.Column("fecha", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("detalle", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False),
        sa.ForeignKeyConstraint(["familia_id"], ["familias.id"]),
        sa.ForeignKeyConstraint(["usuario_id"], ["usuarios.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_bitacora_familia_fecha", "bitacora", ["familia_id", "fecha", "id"], unique=False)
    op.create_index("ix_bitacora_correo", "bitacora", ["correo_intentado"], unique=False)
    op.execute(SQL_FUNCION)
    op.execute(SQL_TRIGGER)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS bitacora_inmutable ON bitacora")
    op.drop_index("ix_bitacora_correo", table_name="bitacora")
    op.drop_index("ix_bitacora_familia_fecha", table_name="bitacora")
    op.drop_table("bitacora")
    op.execute("DROP FUNCTION IF EXISTS bitacora_solo_agregar()")
