"""Fase 12: version de registros (409), idempotencia por operacion, orden de aplicacion y fecha real del cliente."""
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from app.modulos.historial.models import Historial
from tests.conftest import SesionTest

# ---------------------------------------------------------------- ayudas


def op(h, uuid_op=None, cuando=None):
    """Cabeceras de una operacion de la cola del cliente: UUID de operacion y fecha real de la accion."""
    extra = {"X-Operacion-Id": uuid_op or str(uuid.uuid4())}
    if cuando is not None:
        extra["X-Fecha-Cliente"] = cuando.isoformat()
    return {**h, **extra}


def gasto(client, h, cat, monto=100, **extra):
    r = client.post("/api/movimientos", headers=h, json={"tipo": "gasto", "monto": monto, "categoria_id": cat, **extra})
    assert r.status_code == 201, r.text
    return r.json()


def apoyo(client, h, monto=500, **extra):
    r = client.post("/api/apoyos", headers=h, json={"beneficiario": "Tia Rosa", "monto": monto, **extra})
    assert r.status_code == 201, r.text
    return r.json()


def dev(client, h, apoyo_id, monto, **extra):
    r = client.post(f"/api/apoyos/{apoyo_id}/devoluciones", headers=h, json={"monto": monto, **extra})
    assert r.status_code in (200, 201), r.text
    return r.json()


def entradas(entidad=None, entidad_id=None, uuid_op=None):
    with SesionTest() as db:
        q = select(Historial).order_by(Historial.id)
        if entidad:
            q = q.where(Historial.entidad == entidad)
        if entidad_id is not None:
            q = q.where(Historial.entidad_id == entidad_id)
        if uuid_op:
            q = q.where(Historial.uuid_operacion == uuid_op)
        return list(db.scalars(q))


def cuantas() -> int:
    with SesionTest() as db:
        return db.scalar(select(func.count()).select_from(Historial))


# ---------------------------------------------------------------- version
def test_la_version_empieza_en_1_y_sube_con_cada_cambio(client, admin, categoria_id):
    m = gasto(client, admin, categoria_id)
    assert m["version"] == 1
    r = client.patch(f"/api/movimientos/{m['id']}", headers=admin, json={"monto": 120})
    assert r.json()["version"] == 2
    r = client.post(f"/api/movimientos/{m['id']}/anular", headers=admin, json={})
    assert r.json()["version"] == 3
    r = client.post(f"/api/movimientos/{m['id']}/reactivar", headers=admin, json={})
    assert r.json()["version"] == 4  # un solo +1 aunque la reactivacion toque varias columnas
    assert client.get(f"/api/movimientos/{m['id']}", headers=admin).json()["version"] == 4


def test_la_version_de_apoyos_y_devoluciones_y_la_cascada(client, admin):
    a = apoyo(client, admin, 500)
    assert a["version"] == 1
    d = dev(client, admin, a["id"], 100)["devoluciones"][0]
    assert d["version"] == 1
    # registrar una devolucion NO cambia el apoyo mismo (no provoca conflictos falsos al editar el apoyo)
    assert client.get(f"/api/apoyos/{a['id']}", headers=admin).json()["version"] == 1
    r = client.post(f"/api/apoyos/{a['id']}/anular", headers=admin, json={}).json()
    assert r["version"] == 2
    assert r["devoluciones"][0]["version"] == 2  # la devolucion anulada en cascada tambien cambio
    r = client.post(f"/api/apoyos/{a['id']}/reactivar", headers=admin, json={}).json()
    assert r["version"] == 3 and r["devoluciones"][0]["version"] == 3
    # consumir / reabrir cambian el apoyo
    assert client.post(f"/api/apoyos/{a['id']}/consumir", headers=admin).json()["version"] == 4
    assert client.post(f"/api/apoyos/{a['id']}/reabrir", headers=admin).json()["version"] == 5


def test_sin_version_base_todo_sigue_funcionando(client, admin, categoria_id):
    """Compatibilidad: un cliente anterior a la Fase 12 no manda version_base."""
    m = gasto(client, admin, categoria_id)
    assert client.patch(f"/api/movimientos/{m['id']}", headers=admin, json={"monto": 10}).status_code == 200
    assert client.patch(f"/api/movimientos/{m['id']}", headers=admin, json={"monto": 11}).status_code == 200


