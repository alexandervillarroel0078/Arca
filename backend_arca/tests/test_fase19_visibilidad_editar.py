"""Fase 19: solo el dueno cambia 'quien lo ve' (tambien por PATCH de editar) + aislamiento reforzado.

El admin puede editar lo de visibilidad 'familia' de otros, pero NO su visibilidad (ni compartido_con).
"""
import csv
import io
import json

import pytest

from app.modulos.movimientos.models import Movimiento
from tests.conftest import SesionTest, registrar

MES = "2025-03"
MENSAJE = "Solo quien lo registró puede cambiar quién lo ve"


# ---------------------------------------------------------------- ayudas
def _gasto(client, h, cat, monto=50, fecha="2025-03-05", **extra):
    r = client.post("/api/movimientos", headers=h, json={"tipo": "gasto", "monto": monto, "categoria_id": cat, "fecha": fecha, **extra})
    assert r.status_code == 201, r.text
    return r.json()


def _apoyo(client, h, monto=100, fecha="2025-03-05", **extra):
    r = client.post("/api/apoyos", headers=h, json={"beneficiario": "Tia", "monto": monto, "fecha": fecha, **extra})
    assert r.status_code == 201, r.text
    return r.json()


def _acciones(client, h, entidad, entidad_id):
    r = client.get(f"/api/historial?entidad={entidad}&entidad_id={entidad_id}", headers=h)
    assert r.status_code == 200, r.text
    return [i["accion"] for i in r.json()["items"]]


def _yo(client, h):
    return client.get("/api/auth/yo", headers=h).json()


def _crear(client, tipo, h, cat):
    return _gasto(client, h, cat, visibilidad="familia") if tipo == "movimientos" else _apoyo(client, h, visibilidad="familia")


def _entidad(tipo):
    return "movimiento" if tipo == "movimientos" else "apoyo"


TIPOS = ["movimientos", "apoyos"]


# ---------------------------------------------------------------- el hueco de editar
@pytest.mark.parametrize("tipo", TIPOS)
def test_admin_no_cambia_la_visibilidad_de_un_registro_ajeno_al_editar(client, admin, miembro, categoria_id, tipo):
    r = _crear(client, tipo, miembro, categoria_id)
    url = f"/api/{tipo}/{r['id']}"
    resp = client.patch(url, headers=admin, json={"visibilidad": "solo_yo"})
    assert resp.status_code == 403 and resp.json()["detail"] == MENSAJE
    assert client.get(url, headers=miembro).json()["visibilidad"] == "familia"  # no cambio
    assert client.get(url, headers=admin).status_code == 200  # el admin lo sigue viendo
    assert "cambiar_visibilidad" not in _acciones(client, miembro, _entidad(tipo), r["id"])


@pytest.mark.parametrize("tipo", TIPOS)
def test_admin_tampoco_cambia_compartido_con_ni_mezclado_con_otros_campos(client, admin, miembro, categoria_id, tipo):
    r = _crear(client, tipo, miembro, categoria_id)
    url = f"/api/{tipo}/{r['id']}"
    uid_admin = _yo(client, admin)["id"]
    assert client.patch(url, headers=admin, json={"compartido_con": [uid_admin]}).status_code == 403
    # mezclado con un cambio permitido: se rechaza TODO (nada se aplica a medias)
    resp = client.patch(url, headers=admin, json={"nota": "colada", "visibilidad": "solo_yo"})
    assert resp.status_code == 403
    visto = client.get(url, headers=miembro).json()
    assert visto["nota"] != "colada" and visto["visibilidad"] == "familia"


