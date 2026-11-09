from datetime import date

import pytest


def mov(client, h, tipo, monto, fecha, cat=None):
    body = {"tipo": tipo, "monto": monto, "fecha": fecha}
    if cat:
        body["categoria_id"] = cat
    assert client.post("/api/movimientos", headers=h, json=body).status_code == 201


@pytest.fixture
def datos(client, admin, miembro):
    cats = {c["nombre"]: c["id"] for c in client.get("/api/categorias", headers=admin).json()}
    mov(client, admin, "ingreso", 1000, "2025-03-01")
    mov(client, miembro, "ingreso", 500, "2025-03-10")
    mov(client, admin, "gasto", 100, "2025-03-02", cats["Comida"])
    mov(client, admin, "gasto", 50, "2025-03-03", cats["Transporte"])
    mov(client, miembro, "gasto", 50, "2025-03-04", cats["Comida"])
    mov(client, admin, "gasto", 999, "2025-02-28", cats["Otros"])  # otro mes

    a1 = client.post("/api/apoyos", headers=admin, json={"beneficiario": "Tia", "monto": 200, "fecha": "2025-03-05"}).json()
    client.post(f"/api/apoyos/{a1['id']}/devoluciones", headers=admin, json={"monto": 50, "fecha": "2025-03-20"})
    client.post(f"/api/apoyos/{a1['id']}/consumir", headers=admin)  # consume 150
    a2 = client.post("/api/apoyos", headers=miembro, json={"beneficiario": "Luis", "monto": 100, "fecha": "2025-04-02"}).json()
    client.post(f"/api/apoyos/{a2['id']}/devoluciones", headers=miembro, json={"monto": 30, "fecha": "2025-04-10"})
    return cats


def test_resumen_marzo(client, admin, datos):
    r = client.get("/api/reportes/resumen?mes=2025-03", headers=admin).json()
    assert r["mes"] == "2025-03"
    assert r["ingresos"] == 1500  # la devolucion NO suma aqui
    assert r["gastos"] == 200
    assert r["apoyos_entregados"] == 200
    assert r["devoluciones"] == 50
    assert r["saldo"] == 1500 - 200 - 200 + 50
    assert r["consumido"] == 150
    assert r["gasto_familiar_total"] == 350
    assert r["apoyos_pendientes_total"] == 70  # solo Luis: 100 - 30
    assert r["apoyos_pendientes_cantidad"] == 1


def test_resumen_abril_solo_devolucion(client, admin, datos):
    r = client.get("/api/reportes/resumen?mes=2025-04", headers=admin).json()
    assert r["ingresos"] == 0 and r["gastos"] == 0
    assert r["apoyos_entregados"] == 100 and r["devoluciones"] == 30
    assert r["saldo"] == -70


def test_resumen_mes_actual_por_defecto(client, admin):
    r = client.get("/api/reportes/resumen", headers=admin).json()
    assert r["mes"] == date.today().strftime("%Y-%m")
    assert r["saldo"] == 0


def test_por_categoria(client, admin, datos):
    r = client.get("/api/reportes/por-categoria?mes=2025-03", headers=admin).json()
    assert [(c["categoria"], c["total"]) for c in r["categorias"]] == [("Comida", 150), ("Transporte", 50)]
    assert r["categorias"][0]["porcentaje"] == 75.0
    assert r["total_gastos"] == 200
    assert r["apoyos_consumidos"] == 150  # linea aparte


def test_por_miembro(client, admin, datos):
    r = client.get("/api/reportes/por-miembro?mes=2025-03", headers=admin).json()
    por = {m["nombre"]: m for m in r["miembros"]}
    assert (por["Admin"]["ingresos"], por["Admin"]["gastos"], por["Admin"]["apoyos_entregados"]) == (1000, 150, 200)
    assert (por["Miembro"]["ingresos"], por["Miembro"]["gastos"], por["Miembro"]["apoyos_entregados"]) == (500, 50, 0)


def test_tendencia_mensual(client, admin):
    hoy = date.today()
    mov(client, admin, "ingreso", 300, hoy.isoformat())
    r = client.get("/api/reportes/tendencia-mensual", headers=admin).json()
    assert len(r["meses"]) == 6
    assert r["meses"][-1]["mes"] == hoy.strftime("%Y-%m")
    assert r["meses"][-1]["ingresos"] == 300
    assert r["meses"][0]["ingresos"] == 0
    meses = [m["mes"] for m in r["meses"]]
    assert meses == sorted(meses)
    assert client.get("/api/reportes/tendencia-mensual?meses=3", headers=admin).json()["meses"].__len__() == 3


def test_reportes_requieren_login_y_aislan(client, admin, datos):
    from tests.conftest import registrar

    assert client.get("/api/reportes/resumen").status_code == 401
    otro = registrar(client, email="otro@t.com", familia="Otra")
    r = client.get("/api/reportes/resumen?mes=2025-03", headers=otro).json()
    assert r["ingresos"] == 0 and r["apoyos_entregados"] == 0