def test_la_lista_completa_expone_version_y_uuid(client, admin, categoria_id):
    u = str(uuid.uuid4())
    gasto(client, admin, categoria_id, uuid_cliente=u)
    items = client.get("/api/actividad", headers=admin).json()["items"]
    assert items[0]["version"] == 1 and items[0]["uuid_cliente"] == u


# ---------------------------------------------------------------- 409 por version
def test_movimiento_409_si_cambio_en_el_servidor(client, admin, miembro, categoria_id):
    m = gasto(client, admin, categoria_id, monto=100)
    # el admin edita (v2) mientras el miembro-offline se basaba en la v1: el admin es quien puede editar lo de cualquiera
    assert client.patch(f"/api/movimientos/{m['id']}", headers=admin, json={"monto": 150}).json()["version"] == 2
    antes = cuantas()

    r = client.patch(f"/api/movimientos/{m['id']}", headers=admin, json={"monto": 999, "version_base": 1})
    assert r.status_code == 409
    d = r.json()["detail"]
    assert d["codigo"] == "conflicto_version"
    assert d["version_actual"] == 2 and d["version_base"] == 1
    assert d["actual"]["monto"] == 150 and d["actual"]["version"] == 2  # el cliente puede mostrar la version del servidor

    # nada cambio: ni el registro, ni su version, ni el historial
    assert client.get(f"/api/movimientos/{m['id']}", headers=admin).json()["monto"] == 150
    assert cuantas() == antes

    # con la version correcta si se aplica
    r = client.patch(f"/api/movimientos/{m['id']}", headers=admin, json={"monto": 999, "version_base": 2})
    assert r.status_code == 200 and r.json()["version"] == 3


def test_anular_y_reactivar_movimiento_409(client, admin, categoria_id):
    m = gasto(client, admin, categoria_id)
    client.patch(f"/api/movimientos/{m['id']}", headers=admin, json={"monto": 7})  # v2
    r = client.post(f"/api/movimientos/{m['id']}/anular", headers=admin, json={"version_base": 1})
    assert r.status_code == 409 and r.json()["detail"]["version_actual"] == 2
    assert client.get(f"/api/movimientos/{m['id']}", headers=admin).json()["anulado"] is False

    assert client.post(f"/api/movimientos/{m['id']}/anular", headers=admin, json={"version_base": 2}).status_code == 200  # v3
    r = client.post(f"/api/movimientos/{m['id']}/reactivar", headers=admin, json={"version_base": 2})
    assert r.status_code == 409
    assert client.get(f"/api/movimientos/{m['id']}", headers=admin).json()["anulado"] is True
    r = client.post(f"/api/movimientos/{m['id']}/reactivar", headers=admin, json={"version_base": 3})
    assert r.status_code == 200 and r.json()["anulado"] is False


def test_apoyo_409_en_editar_anular_y_reactivar(client, admin):
    a = apoyo(client, admin)
    client.patch(f"/api/apoyos/{a['id']}", headers=admin, json={"nota": "x"})  # v2
    for ruta, cuerpo in (
        (f"/api/apoyos/{a['id']}/anular", {"version_base": 1}),
        (f"/api/apoyos/{a['id']}/reactivar", {"version_base": 1}),
    ):
        r = client.post(ruta, headers=admin, json=cuerpo)
        assert r.status_code == 409, ruta
        assert r.json()["detail"]["actual"]["nota"] == "x"
    r = client.patch(f"/api/apoyos/{a['id']}", headers=admin, json={"nota": "y", "version_base": 1})
    assert r.status_code == 409
    assert client.get(f"/api/apoyos/{a['id']}", headers=admin).json()["nota"] == "x"
    assert client.patch(f"/api/apoyos/{a['id']}", headers=admin, json={"nota": "y", "version_base": 2}).status_code == 200