@pytest.mark.parametrize("tipo", TIPOS)
def test_admin_sigue_pudiendo_editar_lo_demas_de_un_registro_ajeno(client, admin, miembro, categoria_id, tipo):
    r = _crear(client, tipo, miembro, categoria_id)
    url = f"/api/{tipo}/{r['id']}"
    resp = client.patch(url, headers=admin, json={"nota": "corregida por el admin"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["nota"] == "corregida por el admin" and resp.json()["visibilidad"] == "familia"
    resp = client.patch(url, headers=admin, json={"monto": 77, "fecha": "2025-03-06"})
    assert resp.status_code == 200 and float(resp.json()["monto"]) == 77


@pytest.mark.parametrize("tipo", TIPOS)
def test_el_duenio_cambia_su_visibilidad_al_editar_y_queda_historial(client, admin, miembro, categoria_id, tipo):
    r = _crear(client, tipo, miembro, categoria_id)
    url = f"/api/{tipo}/{r['id']}"
    resp = client.patch(url, headers=miembro, json={"visibilidad": "solo_yo"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["visibilidad"] == "solo_yo"
    assert "cambiar_visibilidad" in _acciones(client, miembro, _entidad(tipo), r["id"])
    assert client.get(url, headers=admin).status_code == 404  # el admin ya no lo ve


def test_el_duenio_admin_cambia_la_visibilidad_de_lo_suyo_al_editar(client, admin, categoria_id):
    """El chequeo es por dueno, no por rol: un admin que es dueno puede."""
    r = _gasto(client, admin, categoria_id, visibilidad="familia")
    resp = client.patch(f"/api/movimientos/{r['id']}", headers=admin, json={"visibilidad": "solo_yo", "nota": "mia"})
    assert resp.status_code == 200 and resp.json()["visibilidad"] == "solo_yo"


# ---------------------------------------------------------------- categoria de otra familia
def test_gasto_con_categoria_de_otra_familia_da_422(client, admin, categoria_id):
    otro = registrar(client, email="otro@t.com", nombre="Otro", familia="Otra")
    cat_ajena = client.get("/api/categorias", headers=otro).json()[0]["id"]
    assert cat_ajena != categoria_id
    r = client.post("/api/movimientos", headers=admin, json={"tipo": "gasto", "monto": 10, "categoria_id": cat_ajena})
    assert r.status_code == 422
    # tambien al editar un gasto propio
    g = _gasto(client, admin, categoria_id)
    assert client.patch(f"/api/movimientos/{g['id']}", headers=admin, json={"categoria_id": cat_ajena}).status_code == 422
    assert client.get(f"/api/movimientos/{g['id']}", headers=admin).json()["categoria_id"] == categoria_id


# ---------------------------------------------------------------- bitacora y registros privados
def test_bitacora_no_muestra_a_otros_un_registro_privado_de_la_misma_familia(client, admin, miembro, categoria_id):
    privado = _gasto(client, miembro, categoria_id, monto=77.77, nota="SECRETO-PRIVADO", visibilidad="solo_yo")
    _gasto(client, miembro, categoria_id, monto=11.11, nota="visible", visibilidad="familia")

    def ver_admin():
        items = client.get("/api/bitacora?limite=100", headers=admin)
        assert items.status_code == 200, items.text
        csv_txt = client.get("/api/bitacora/exportar.csv", headers=admin)
        assert csv_txt.status_code == 200
        return json.dumps(items.json()), csv_txt.text

    texto_json, texto_csv = ver_admin()
    assert "11.11" in texto_json and "11.11" in texto_csv  # control: la bitacora SI muestra lo familiar
    for texto in (texto_json, texto_csv):
        assert "77.77" not in texto and "SECRETO-PRIVADO" not in texto
    assert list(csv.reader(io.StringIO(texto_csv)))  # el CSV es valido

    # control inverso: al compartirlo con la familia, el admin ya lo ve
    r = client.patch(f"/api/movimientos/{privado['id']}/visibilidad", headers=miembro, json={"visibilidad": "familia"})
    assert r.status_code == 200
    texto_json, _ = ver_admin()
    assert "77.77" in texto_json


# ---------------------------------------------------------------- datos de otra familia no se mezclan
def _periodo(client, h):
    return (
        client.get(f"/api/reportes/resumen?mes={MES}", headers=h).json(),
        client.get(f"/api/reportes/por-categoria?mes={MES}", headers=h).json(),
        client.get(f"/api/reportes/por-miembro?mes={MES}", headers=h).json(),
    )


def test_datos_de_otra_familia_en_el_mismo_periodo_no_se_mezclan(client, admin):
    otro = registrar(client, email="otro@t.com", nombre="Otro", familia="Otra")
    cat_a = next(c["id"] for c in client.get("/api/categorias", headers=admin).json() if c["nombre"] == "Comida")
    cat_b = next(c["id"] for c in client.get("/api/categorias", headers=otro).json() if c["nombre"] == "Comida")
    # misma categoria (por nombre), mismo mes, montos distintos
    client.post("/api/movimientos", headers=admin, json={"tipo": "ingreso", "monto": 1000, "fecha": "2025-03-01"})
    _gasto(client, admin, cat_a, monto=100)
    _apoyo(client, admin, monto=200)
    client.post("/api/movimientos", headers=otro, json={"tipo": "ingreso", "monto": 5000, "fecha": "2025-03-01"})
    _gasto(client, otro, cat_b, monto=900)
    _apoyo(client, otro, monto=700)

    for h, ing, gas, apo in ((admin, 1000, 100, 200), (otro, 5000, 900, 700)):
        resumen, por_cat, por_miembro = _periodo(client, h)
        assert (float(resumen["ingresos"]), float(resumen["gastos"]), float(resumen["apoyos_entregados"])) == (ing, gas, apo)
        assert float(por_cat["total_gastos"]) == gas
        assert [float(c["total"]) for c in por_cat["categorias"]] == [gas]
        assert len(por_miembro["miembros"]) == 1  # solo los de su familia
        assert float(por_miembro["miembros"][0]["gastos"]) == gas
        assert float(por_miembro["miembros"][0]["apoyos_entregados"]) == apo


def test_por_categoria_ignora_una_categoria_de_otra_familia_aunque_el_dato_este_mal(client, admin):
    """Defensa en profundidad: aunque un gasto apunte (por error de datos) a una categoria ajena, no entra al reporte."""
    otro = registrar(client, email="otro@t.com", nombre="Otro", familia="Otra")
    cat_ajena = client.get("/api/categorias", headers=otro).json()[0]["id"]
    yo = _yo(client, admin)
    with SesionTest() as db:  # se fuerza directo en la base (la API lo impide)
        from datetime import date
        from decimal import Decimal

        db.add(
            Movimiento(
                familia_id=yo["familia_id"], usuario_id=yo["id"], tipo="gasto", monto=Decimal("321.00"),
                fecha=date(2025, 3, 5), categoria_id=cat_ajena, nota="dato corrupto",
            )
        )
        db.commit()
    por_cat = client.get(f"/api/reportes/por-categoria?mes={MES}", headers=admin).json()
    assert por_cat["categorias"] == []
