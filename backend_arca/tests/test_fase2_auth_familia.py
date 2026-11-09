from tests.conftest import registrar


def test_registro_login_yo(client):
    r = client.post("/api/auth/registro", json={"nombre": "Ana", "email": "ana@t.com", "password": "secreto1"})
    assert r.status_code == 201
    assert r.json()["usuario"]["rol"] == "admin"
    assert r.json()["usuario"]["familia_nombre"] == "Familia de Ana"

    login = client.post("/api/auth/login", json={"email": "ana@t.com", "password": "secreto1"})
    assert login.status_code == 200
    h = {"Authorization": f"Bearer {login.json()['access_token']}"}
    yo = client.get("/api/auth/yo", headers=h)
    assert yo.status_code == 200 and yo.json()["email"] == "ana@t.com"


def test_registro_email_duplicado_y_login_malo(client, admin):
    r = client.post("/api/auth/registro", json={"nombre": "X", "email": "admin@t.com", "password": "secreto1"})
    assert r.status_code == 409
    assert client.post("/api/auth/login", json={"email": "admin@t.com", "password": "mala"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "nadie@t.com", "password": "secreto1"}).status_code == 401


def test_sin_token_no_entra(client):
    assert client.get("/api/auth/yo").status_code == 401
    assert client.get("/api/movimientos").status_code == 401
    assert client.get("/api/auth/yo", headers={"Authorization": "Bearer falso"}).status_code == 401


def test_categorias_iniciales(client, admin):
    nombres = [c["nombre"] for c in client.get("/api/categorias", headers=admin).json()]
    assert nombres == ["Transporte", "Comida", "Antojos", "Servicios", "Gasolina", "Otros"]


def test_invitar_y_listar_miembros(client, admin, miembro):
    miembros = client.get("/api/familia/miembros", headers=miembro).json()
    assert [(m["email"], m["rol"]) for m in miembros] == [("admin@t.com", "admin"), ("m@t.com", "miembro")]


def test_miembro_no_puede_invitar_ni_crear_categorias(client, miembro):
    r = client.post("/api/familia/invitar", headers=miembro, json={"nombre": "Z", "email": "z@t.com", "password": "secreto1"})
    assert r.status_code == 403
    assert client.post("/api/categorias", headers=miembro, json={"nombre": "Ropa"}).status_code == 403


def test_admin_crea_y_edita_categorias(client, admin):
    r = client.post("/api/categorias", headers=admin, json={"nombre": "Ropa", "icono": "shirt"})
    assert r.status_code == 201
    cid = r.json()["id"]
    assert client.post("/api/categorias", headers=admin, json={"nombre": "ropa"}).status_code == 409
    p = client.patch(f"/api/categorias/{cid}", headers=admin, json={"activa": False})
    assert p.status_code == 200 and p.json()["activa"] is False


def test_familias_aisladas(client, admin):
    otro = registrar(client, email="otro@t.com", familia="Otra")
    ids_otro = [c["id"] for c in client.get("/api/categorias", headers=otro).json()]
    assert client.patch(f"/api/categorias/{ids_otro[0]}", headers=admin, json={"nombre": "Hack"}).status_code == 404


def test_correos_arca_test_del_seed(client):
    """El seed usa @arca.test: debe poder registrarse y entrar en desarrollo."""
    r = client.post("/api/auth/registro", json={"nombre": "A", "email": "admin@arca.test", "password": "Prueba123"})
    assert r.status_code == 201
    assert client.post("/api/auth/login", json={"email": "admin@arca.test", "password": "Prueba123"}).status_code == 200