def test_devolucion_409_en_editar_anular_y_reactivar(client, admin):
    a = apoyo(client, admin)
    d = dev(client, admin, a["id"], 100)["devoluciones"][0]
    base = f"/api/apoyos/{a['id']}/devoluciones/{d['id']}"
    client.patch(base, headers=admin, json={"monto": 120})  # v2

    r = client.patch(base, headers=admin, json={"monto": 50, "version_base": 1})
    assert r.status_code == 409
    assert r.json()["detail"]["actual"]["monto"] == 120  # se muestra la devolucion, no el apoyo
    assert client.post(f"{base}/anular", headers=admin, json={"version_base": 1}).status_code == 409
    assert client.post(f"{base}/anular", headers=admin, json={"version_base": 2}).status_code == 200  # v3
    assert client.post(f"{base}/reactivar", headers=admin, json={"version_base": 2}).status_code == 409
    assert client.post(f"{base}/reactivar", headers=admin, json={"version_base": 3}).status_code == 200


def test_conflicto_entre_dos_usuarios(client, admin, miembro, categoria_id):
    """Ambos parten de la v1; el primero en llegar gana y el segundo recibe 409 sin perder nada."""
    h_miembro = miembro
    m = client.post(
        "/api/movimientos", headers=h_miembro, json={"tipo": "gasto", "monto": 100, "categoria_id": categoria_id}
    ).json()
    r1 = client.patch(f"/api/movimientos/{m['id']}", headers=h_miembro, json={"monto": 110, "version_base": 1})
    assert r1.status_code == 200
    r2 = client.patch(f"/api/movimientos/{m['id']}", headers=admin, json={"monto": 130, "version_base": 1})
    assert r2.status_code == 409
    assert r2.json()["detail"]["actual"]["monto"] == 110
    assert r2.json()["detail"]["actual"]["editado_por_nombre"] == "Miembro"


def test_un_rechazo_de_permisos_no_cambia_nada(client, admin, miembro, categoria_id):
    m = gasto(client, admin, categoria_id)
    antes = cuantas()
    r = client.patch(f"/api/movimientos/{m['id']}", headers=op(miembro), json={"monto": 5, "version_base": 1})
    assert r.status_code == 403  # el permiso se valida siempre, antes que la version
    assert client.get(f"/api/movimientos/{m['id']}", headers=admin).json()["version"] == 1
    assert cuantas() == antes


def test_dos_cambios_simultaneos_con_la_misma_version_solo_uno_gana(client, admin, categoria_id):
    m = gasto(client, admin, categoria_id, monto=10)

    def editar(n):
        return client.patch(
            f"/api/movimientos/{m['id']}", headers=admin, json={"monto": 20 + n, "version_base": 1}
        ).status_code

    with ThreadPoolExecutor(max_workers=6) as pool:
        codigos = sorted(pool.map(editar, range(6)))
    assert codigos == [200, 409, 409, 409, 409, 409]
    assert client.get(f"/api/movimientos/{m['id']}", headers=admin).json()["version"] == 2


# ---------------------------------------------------------------- idempotencia por operacion
def test_la_misma_operacion_dos_veces_tiene_un_solo_efecto(client, admin, categoria_id):
    m = gasto(client, admin, categoria_id, monto=100)
    u = str(uuid.uuid4())
    r1 = client.patch(f"/api/movimientos/{m['id']}", headers=op(admin, u), json={"monto": 150, "version_base": 1})
    assert r1.status_code == 200 and r1.json()["version"] == 2
    n = cuantas()
    # reenvio (respuesta perdida): mismo UUID. Aunque la version_base ya no coincida, NO es un conflicto: ya se aplico
    r2 = client.patch(f"/api/movimientos/{m['id']}", headers=op(admin, u), json={"monto": 150, "version_base": 1})
    assert r2.status_code == 200
    assert r2.json()["version"] == 2 and r2.json()["monto"] == 150
    assert cuantas() == n  # ni una entrada de historial mas
    assert len(entradas("movimiento", m["id"], u)) == 1


