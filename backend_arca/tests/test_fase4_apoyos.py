def nuevo_apoyo(client, h, monto=500, quien="Tia Rosa"):
    r = client.post("/api/apoyos", headers=h, json={"beneficiario": quien, "monto": monto})
    assert r.status_code == 201, r.text
    return r.json()


def devolver(client, h, apoyo_id, monto):
    return client.post(f"/api/apoyos/{apoyo_id}/devoluciones", headers=h, json={"monto": monto})


def test_estado_pendiente(client, admin):
    a = nuevo_apoyo(client, admin, 500)
    assert (a["estado"], a["pendiente"], a["devuelto"], a["consumido"]) == ("Pendiente", 500, 0, 0)
    r = devolver(client, admin, a["id"], 200)
    assert r.status_code == 201
    assert (r.json()["estado"], r.json()["pendiente"], r.json()["devuelto"]) == ("Pendiente", 300, 200)


def test_estado_saldado(client, admin):
    a = nuevo_apoyo(client, admin, 300)
    devolver(client, admin, a["id"], 100)
    r = devolver(client, admin, a["id"], 200)
    assert (r.json()["estado"], r.json()["pendiente"], r.json()["consumido"]) == ("Saldado", 0, 0)
    assert len(r.json()["devoluciones"]) == 2


def test_estado_cerrado_por_consumo(client, admin):
    a = nuevo_apoyo(client, admin, 400)
    devolver(client, admin, a["id"], 100)
    r = client.post(f"/api/apoyos/{a['id']}/consumir", headers=admin)
    assert r.status_code == 200
    assert (r.json()["estado"], r.json()["pendiente"], r.json()["consumido"]) == ("Cerrado", 0, 300)


def test_consumir_todo_sin_devoluciones(client, admin):
    a = nuevo_apoyo(client, admin, 100)
    r = client.post(f"/api/apoyos/{a['id']}/consumir", headers=admin)
    assert (r.json()["estado"], r.json()["consumido"]) == ("Cerrado", 100)


def test_no_se_puede_pasar_del_pendiente(client, admin):
    a = nuevo_apoyo(client, admin, 100)
    assert devolver(client, admin, a["id"], 100.01).status_code == 400
    assert devolver(client, admin, a["id"], 0).status_code == 422
    client.post(f"/api/apoyos/{a['id']}/consumir", headers=admin)
    assert devolver(client, admin, a["id"], 1).status_code == 400
    assert client.post(f"/api/apoyos/{a['id']}/consumir", headers=admin).status_code == 400


def test_devolucion_no_es_ingreso(client, admin):
    a = nuevo_apoyo(client, admin, 100)
    devolver(client, admin, a["id"], 50)
    assert client.get("/api/movimientos", headers=admin).json() == []


def test_resumen_por_beneficiario(client, admin):
    r1 = nuevo_apoyo(client, admin, 500, "Tia Rosa")
    devolver(client, admin, r1["id"], 200)
    r2 = nuevo_apoyo(client, admin, 300, "Hermano Luis")
    devolver(client, admin, r2["id"], 300)
    r3 = nuevo_apoyo(client, admin, 400, "Primo Pedro")
    devolver(client, admin, r3["id"], 100)
    client.post(f"/api/apoyos/{r3['id']}/consumir", headers=admin)
    nuevo_apoyo(client, admin, 100, "tia rosa")  # mismo beneficiario sin importar mayusculas

    res = client.get("/api/apoyos/resumen", headers=admin).json()
    por = {b["beneficiario"]: b for b in res["beneficiarios"]}
    assert por["Tia Rosa"]["estado"] == "Pendiente" and por["Tia Rosa"]["pendiente"] == 400
    assert por["Tia Rosa"]["cantidad_apoyos"] == 2
    assert por["Hermano Luis"]["estado"] == "Saldado"
    assert por["Primo Pedro"]["estado"] == "Cerrado" and por["Primo Pedro"]["consumido"] == 300
    assert len(res["beneficiarios"]) == 3
    assert res["beneficiarios"][0]["estado"] == "Pendiente"  # pendientes primero
    assert res["total_entregado"] == 1300
    assert res["total_devuelto"] == 600
    assert res["total_consumido"] == 300
    assert res["total_pendiente"] == 400


def test_listar_visible_para_todos_y_aislado(client, admin, miembro):
    from tests.conftest import registrar

    nuevo_apoyo(client, admin, 100)
    assert len(client.get("/api/apoyos", headers=miembro).json()) == 1
    otro = registrar(client, email="otro@t.com", familia="Otra")
    assert client.get("/api/apoyos", headers=otro).json() == []
    a_id = client.get("/api/apoyos", headers=admin).json()[0]["id"]
    assert devolver(client, otro, a_id, 10).status_code == 404
