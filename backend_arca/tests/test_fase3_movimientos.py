from datetime import date

HOY = date.today().isoformat()
MES = date.today().strftime("%Y-%m")


def crear_gasto(client, h, cat, monto=50, **extra):
    return client.post(
        "/api/movimientos", headers=h, json={"tipo": "gasto", "monto": monto, "categoria_id": cat, **extra}
    )


def test_crear_y_listar(client, admin, categoria_id):
    r = crear_gasto(client, admin, categoria_id, 45.5, nota="pan")
    assert r.status_code == 201
    m = r.json()
    assert m["monto"] == 45.5 and m["fecha"] == HOY and m["usuario_nombre"] == "Admin"
    assert m["categoria_nombre"] == "Transporte"

    i = client.post("/api/movimientos", headers=admin, json={"tipo": "ingreso", "monto": 1000})
    assert i.status_code == 201 and i.json()["categoria_id"] is None

    lista = client.get("/api/movimientos", headers=admin).json()
    assert len(lista) == 2


def test_validaciones(client, admin, categoria_id):
    assert client.post("/api/movimientos", headers=admin, json={"tipo": "gasto", "monto": 10}).status_code == 422
    assert client.post("/api/movimientos", headers=admin, json={"tipo": "ingreso", "monto": 10, "categoria_id": categoria_id}).status_code == 422
    assert crear_gasto(client, admin, categoria_id, 0).status_code == 422
    assert crear_gasto(client, admin, categoria_id, -5).status_code == 422
    assert crear_gasto(client, admin, categoria_id, 10.123).status_code == 422
    assert crear_gasto(client, admin, 9999).status_code == 422
    assert client.post("/api/movimientos", headers=admin, json={"tipo": "apoyo", "monto": 10}).status_code == 422


def test_filtros(client, admin, miembro, categoria_id):
    crear_gasto(client, admin, categoria_id, 10, fecha=f"{MES}-01")
    crear_gasto(client, miembro, categoria_id, 20, fecha="2020-01-15")
    client.post("/api/movimientos", headers=miembro, json={"tipo": "ingreso", "monto": 500, "fecha": f"{MES}-02"})

    assert len(client.get(f"/api/movimientos?mes={MES}", headers=admin).json()) == 2
    assert len(client.get("/api/movimientos?mes=2020-01", headers=admin).json()) == 1
    assert len(client.get("/api/movimientos?tipo=ingreso", headers=admin).json()) == 1
    assert len(client.get(f"/api/movimientos?categoria={categoria_id}", headers=admin).json()) == 2
    uid = client.get("/api/auth/yo", headers=miembro).json()["id"]
    assert len(client.get(f"/api/movimientos?usuario={uid}", headers=admin).json()) == 2
    assert client.get("/api/movimientos?mes=malo", headers=admin).status_code == 422


def test_todos_ven_todo(client, admin, miembro, categoria_id):
    crear_gasto(client, admin, categoria_id)
    assert len(client.get("/api/movimientos", headers=miembro).json()) == 1


def test_editar_y_borrar_propio(client, admin, categoria_id):
    mid = crear_gasto(client, admin, categoria_id, 10).json()["id"]
    p = client.patch(f"/api/movimientos/{mid}", headers=admin, json={"monto": 99.99, "nota": "editado"})
    assert p.status_code == 200 and p.json()["monto"] == 99.99 and p.json()["nota"] == "editado"
    # ya no se borra: se anula (y desaparece de la lista normal)
    assert client.post(f"/api/movimientos/{mid}/anular", headers=admin, json={}).status_code == 200
    assert client.get("/api/movimientos", headers=admin).json() == []


def test_permisos_miembro_vs_admin(client, admin, miembro, categoria_id):
    del_admin = crear_gasto(client, admin, categoria_id).json()["id"]
    del_miembro = crear_gasto(client, miembro, categoria_id).json()["id"]
    # el miembro no toca lo del admin
    assert client.patch(f"/api/movimientos/{del_admin}", headers=miembro, json={"monto": 1}).status_code == 403
    assert client.post(f"/api/movimientos/{del_admin}/anular", headers=miembro, json={}).status_code == 403
    # el admin edita y anula lo del miembro
    assert client.patch(f"/api/movimientos/{del_miembro}", headers=admin, json={"monto": 7}).status_code == 200
    assert client.post(f"/api/movimientos/{del_miembro}/anular", headers=admin, json={}).status_code == 200


def test_aislamiento_entre_familias(client, admin, categoria_id):
    from tests.conftest import registrar

    mid = crear_gasto(client, admin, categoria_id).json()["id"]
    otro = registrar(client, email="otro@t.com", familia="Otra")
    assert client.get("/api/movimientos", headers=otro).json() == []
    assert client.post(f"/api/movimientos/{mid}/anular", headers=otro, json={}).status_code == 404