def test_idempotencia_de_anular_y_reactivar(client, admin, categoria_id):
    m = gasto(client, admin, categoria_id)
    u1, u2 = str(uuid.uuid4()), str(uuid.uuid4())
    for _ in range(3):
        r = client.post(f"/api/movimientos/{m['id']}/anular", headers=op(admin, u1), json={"motivo": "x", "version_base": 1})
        assert r.status_code == 200 and r.json()["anulado"] is True and r.json()["version"] == 2
    for _ in range(3):
        r = client.post(f"/api/movimientos/{m['id']}/reactivar", headers=op(admin, u2), json={"version_base": 2})
        assert r.status_code == 200 and r.json()["anulado"] is False and r.json()["version"] == 3
    assert [e.accion for e in entradas("movimiento", m["id"])] == ["crear", "anular", "reactivar"]


def test_idempotencia_en_apoyos_devoluciones_y_cascada(client, admin):
    a = apoyo(client, admin)
    d = dev(client, admin, a["id"], 100)["devoluciones"][0]
    u_anular, u_dev, u_ed = (str(uuid.uuid4()) for _ in range(3))

    for _ in range(2):
        assert client.patch(
            f"/api/apoyos/{a['id']}/devoluciones/{d['id']}", headers=op(admin, u_dev), json={"monto": 80, "version_base": 1}
        ).status_code == 200
    assert len(entradas("devolucion", d["id"], u_dev)) == 1

    for _ in range(2):
        r = client.post(f"/api/apoyos/{a['id']}/anular", headers=op(admin, u_anular), json={"version_base": 1})
        assert r.status_code == 200
    # la cascada tambien se aplico una sola vez: 1 entrada del apoyo + 1 de la devolucion
    assert len(entradas("apoyo", a["id"], u_anular)) == 1
    assert len(entradas("devolucion", d["id"], u_anular)) == 1

    r = client.post(f"/api/apoyos/{a['id']}/reactivar", headers=op(admin, u_ed), json={"version_base": 2})
    assert r.status_code == 200
    again = client.post(f"/api/apoyos/{a['id']}/reactivar", headers=op(admin, u_ed), json={"version_base": 2})
    assert again.status_code == 200 and again.json()["version"] == 3


def test_operaciones_distintas_con_el_mismo_cambio_si_se_aplican_ambas(client, admin, categoria_id):
    m = gasto(client, admin, categoria_id)
    client.patch(f"/api/movimientos/{m['id']}", headers=op(admin), json={"monto": 50})
    client.patch(f"/api/movimientos/{m['id']}", headers=op(admin), json={"monto": 50})
    assert client.get(f"/api/movimientos/{m['id']}", headers=admin).json()["version"] == 3


def test_un_uuid_de_operacion_invalido_da_422(client, admin, categoria_id):
    m = gasto(client, admin, categoria_id)
    r = client.patch(
        f"/api/movimientos/{m['id']}", headers={**admin, "X-Operacion-Id": "no-es-uuid"}, json={"monto": 1}
    )
    assert r.status_code == 422


def test_crear_sigue_siendo_idempotente_por_uuid_cliente(client, admin, categoria_id):
    u = str(uuid.uuid4())
    a = client.post("/api/movimientos", headers=op(admin), json={"tipo": "gasto", "monto": 5, "categoria_id": categoria_id, "uuid_cliente": u})
    b = client.post("/api/movimientos", headers=op(admin), json={"tipo": "gasto", "monto": 5, "categoria_id": categoria_id, "uuid_cliente": u})
    assert (a.status_code, b.status_code) == (201, 200)
    assert a.json()["id"] == b.json()["id"]
    assert len(entradas("movimiento", a.json()["id"])) == 1


# ---------------------------------------------------------------- orden de aplicacion
def test_las_operaciones_se_aplican_en_el_orden_enviado(client, admin, categoria_id):
    """crear -> editar -> anular -> reactivar -> editar, encadenando la version de cada respuesta."""
    u = str(uuid.uuid4())
    m = client.post("/api/movimientos", headers=op(admin), json={"tipo": "gasto", "monto": 10, "categoria_id": categoria_id, "uuid_cliente": u}).json()
    v = m["version"]
    pasos = [
        ("patch", f"/api/movimientos/{m['id']}", {"monto": 20}),
        ("post", f"/api/movimientos/{m['id']}/anular", {"motivo": "mal"}),
        ("post", f"/api/movimientos/{m['id']}/reactivar", {}),
        ("patch", f"/api/movimientos/{m['id']}", {"monto": 30, "nota": "final"}),
    ]
    for metodo, ruta, cuerpo in pasos:
        r = getattr(client, metodo)(ruta, headers=op(admin), json={**cuerpo, "version_base": v})
        assert r.status_code == 200, r.text
        assert r.json()["version"] == v + 1
        v = r.json()["version"]
    final = client.get(f"/api/movimientos/{m['id']}", headers=admin).json()
    assert final["monto"] == 30 and final["nota"] == "final" and final["anulado"] is False and final["version"] == 5
    assert [e.accion for e in entradas("movimiento", m["id"])] == ["crear", "editar", "anular", "reactivar", "editar"]


def test_el_orden_importa_editar_despues_de_anular_se_rechaza(client, admin, categoria_id):
    m = gasto(client, admin, categoria_id, monto=10)
    client.post(f"/api/movimientos/{m['id']}/anular", headers=op(admin), json={"version_base": 1})
    r = client.patch(f"/api/movimientos/{m['id']}", headers=op(admin), json={"monto": 99, "version_base": 2})
    assert r.status_code == 400  # regla de negocio: primero se reactiva
    assert client.get(f"/api/movimientos/{m['id']}", headers=admin).json()["monto"] == 10


def test_devolucion_de_un_apoyo_creado_con_uuid_del_cliente(client, admin):
    """Apoyo -> devolucion -> editar apoyo, todo en el orden en que lo hizo el usuario sin internet."""
    u = str(uuid.uuid4())
    a = client.post("/api/apoyos", headers=op(admin), json={"beneficiario": "Primo", "monto": 200, "uuid_cliente": u}).json()
    d = client.post(f"/api/apoyos/{a['id']}/devoluciones", headers=op(admin), json={"monto": 50, "uuid_cliente": str(uuid.uuid4())})
    assert d.status_code == 201 and d.json()["pendiente"] == 150
    # una edicion que baja el monto por debajo de lo devuelto se rechaza (422/400) y no cambia nada
    r = client.patch(f"/api/apoyos/{a['id']}", headers=op(admin), json={"monto": 40, "version_base": 1})
    assert r.status_code == 400
    assert client.get(f"/api/apoyos/{a['id']}", headers=admin).json()["monto"] == 200


def test_devolucion_superior_al_pendiente_es_un_rechazo_de_regla_de_negocio(client, admin):
    a = apoyo(client, admin, 100)
    r = client.post(f"/api/apoyos/{a['id']}/devoluciones", headers=op(admin), json={"monto": 101, "uuid_cliente": str(uuid.uuid4())})
    assert r.status_code == 400 and "supera" in r.json()["detail"]
    assert client.get(f"/api/apoyos/{a['id']}", headers=admin).json()["devoluciones"] == []


# ---------------------------------------------------------------- creado y anulado = una sola operacion
def test_crear_ya_anulado_en_una_sola_operacion(client, admin, categoria_id):
    cuando = datetime.now(timezone.utc) - timedelta(hours=5)
    anulacion = cuando + timedelta(hours=1)
    u_op = str(uuid.uuid4())
    r = client.post(
        "/api/movimientos",
        headers=op(admin, u_op, cuando),
        json={
            "tipo": "gasto", "monto": 30, "categoria_id": categoria_id, "uuid_cliente": str(uuid.uuid4()),
            "anulado": True, "motivo_anulacion": "me equivoque", "fecha_cliente_anulacion": anulacion.isoformat(),
        },
    )
    assert r.status_code == 201
    m = r.json()
    assert m["anulado"] is True and m["motivo_anulacion"] == "me equivoque"
    es = entradas("movimiento", m["id"])
    assert [e.accion for e in es] == ["crear", "anular"]
    assert es[0].fecha_cliente == cuando and es[1].fecha_cliente == anulacion
    # y no cuenta en nada
    assert client.get("/api/movimientos", headers=admin).json() == []


def test_apoyo_y_devolucion_creados_ya_anulados(client, admin):
    a = client.post(
        "/api/apoyos", headers=admin,
        json={"beneficiario": "Tio", "monto": 100, "uuid_cliente": str(uuid.uuid4()), "anulado": True},
    ).json()
    assert a["anulado"] is True and a["estado"] == "Anulado"
    b = apoyo(client, admin, 100)
    r = client.post(
        f"/api/apoyos/{b['id']}/devoluciones", headers=admin,
        json={"monto": 40, "uuid_cliente": str(uuid.uuid4()), "anulado": True, "motivo_anulacion": "x"},
    ).json()
    assert r["devuelto"] == 0 and r["pendiente"] == 100 and r["devoluciones"][0]["anulado"] is True


# ---------------------------------------------------------------- fecha real del cliente en el historial
def test_el_historial_guarda_la_fecha_del_cliente_aparte_de_la_de_sincronizacion(client, admin, categoria_id):
    hace_dos_dias = datetime.now(timezone.utc) - timedelta(days=2)
    m = client.post(
        "/api/movimientos", headers=op(admin, cuando=hace_dos_dias),
        json={"tipo": "gasto", "monto": 12, "categoria_id": categoria_id},
    ).json()
    ahora = datetime.now(timezone.utc)
    (e,) = entradas("movimiento", m["id"])
    assert e.fecha_cliente == hace_dos_dias
    assert abs((e.fecha - ahora).total_seconds()) < 60  # `fecha` es la de sincronizacion (hora del servidor)

    items = client.get(f"/api/historial?entidad=movimiento&entidad_id={m['id']}", headers=admin).json()["items"]
    assert datetime.fromisoformat(items[0]["fecha_cliente"]) == hace_dos_dias
    assert datetime.fromisoformat(items[0]["fecha"]) != hace_dos_dias


def test_sin_cabecera_de_fecha_el_historial_queda_sin_fecha_de_cliente(client, admin, categoria_id):
    m = gasto(client, admin, categoria_id)
    assert entradas("movimiento", m["id"])[0].fecha_cliente is None
    items = client.get(f"/api/historial?entidad=movimiento&entidad_id={m['id']}", headers=admin).json()["items"]
    assert items[0]["fecha_cliente"] is None


def test_una_fecha_de_cliente_en_el_futuro_no_se_acepta(client, admin, categoria_id):
    futura = datetime.now(timezone.utc) + timedelta(days=30)
    m = client.post(
        "/api/movimientos", headers=op(admin, cuando=futura),
        json={"tipo": "gasto", "monto": 1, "categoria_id": categoria_id},
    ).json()
    f = entradas("movimiento", m["id"])[0].fecha_cliente
    assert f is not None and f < datetime.now(timezone.utc) + timedelta(minutes=1)


def test_fecha_de_cliente_invalida_da_422(client, admin, categoria_id):
    r = client.post(
        "/api/movimientos", headers={**admin, "X-Fecha-Cliente": "ayer"},
        json={"tipo": "gasto", "monto": 1, "categoria_id": categoria_id},
    )
    assert r.status_code == 422


def test_la_cascada_comparte_la_fecha_del_cliente(client, admin):
    a = apoyo(client, admin)
    d = dev(client, admin, a["id"], 10)["devoluciones"][0]
    cuando = datetime.now(timezone.utc) - timedelta(hours=3)
    client.post(f"/api/apoyos/{a['id']}/anular", headers=op(admin, cuando=cuando), json={})
    assert entradas("apoyo", a["id"])[-1].fecha_cliente == cuando
    assert entradas("devolucion", d["id"])[-1].fecha_cliente == cuando


def test_el_historial_sigue_siendo_de_solo_agregar(client, admin, categoria_id):
    """Las columnas nuevas no debilitan el trigger: UPDATE sobre fecha_cliente tambien se rechaza."""
    import pytest
    from sqlalchemy import text
    from sqlalchemy.exc import DBAPIError

    from tests.conftest import engine_test

    gasto(client, admin, categoria_id)
    with pytest.raises(DBAPIError):
        with engine_test.begin() as c:
            c.execute(text("UPDATE historial SET fecha_cliente = now()"))
    with pytest.raises(DBAPIError):
        with engine_test.begin() as c:
            c.execute(text("DELETE FROM historial"))
