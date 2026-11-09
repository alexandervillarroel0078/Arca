# NOTAS

## Decisiones tomadas (datos que faltaban en el SPEC)
- SQLAlchemy 2.0 sincrono + psycopg2 (lo mas simple).
- Python 3.10 del sistema; entorno virtual en `backend_arca/.venv`.
- PostgreSQL 16 ya corre como servicio (puerto 5432). Se necesita su contrasena para crear la BD `arca` y `arca_test`.

Fase 1: bloqueada, falta la contrasena de PostgreSQL (modelos, alembic y entorno listos; faltan crear BD y correr migraciones).

## Seed de datos de prueba (solo desarrollo)
- Correr, desde `backend_arca/` con el venv y las migraciones aplicadas: `.venv\Scripts\python.exe -m app.seed`
- Idempotente (no duplica). Se niega a correr si `ENTORNO=produccion` (variable de entorno o `.env`).
- Familia: "Familia Prueba". Clave de todos: `Prueba123`
  - admin@arca.test (admin), miembro1@arca.test, miembro2@arca.test
- Crea las 6 categorias, 15 movimientos del mes actual (3 ingresos, 12 gastos, notas con prefijo `[seed]`) y 3 apoyos:
  Tia Rosa (Pendiente), Hermano Luis (Saldado), Primo Pedro (Cerrado).
- Las fechas se limitan al mes actual (nunca antes del dia 1).
- Requiere que las tablas existan (Fase 1). Aun NO se ha ejecutado contra la BD (Fase 1 bloqueada por la contrasena).

Fase 1: terminada (migracion 0001 aplicada en arca2, 7 tablas verificadas, seed corrido dos veces sin duplicar; la BD usa el usuario arca_user).

## Decisiones del backend (Fases 2-5)
- Un usuario pertenece a una sola familia. "Invitar" = el admin crea la cuenta del miembro con una clave temporal (no hay correo).
- Login por JSON `{email, password}` (no formulario OAuth2). Token JWT HS256, 24 h.
- Montos salen como numero en JSON; se aceptan hasta 2 decimales, mayores a 0.
- Gasto exige categoria; ingreso no lleva categoria. Apoyo/devolucion no se guardan en `movimientos` (tablas propias).
- Una devolucion no puede superar el pendiente. "Consumir" falla si no hay pendiente.
- Resumen del mes: apoyos y consumido se asignan al mes de la fecha del apoyo; las devoluciones al mes de su propia fecha.
  El consumido no cambia el saldo de efectivo (el dinero ya salio como apoyo); se suma aparte en `gasto_familiar_total`.
- `/apoyos/resumen` agrupa por beneficiario ignorando mayusculas.
- Pruebas: `.venv\Scripts\python.exe -m pytest tests` (usan solo `arca_test`; se recrea el esquema con create_all).

Fase 2: terminada (8 pruebas).
Fase 3: terminada (7 pruebas).
Fase 4: terminada (8 pruebas: Pendiente, Saldado, Cerrado).
Fase 5: terminada (7 pruebas con datos de ejemplo). Total backend: 30 pruebas pasan.

Fase 6: terminada (flujo completo verificado en Edge a 390px: registro, ingreso, gasto, apoyo, devolucion, consumir, salir/entrar; tsc y build sin errores).
- Nota Fase 6: el validador de correos rechaza dominios reservados (.test); en desarrollo se activa `email_validator.TEST_ENVIRONMENT` para que `@arca.test` del seed funcione. Con `ENTORNO=produccion` no se activa.
- Nota Fase 6: "Registrar devolucion" / "Marcar consumido" en la tarjeta de un beneficiario se reparten entre sus apoyos con saldo, del mas antiguo al mas nuevo (la API trabaja por apoyo).

Fase 7: terminada (manifest + iconos PNG + service worker verificados; registro sin internet probado en Edge: 2 registros en cola, sincronizados al volver la conexion, sin duplicados).
- Nota Fase 7: "instalable" = manifest valido (standalone, iconos 192/512/maskable) + service worker activo, comprobado en Edge sin interfaz; el boton "Instalar" real hay que probarlo en el telefono (en HTTPS o localhost; en la red local por HTTP el navegador del telefono NO ofrece instalar).
- Nota Fase 7: la cola offline vive en localStorage (`arca-cola`). Si el servidor rechaza un registro (dato invalido) se descarta con aviso; si falla por red/401/500 queda en cola. Posible duplicado si el servidor guardo pero la respuesta se perdio (sin id de idempotencia; aceptado en v1).
- Nota Fase 7: las categorias se guardan en localStorage para poder registrar gastos sin internet. Inicio, Apoyos y Reportes necesitan conexion (no se cachean datos de la API).

Fase 8: terminada (Reportes y Familia verificados en Edge: totales del seed, mes anterior, crear/renombrar/ocultar categoria, agregar miembro, vista de solo lectura para miembro, navegacion de las 4 secciones, sin errores JS).

## Como levantar todo (desarrollo)
0. Configuracion (Fase 13): solo variables de entorno; en desarrollo sirve un `backend_arca/.env` copiado de `.env.example` (opcional, nunca se versiona). Produccion: ver `DESPLIEGUE.md`.
1. Backend (desde `backend_arca/`): `.venv\Scripts\alembic.exe upgrade head` y luego `.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000 --reload` (docs en http://localhost:8000/docs).
2. Datos de prueba (opcional): `.venv\Scripts\python.exe -m app.seed`.
3. Frontend (desde `web_arca/`): `npm install`, copiar `.env.example` a `.env` si hace falta, `npm run dev` (http://localhost:5173; desde el telefono usa la IP del PC y el puerto 5173).
4. PWA/offline: `npm run build` y `npm run preview` (el service worker solo funciona en la version compilada).
5. Pruebas: ver la seccion "Como correr las pruebas" (Fase 11): backend `pytest`, frontend `npm test` y `npm run test:e2e`.

## Pendiente / limitaciones conocidas
- No hay pruebas automaticas del frontend en el repo; se verifico con scripts de navegador (Edge) fuera del proyecto.
- Instalar la PWA en un telefono real requiere HTTPS (o localhost); no probado.
- Sin edicion/borrado de movimientos, apoyos ni devoluciones desde la interfaz (la API de movimientos si lo permite).
- Sin lista completa de movimientos con filtros en la interfaz (Inicio muestra los ultimos 8 del mes).
- Cola offline sin id de idempotencia (posible duplicado en un corte de red justo al responder).
- Un usuario = una familia. Invitar = crear la cuenta con clave temporal (sin correo ni cambio de clave).
- `JWT_SECRET` del `.env` es de desarrollo: cambiarlo antes de publicar.


## Fase 9 - Correcciones, anulacion y administracion
Migracion `0002` (aplicada en arca2; subir/bajar/subir verificado): `anulado`, `anulado_por`, `anulado_en`, `motivo_anulacion`, `editado_por`, `editado_en`, `uuid_cliente` (unico) en movimientos, apoyos y devoluciones; `devoluciones.usuario_id` y `devoluciones.anulada_con_apoyo`; `miembros.activo`.
No existe ningun `DELETE` en la API (hay una prueba que recorre todas las rutas y otra que confirma el 405).

Endpoints nuevos: `POST /movimientos|apoyos/{id}/anular|reactivar`, `POST /apoyos/{id}/devoluciones/{did}/anular|reactivar`, `PATCH /apoyos/{id}`, `PATCH /apoyos/{id}/devoluciones/{did}`, `POST /apoyos/{id}/reabrir`, `GET /movimientos/{id}`, `GET /apoyos/{id}`, `GET /actividad` (lista unificada con filtros y paginacion), `PATCH /familia/miembros/{usuario_id}`, `POST /familia/miembros/{usuario_id}/restablecer-clave`, `PATCH /auth/yo`, `POST /auth/cambiar-clave`.

### Reglas que decidi por mi cuenta
- **Estado "Anulado"**: un apoyo anulado se muestra con estado `Anulado` y devuelto/consumido/pendiente en 0; no entra en ningun total.
- **Cascada**: al anular un apoyo sus devoluciones activas se marcan `anulada_con_apoyo`. Al reactivar el apoyo vuelven solo esas; las que se anularon antes, por separado, NO vuelven.
- **Permisos de devoluciones**: cualquier miembro puede REGISTRAR una devolucion en un apoyo de la familia (quien recibe el dinero puede no ser quien lo entrego). Editar/anular/reactivar una devolucion: quien la registro o un admin (en filas antiguas sin autor, el dueno del apoyo).
- **Consumir y reabrir** un apoyo cuentan como editar el apoyo: solo su dueno o un admin. Antes de la Fase 9 cualquier miembro podia consumir; ahora no.
- **Editar apoyo/devolucion**: no se permite sobre registros anulados (primero se reactivan). Un movimiento puede conservar una categoria desactivada al editarlo, pero no se puede elegirla de nuevo; crear un gasto con categoria desactivada da 422.
- **Cambiar tipo** de un movimiento: gasto->ingreso borra la categoria sola; ingreso->gasto exige categoria. Un apoyo no se convierte en gasto ni al reves.
- **Miembros**: "ultimo admin" = ultimo admin ACTIVO; no se puede desactivarlo ni pasarlo a miembro. Un admin puede cambiarse el rol o desactivarse a si mismo solo si queda otro admin activo. Un miembro desactivado recibe 403 al entrar y 401 con su token anterior (se le cierra la sesion). Sigue apareciendo en la lista, en reportes por persona y en sus movimientos.
- **Restablecer clave**: el servidor genera una clave temporal aleatoria y la muestra una sola vez al admin (no se guarda en claro). El miembro la cambia en su perfil.
- **Cambiar clave con la actual incorrecta** responde 400 (no 401) para que la interfaz no cierre la sesion.
- **Idempotencia**: `uuid_cliente` se busca dentro de la familia; si existe se devuelve el registro (HTTP 200 en vez de 201) SIN modificarlo, aunque este anulado. El cliente genera el UUID al enviar y lo guarda en la cola offline, asi que un reintento reutiliza el mismo. Sin UUID siempre crea (compatibilidad). En `crypto.randomUUID` no disponible (http por red local) se usa `getRandomValues`.
- **Devoluciones desde Apoyos**: la interfaz reparte "Registrar devolucion" entre los apoyos del beneficiario (mas antiguo primero), cada una con su propio UUID; esas llamadas no pasan por la cola offline.
- **Lista completa** (`/todos`): mezcla movimientos y apoyos, 20 por pagina con boton "Cargar mas" (no scroll infinito). Las devoluciones se gestionan en la pantalla Apoyos, no en la lista.
- **Avisos**: solo se muestra el mas reciente; "Anulado. Reactivar" dura 8 s.
- El seed no se toco (inserta directo y las columnas nuevas tienen valor por defecto).

Fase 9: terminada (59 pruebas de backend pasan, 28 son nuevas; flujo crear/editar/anular/reactivar verificado en Edge a 390px para movimientos, apoyos y devoluciones, mas categorias, miembros y perfil; menus de 44x44 y sin desborde horizontal).

### Pendiente tras la Fase 9
- No hay pruebas automaticas del frontend en el repo (se verifico con scripts de navegador fuera del proyecto).
- Registrar/editar devoluciones, categorias y miembros requiere conexion (solo movimientos y apoyos nuevos usan la cola offline). Editar/anular tampoco funcionan sin internet.
- Auditoria: solo se guarda el ultimo editor y la ultima anulacion de cada registro, no un historial completo de cambios.
- Un usuario sigue perteneciendo a una sola familia; no hay "recuperar mi clave" sin admin.


## Fase 10 - Historial completo
Migracion `0003` (aplicada en arca2; subir/bajar/subir verificado sobre la tabla recien creada y vacia): tabla `historial` (id, familia_id, entidad, entidad_id, accion, usuario_id, fecha, cambios JSONB, motivo) con indices, y un **trigger** `historial_inmutable` que hace fallar cualquier UPDATE o DELETE ("El historial es de solo agregar"). El trigger tambien se crea con `create_all` (pruebas) mediante un evento DDL del modelo.
No hay ninguna ruta que edite o borre historial: solo `GET /api/historial` (prueba que recorre las rutas, prueba de 405 y prueba directa del trigger contra `arca_test`).

Endpoints: `GET /api/historial?entidad=&entidad_id=` (cadena de un registro, cronologica, cualquier miembro de la familia) y `GET /api/historial` (global, solo admin, mas reciente primero, filtros entidad/accion/usuario/desde/hasta y paginacion `limite`/`desplazamiento`). Ambos siempre limitados a la familia de quien consulta.

Interfaz: "Ver historial" en el menu "..." de cada fila de la lista completa (movimientos y apoyos) y en cada apoyo y devolucion de la pantalla Apoyos; pantalla "Actividad de la familia" (`/familia/actividad`, enlace dentro de Familia, solo admin; un miembro que entre por URL vuelve a Familia).

### Reglas que decidi por mi cuenta
- **Misma transaccion**: `historial.registrar()` solo hace `db.add` y cada servicio la llama justo antes de su unico `commit`; si falla el historial (excepcion o error real de la base) se revierte tambien el cambio. Hay pruebas de las dos formas, sobre 15 operaciones.
- **Que se registra**: toda operacion de la API que modifica datos: registro, invitar, editar perfil, cambiar clave, cambiar rol, desactivar/reactivar miembro, restablecer clave, crear/editar/desactivar/reactivar categoria, crear/editar/anular/reactivar movimiento, crear/editar/anular/reactivar/consumir/reabrir apoyo, y crear/editar/anular/reactivar devolucion. **No se registra**: el login (no cambia datos), los GET, las operaciones rechazadas (403/400/404/422), ni el reenvio de un registro con el mismo `uuid_cliente` (el servidor devuelve el existente sin tocar nada, incluso si esta anulado).
- **Cascada**: anular un apoyo deja 1 entrada del apoyo + 1 por cada devolucion que estaba activa (motivo "Anulada junto con el apoyo"). Las devoluciones anuladas aparte antes no se tocan ni se registran. Al reactivar: 1 del apoyo + 1 por cada devolucion que vuelve (motivo "Reactivada junto con el apoyo").
- **Entidades**: `miembro` y `usuario` usan como `entidad_id` el id del usuario. Invitar y registrarse dejan dos entradas (usuario crear + miembro crear). Las 6 categorias iniciales dejan una entrada cada una (motivo "Categoria inicial").
- **Formato de `cambios`**: `campo: {antes, despues}`; dinero como texto con 2 decimales ("45.00"), fechas ISO, categoria por NOMBRE (no por id) para que el historial se entienda solo. En una creacion `antes` es null. En cambios de clave solo `{"clave": "clave cambiada"}`.
- **Sin secretos**: `registrar()` lanza error si se le pasa `password`, `password_hash`, `token`, `clave_nueva`... como campo (solo admite el texto fijo "clave cambiada"). Una prueba hace un volcado de todo el historial tras registrar, invitar, cambiar y restablecer claves y verifica que no aparece ninguna clave, la temporal, hashes (`$2b$`) ni JWT.
- **Ediciones sin cambio real**: editar un movimiento/apoyo/devolucion con los mismos valores deja una entrada `editar` con `cambios` vacio (y actualiza `editado_por/en`, como antes). En categorias, miembros y perfil, un PATCH sin cambio real no registra nada.
- **Un PATCH, varias acciones**: en miembros, cambiar rol y activo en la misma llamada deja dos entradas (`cambiar_rol` y `desactivar`/`reactivar`). En categorias, un PATCH que cambia `activa` y ademas el nombre deja una sola entrada (`desactivar`/`reactivar`) con ambos cambios.
- **Quien ve que**: cualquier miembro puede ver la cadena de cualquier registro de su familia (en Fase 9 ya todos veian todo), incluidas categorias, miembros y usuarios; la actividad global solo el admin. Otra familia recibe lista vacia (no 404, para no revelar si el id existe).
- **Orden**: la cadena va de mas antiguo a mas nuevo; la global, al reves. Las entradas de una misma peticion comparten `fecha` (la hora de la transaccion en PostgreSQL) y se ordenan por `id`.
- **FK sin cascada**: `historial.familia_id/usuario_id` no tienen `ON DELETE CASCADE` (de todos modos el trigger impediria borrar).
- La semilla (`python -m app.seed`) inserta directo en las tablas, asi que sus datos NO tienen historial.

### Registros anteriores a la Fase 10
Todo lo creado o modificado antes de esta fase (incluidos los datos de prueba de `arca2`) **no tiene historial previo y no se inventa**: el historial empieza con la primera operacion posterior a la migracion `0003`. En la interfaz, "Ver historial" de uno de esos registros muestra "Sin historial: este registro es anterior a la funcion de historial" hasta que alguien lo modifique.

Fase 10: terminada (82 pruebas de backend pasan: 59 anteriores + 23 nuevas; verificado en Edge a 390px: editar, anular y reactivar un movimiento y ver su historial (quien, cuando, "Monto: Bs 45.00 -> Bs 60.00", motivo), cascada de un apoyo visible en el historial de su devolucion, vista de miembro sin actividad global, actividad global del admin con filtros y paginacion, "clave cambiada" sin ninguna clave; 29 comprobaciones nuevas, y los flujos de las fases 6 y 9 repetidos sin fallos).

### Pendiente tras la Fase 10
- "Ver historial" solo existe para movimientos, apoyos y devoluciones; el historial de categorias, miembros y usuarios se ve solo en la actividad global del admin.
- La actividad global no tiene filtro por fechas en la interfaz (la API si acepta `desde` y `hasta`).
- No se registran los inicios de sesion ni las consultas.
- El trigger impide editar/borrar desde la API y desde SQL normal, pero un superusuario de PostgreSQL podria desactivarlo (`ALTER TABLE historial DISABLE TRIGGER`); no hay firma ni cadena de hashes que detecte manipulacion directa.
- Bajar la migracion `0003` (`alembic downgrade`) borra la tabla y todo su historial: usarlo solo en desarrollo y nunca con historial real.
- Sigue sin haber pruebas automaticas del frontend en el repo.

## Regla para las pruebas (historial)
- `historial` tiene un trigger que rechaza UPDATE y DELETE. La limpieza de datos en `arca_test` usa SOLO `TRUNCATE ... CASCADE` o recrear el esquema (`drop_all`/`create_all`), nunca DELETE. No se debilita ni se quita el trigger para facilitar las pruebas (esta anotado tambien en `tests/conftest.py`).

## Fase 11 - Pruebas automaticas del frontend
Esta fase solo agrega pruebas. El unico cambio en el codigo de la app fue un arreglo de una carrera que encontraron las pruebas (ver abajo); no cambia el comportamiento.

### Como correr las pruebas
Se corren EN SERIE: el backend (`pytest`) y las E2E usan la misma base `arca_test` y no deben correr a la vez. Nunca tocan `arca2` ni `arca`.
- **Backend** (desde `backend_arca/`): `.venv\Scripts\python.exe -m pytest tests` -> 177 pruebas (82 hasta la Fase 11 + 29 de la Fase 12 + 66 de la Fase 13).
- **Frontend unitarias y de componentes** (desde `web_arca/`): `npm test` (Vitest + Testing Library + jsdom; `npm run test:watch` para modo vigilancia) -> 338 pruebas en 26 archivos (`src/**/*.test.ts(x)`; 213 en 19 hasta la Fase 11, 303 en 23 hasta la Fase 12). No necesitan servidor ni base de datos.
- **Frontend extremo a extremo** (desde `web_arca/`): `npm run test:e2e` (Playwright, 390x844) -> 66 pruebas en 10 archivos (`web_arca/e2e/*.spec.ts`; 54 en 9 hasta la Fase 11) + 3 de la app compilada (`npm run test:pwa`, Fase 13). Levanta SOLO el backend de prueba (puerto 8199, base `arca_test`) y el frontend (puerto 5299); no hace falta arrancar nada antes y no choca con `npm run dev` ni con el backend normal. Pide que Microsoft Edge este instalado (se usa el instalado, no se descarga nada); con `PW_CHANNEL=chrome` usa Chrome y con `PW_CHANNEL=chromium` el Chromium de Playwright (requiere `npx playwright install chromium`). En caso de fallo deja capturas y trazas en `web_arca/test-results/` (`npx playwright show-trace <trace.zip>`). Un solo archivo: `npx playwright test e2e/apoyos.spec.ts`; una sola prueba: `-g "texto del titulo"`.
- **Todo el frontend**: `npm run test:todo` (unitarias y despues E2E).
- Typecheck: `npx tsc` (app y pruebas unitarias) y `npx tsc -p e2e/tsconfig.json` (E2E).

### Que cubre
- **Unitarias/componentes**: formato de moneda y fechas, UUID (incluido el respaldo sin `crypto.randomUUID`), cliente HTTP (cabeceras, errores, 401), sesion (login, registro, token vencido, sin internet), cola de registros sin internet (orden, UUID reutilizado, corte a la mitad, descartar rechazados, no sincronizar dos veces), sincronizador, formularios Nuevo/Editar (validaciones, coma decimal, categorias activas, edicion), Apoyos (estados Pendiente/Saldado/Cerrado/Anulado, totales, barra de progreso, reparto de devoluciones entre apoyos, consumir, menu "..." por rol), lista completa (permisos del menu, anulados, filtros, paginacion, anular con advertencia de devoluciones), Inicio (saldo y desglose, aviso de pendientes, cola), Familia (permisos admin/miembro, miembros, categorias, perfil), Reportes, historial y actividad global, avisos, dialogo de anular y menu "...".
- **E2E**: login y registro; crear gasto/ingreso (meta de 5 s) y validaciones; apoyo, devolucion, consumir y reabrir; editar; anular y reactivar (movimientos, apoyos con cascada y devoluciones); miembro sin permiso sobre lo del admin (interfaz Y 403 directo en la API); ver historial y actividad global; Familia (categorias, miembros, ultimo admin, restablecer clave, perfil); reportes; registro sin internet con `context.setOffline`, sincronizacion sin duplicados (incluida la **respuesta perdida**: el servidor guarda pero la app no lo sabe, y el reintento con el mismo UUID no duplica).
- Los scripts de verificacion que estaban fuera del proyecto (carpeta temporal) se trajeron al repo como estas pruebas, reescritos con Playwright Test y ampliados.

### Decisiones mias
- **Backend de pruebas aparte**: `backend_arca/e2e/servidor.py` (NO es parte de la app): reutiliza `app.main.app` pero fuerza `TEST_DATABASE_URL`, se niega a arrancar si la base no es exactamente `arca_test` (doble comprobacion, tambien sobre la conexion real) y agrega rutas `/__e2e__/...` que no existen en la app real: `base` (nombre de la base), `reset` (vaciar) y `movimiento-sin-historial` (inserta un movimiento directo en la tabla para simular un registro anterior a la Fase 10).
- **Limpieza**: antes y despues de CADA prueba una fixture automatica llama a `reset`, que hace `TRUNCATE ... CASCADE`; al arrancar se recrea el esquema (`drop_all`/`create_all`). **Nunca DELETE** (el trigger de `historial` no se toca). La fixture tambien verifica en cada prueba que el servidor este en `arca_test`. Cada prueba crea sus propios usuarios y datos (correos unicos).
- **Una sola base compartida** -> `workers: 1` y `retries: 0` (sin reintentos para no esconder pruebas inestables).
- **Servidor de desarrollo de Vite** para las E2E (no la version compilada): el service worker/PWA no se prueba ahi.
- **Pruebas unitarias**: se mockean los modulos `api.ts` de cada dominio (salvo en las de `core/api`); `vitest.config.ts` es aparte para no cargar el plugin PWA; `restoreMocks` activo y `window.confirm` aceptado por defecto. El saldo, los totales y los estados los calcula el servidor: el frontend solo los muestra y calcula pequenas piezas (barra de progreso, reparto FIFO de una devolucion, suma al consumir); esas piezas se prueban en unitarias y la exactitud de los numeros de punta a punta se comprueba en las E2E contra el backend real y en las 82 pruebas del backend.
- **"Inicio" no muestra "Salir" sin conexion** (cuando no puede cargar solo muestra el error y el boton +). Es el comportamiento actual y no lo cambie; la prueba de salir con pendientes simula solo la caida de los envios.

### Inestabilidades encontradas y como se arreglaron (no se quito ninguna prueba)
1. **Carrera real de la app (arreglada en `PaginaNuevo.tsx`)**: en desarrollo `main.tsx` usa `StrictMode`, que ejecuta los efectos dos veces; el efecto que carga el registro a editar no cancelaba la primera ejecucion y su respuesta tardia podia pisar el monto que el usuario ya habia escrito (la E2E "editar, anular y reactivar" fallo 1 vez de ~60). Ahora el efecto se cancela al desmontarse (`vivo`), sin cambiar nada mas. Hay una prueba unitaria que reproduce la carrera y falla sin el arreglo (verificado quitandolo).
2. Pruebas que usaban el menu "..." justo despues de marcar "Ver anulados", sobre la pantalla vieja: ahora esperan los datos nuevos.
3. El ayudante que cierra el menu tocaba el centro del fondo, tapado por la lista de opciones: ahora toca una esquina.
4. Un `beforeEach` en forma de flecha devolvia el mock y Vitest lo ejecuta como limpieza: ahora usa llaves.
Criterio cumplido: backend 82/82; unitarias 213/213 dos pasadas seguidas; E2E 54/54 tres pasadas seguidas despues del arreglo (y una pasada previa completa sin fallos).

Fase 11: terminada.

### Sin cubrir (Fase 11)
- PWA: manifest, service worker, instalacion y apertura sin internet con la app compilada (se verifico a mano en la Fase 7; no esta automatizado).
- Solo el ancho de 390px y solo Edge (Chromium); no hay Firefox/Safari ni telefonos reales ni gestos tactiles reales.
- Sin pruebas de accesibilidad automaticas (solo roles/etiquetas usados por los selectores), de rendimiento ni de comparacion visual.
- ~~Carreras entre dos usuarios editando a la vez lo mismo, y los 30 s del reintento automatico de la cola~~ -> cubiertos en la Fase 12 (conflicto entre dos navegadores y reintento automatico con `page.clock`).
- Las pruebas E2E dependen de tener Microsoft Edge instalado (o de configurar `PW_CHANNEL`).


## Fase 12 - Editar y anular sin internet
Antes de empezar se corrieron TODAS las pruebas y pasaban: backend 82/82, unitarias 213/213, E2E 54/54. No se rehizo nada que ya funcionaba.

### Que se construyo
**Backend** (migracion `0004`, aplicada en `arca2`; subir/bajar/subir verificado sobre `arca_test`, trigger de `historial` intacto: solo se AGREGAN columnas):
- `version` (entero, empieza en 1) en `movimientos`, `apoyos` y `devoluciones`. Sube **una sola vez por transaccion** a cada registro que realmente cambia (evento `before_flush`), incluida la cascada de anular/reactivar un apoyo (sus devoluciones tambien suben). Registrar una devolucion NO sube la version del apoyo (no provoca conflictos falsos al editarlo). `consumir`/`reabrir` si la suben.
- Editar, anular y reactivar reciben `version_base` (en el cuerpo; en reactivar el cuerpo es opcional). Si no coincide: **409** con `{codigo: "conflicto_version", mensaje, version_actual, version_base, actual}`; `actual` es el registro tal como esta en el servidor. Sin `version_base` (clientes anteriores) no se valida. Los registros se bloquean con `SELECT ... FOR UPDATE` al modificarlos: dos cambios simultaneos con la misma version -> uno gana y los demas reciben 409 (hay prueba con 6 hilos).
- Idempotencia por **operacion**: cabecera `X-Operacion-Id` (UUID). La operacion se registra en el propio `historial` (columna `uuid_operacion`, indice unico parcial por familia/operacion/entidad/registro/accion) en la MISMA transaccion que el cambio, asi que no hay un estado aparte que pueda quedar desincronizado. Si llega otra vez, el servidor devuelve el registro actual (200) sin tocar nada; esa comprobacion va ANTES de la de version (un reenvio por respuesta perdida no es un conflicto). Los permisos se validan antes que todo.
- Cabecera `X-Fecha-Cliente` (ISO): se guarda en `historial.fecha_cliente`, aparte de `fecha` (sincronizacion). Si no es una fecha da 422; una fecha **futura** (mas de 5 min) se reemplaza por la hora del servidor. Una fecha pasada se acepta tal cual: es justo lo que pasa sin internet.
- Crear acepta `anulado`, `motivo_anulacion` y `fecha_cliente_anulacion` (movimientos, apoyos y devoluciones): un registro creado y anulado sin internet sale en UNA operacion (dos entradas de historial: crear y anular).
- Las salidas de movimientos, apoyos y devoluciones incluyen `version` y `uuid_cliente`; la lista completa (`/actividad`) ademas `devuelto` y `consumido` de cada apoyo.

**Frontend** (`web_arca/src/modulos/sync/`; las funciones de `api.ts` de cada dominio conservan sus firmas: por debajo ahora usan la cola y el cache):
- `core/almacen.ts`: IndexedDB `arca-offline` con cinco almacenes (`cola`, `rechazos`, `cache`, `entidades`, `meta`); si IndexedDB no existe usa memoria.
- `cola.ts`: cola en orden, fusion, envio, conflictos, rechazos. `superponer.ts`: aplica la cola sobre lo ultimo del servidor (listas y totales). `cache.ts` y `lecturas.ts`: ultima respuesta correcta de cada pantalla. `BarraSync.tsx`: indicador y panel "Cambios pendientes". `Sincronizador.tsx`: sincroniza al abrir, al volver la conexion y **cada 30 s** mientras haya pendientes. `sesion.ts`: seguridad.
- Pantallas con copia: Inicio (resumen y movimientos), Apoyos (resumen y lista), Lista completa (cada pagina vista), Reportes (las 4 lecturas), Familia (categorias y miembros), Nuevo/Editar (categorias y el registro a editar).

### Reglas que decidi por mi cuenta
- **Todas** las escrituras de movimientos/apoyos/devoluciones pasan por la cola, tambien con conexion: se envian al instante y quien las pidio recibe la respuesta real. Con conexion, un rechazo se muestra como error en el momento (como antes) y NO va a la lista "No se pudo sincronizar" (el usuario ya lo vio); un rechazo durante una sincronizacion en segundo plano SI va a la lista y queda hasta que el usuario toca "Entendido".
- **Fusion** solo cuando lo unico pendiente de ese registro es su creacion, esa creacion todavia no salio hacia el servidor y NADA depende de ella (p. ej. una devolucion de un apoyo creado sin internet). Si algo depende, se encolan aparte para respetar el orden (si no, la cascada de anular un apoyo con devolucion pendiente se perderia). Editar una creacion ya anulada, anular dos veces o reactivar lo no anulado dan el mismo error que el servidor.
- **Version base encadenada**: si ya hay otra operacion pendiente sobre el mismo registro, la nueva no sabe en que version quedara el registro; usa la que dejo la anterior al aplicarse (guardada en la copia local). La primera operacion usa la version que el usuario vio.
- **Conflicto**: la operacion queda "en conflicto" (no se reintenta sola) y bloquea lo que sigue sobre ese mismo registro; las de otros registros siguen. La version del servidor pasa a ser la base local. "Usar la mía" la reenvia con la version actual del servidor (puede volver a chocar si hubo otro cambio); "Usar la del servidor" descarta esa operacion **y lo que el usuario hizo despues sobre ese mismo registro** (se basaba en ella). Anular tambien puede estar en conflicto.
- **Rechazos**: los 4xx (menos 401, 408, 429 y el 409 de version) se rechazan; 401, 5xx, 408 y 429 conservan la cola y se reintentan. Si se rechaza una creacion, lo que dependia de ella se rechaza tambien ("Depende de un registro que no se pudo sincronizar"). No cambie codigos de estado: una devolucion superior al pendiente sigue siendo 400, permisos 403, datos invalidos 422.
- **Id temporal**: un registro creado sin internet se muestra con id negativo (`-seq` de su operacion); ese id sigue llevando al registro real despues de sincronizar (se recuerda el id del servidor).
- **Totales sin conexion son una estimacion**: se suma/resta lo que cambia cada operacion pendiente (Inicio: saldo, ingresos, gastos, apoyos entregados, devoluciones, pendientes; Apoyos: totales y estado por beneficiario). Aproximado: la cantidad de personas con apoyo pendiente en Inicio, y un apoyo conocido solo por la lista completa (sin sus devoluciones) asigna lo devuelto al mes del apoyo. Al sincronizar se muestran los numeros del servidor. **Reportes** muestra la copia guardada (con un aviso de que el resumen incluye lo pendiente; categorias, personas y meses no).
- **Lecturas y envio no se solapan**: una lectura nunca ocurre mientras se envia la cola ni al reves (un dato leido del servidor jamas incluye una operacion que aun figura como pendiente: asi no se cuenta dos veces).
- **Consumir y reabrir un apoyo siguen necesitando conexion** (no estaban en el alcance) y se niegan si ese apoyo tiene cambios sin enviar. Categorias, miembros, perfil y claves tambien necesitan conexion (solo se guarda copia de su lectura).
- **Cerrar sesion** (boton Salir) borra TODO lo guardado: cache, registros conocidos, cola y rechazos (si hay pendientes pide confirmar, como antes). Si la sesion **vence** (401), se borra el cache pero se CONSERVA la cola (son cambios del usuario que no deben perderse en silencio); si despues entra **otra cuenta** en el mismo aparato, se descarta lo de la anterior con un aviso ("Se descartaron N cambio(s) sin enviar de otra cuenta") y nunca se envia a nombre de otro.
- Los textos nuevos que pidio el SPEC llevan tilde ("Datos de hace X min, sin conexión", "Usar la mía", "Sincronizar ahora"); el resto de la interfaz sigue sin tildes.
- El aviso "Datos de hace X..." habla solo de la pantalla que se esta viendo (se reinicia al cambiar de pantalla).
- La cola vieja (localStorage `arca-cola`) ya no se lee. Un telefono con registros en esa cola de la version anterior los perderia al actualizar (no hay migracion: v1 aun no esta en uso real; la clave se borra al cerrar sesion).

### Pruebas
- Backend: `tests/test_fase12_offline.py` (29): version (sube una vez por transaccion, cascada, no sube al devolver), 409 en movimientos/apoyos/devoluciones (editar, anular, reactivar) sin tocar nada ni el historial, conflicto entre dos usuarios, permisos antes que version, concurrencia (6 hilos), idempotencia por operacion (editar, anular, reactivar, cascada, devoluciones), UUID de operacion invalido, orden de aplicacion, creacion ya anulada, `fecha_cliente` (guardada aparte, futura se corrige, invalida 422, compartida por la cascada) y el trigger de solo-agregar sigue rechazando UPDATE/DELETE tambien sobre las columnas nuevas.
- Unitarias (`src/modulos/sync/*.test.ts` y ajustes en Inicio, Reportes, AuthContext e historial): cola (fusion, orden, conflicto, rechazo, reintento, version encadenada, referencias temporales), superposicion (listas y totales), barra y panel (conflicto con ambas versiones, rechazos, datos de cache), sesion (borrado al salir, sesion vencida, otra cuenta), lecturas y escrituras de dominio sin conexion, y **reintento automatico cada 30 s** con reloj falso. Se verifico a mano que las pruebas fallan si se rompe la fusion o el 409.
- E2E (`e2e/sin-conexion.spec.ts`, 12): crear/editar/anular sin conexion con fusion y totales correctos sin duplicados; apoyo + devolucion creados sin conexion; cascada de anular un apoyo; las cinco pantallas sin conexion con el aviso de datos viejos; cerrar sesion borra IndexedDB; conflicto entre dos usuarios (dos navegadores: "Usar la mía", "Usar la del servidor" y anular en conflicto); rechazo por devolucion superior; edicion con **respuesta perdida** (se reintenta con el mismo UUID de operacion y se aplica una sola vez); **reintento automatico** (`page.clock`: cuatro intentos sin ningun evento de red) y "Sincronizar ahora". `offline.spec.ts` (Fase 11) se actualizo a la cola nueva (IndexedDB y textos "N cambios pendientes"); sus escenarios siguen cubiertos.

### Inestabilidades encontradas y como se arreglaron
1. Orden de los rechazos (la clave era un UUID: dos rechazos del mismo milisegundo salian en cualquier orden): ahora van por el orden en que el usuario hizo las acciones.
2. Tras un rechazo o un conflicto las pantallas no se refrescaban (solo lo hacian al enviar bien): ahora se vuelven a leer tambien en esos casos (lo encontro la E2E de rechazos).
3. Pruebas mias que cortaban la red antes de que terminara de cargar la lista: ahora esperan a que haya filas.

### Pendiente / limitaciones (Fase 12)
- Un conflicto solo se resuelve eligiendo una de las dos versiones completas (no se pueden mezclar campos).
- Dos pestanas abiertas a la vez comparten la cola (IndexedDB) y pueden enviarla las dos: es seguro (el servidor aplica cada operacion una vez) pero no hay coordinacion entre pestanas.
- "Ver historial" sin conexion no funciona (el historial no se guarda en el telefono).
- Un apoyo anulado y reactivado dentro de la cola, con `consumido` distinto de cero y conocido solo por la lista completa, puede mostrar `consumido` 0 hasta sincronizar.
- La PWA compilada (service worker) sigue sin pruebas automaticas; las E2E usan el servidor de desarrollo de Vite, donde recargar la pagina sin conexion no es posible (en la app instalada si lo seria).
- El 403 por permisos al sincronizar solo se prueba en backend y unitarias: la interfaz no ofrece editar lo de otros, asi que no hay forma natural de provocarlo en el navegador.
- El indicador no muestra progreso por operacion, solo "Sincronizando...".

### Resultado final de la Fase 12
Corrida completa dos veces seguidas, en serie: backend **111/111**, unitarias **303/303** (23 archivos), E2E **66/66** (10 archivos; 54 anteriores + 12 nuevas). `npx tsc` (app y E2E) y `npm run build` sin errores. `arca2` queda en la migracion `0004`.

Fase 12: terminada.


## Fase 13 - Listo para produccion
Antes de empezar se corrieron TODAS las pruebas: backend 111/111, unitarias 303/303, E2E 65/66. La unica falla era una asercion MIA de la Fase 12 que dependia del tiempo (comparaba `fecha - fecha_cliente > 1000 ms` y el test ahora es mas rapido): se hizo determinista esperando 1,5 s sin conexion antes de reconectar. Despues: 66/66.

Guia de despliegue (Neon + Render + Vercel, variables de cada servicio, comando de arranque, respaldo y restauracion): **`DESPLIEGUE.md`**.

### Backend
- **Configuracion solo por entorno** (`app/core/config.py`): `ENTORNO`, `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGENES`, `REGISTRO_ABIERTO` (+ `JWT_EXPIRA_MINUTOS`). El `.env` pasa a ser OPCIONAL y solo de desarrollo (antes la app se negaba a arrancar sin el; en Render no existe). `DATABASE_URL` acepta `?sslmode=require` (libpq lo respeta: hay prueba que lo demuestra) y `postgres://` se convierte a `postgresql://`.
- **Produccion segura**: con `ENTORNO=produccion` la app NO arranca (excepcion `ConfiguracionInvalida` al importar `app.main`, con el motivo y como generar un secreto) si `JWT_SECRET` falta, esta vacio, es un valor de ejemplo (los del repositorio o que contengan "cambiar"/"changeme") o tiene menos de 32 caracteres. Tambien exige `DATABASE_URL` y `CORS_ORIGENES` definidos explicitamente (y que `CORS_ORIGENES` no sea `*`), para que un olvido no deje valores de desarrollo en produccion. El seed se niega a correr (ya lo hacia; ahora probado). `/docs`, `/redoc` y `/openapi.json` dan 404. El CORS usa solo `CORS_ORIGENES` (sin la regla de localhost/red local de desarrollo, y solo los metodos GET/POST/PATCH/OPTIONS y las cabeceras que la app usa).
- **Registro cerrado** (`REGISTRO_ABIERTO`, por defecto cerrado en produccion): 403 "El registro esta cerrado...", salvo que no exista ningun usuario (primer admin; luego se cierra solo). El admin sigue pudiendo invitar.
- **Limite de login** (`app/core/limite.py`, en memoria): 5 fallos por (IP, correo) en 10 minutos -> 429 con `Retry-After` y mensaje en espanol; bloquea tambien la clave correcta mientras dura; un ingreso correcto reinicia la cuenta; tope de memoria. Clave minima de **8** (registro, cambiar clave, invitar; tambien en la interfaz).
- **`GET /api/salud`**: `{"estado":"ok"}`, sin autenticacion ni datos internos (se conserva `/salud`).
- **`requirements.txt`** con versiones fijas (se agrego `email-validator`, que era transitiva) y **`requirements-dev.txt`** (pytest y httpx; produccion no los instala). Una prueba comprueba que todo tiene `==` y que lo instalado coincide.
- **Arranque de produccion verificado de verdad**: en una copia del backend SIN `.env`, contra `arca_test` (esquema vaciado antes), con el entorno de produccion: `alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT` levanto, `/api/salud` 200, `/docs` `/redoc` `/openapi.json` `/__e2e__/base` 404, el primer registro 201 y el segundo 403, CORS correcto.
- **`e2e` nunca en produccion**: pruebas con un proceso NUEVO en modo produccion: ninguna ruta `__e2e__`, ningun modulo `e2e*` en `sys.modules`, `/__e2e__/*` da 404; ningun archivo de `app/` ni `alembic/` menciona `e2e`; y `e2e/servidor.py` se niega a importarse con `ENTORNO=produccion`. (El E2E tambien reinicia el limitador de login en su `reset`.)

### Frontend
- **URL de la API** solo de `VITE_API_URL` (`urlApi()` en `core/api.ts`). Solo en desarrollo (`npm run dev`) y sin la variable se usa el puerto 8000 del mismo equipo. En una app compilada sin la variable NO se adivina nada: `vite build` avisa y la app muestra "Falta configurar la app" (no sale a ninguna URL inventada). Prueba que recorre el codigo y no encuentra `http://localhost`/`127.0.0.1`. `.env.example` documentado.
- **Arranque en frio** (`core/servidor.ts`): hasta que el servidor responde la primera peticion espera **90 s** (despues 30 s; si pasan 10 min sin respuestas se vuelve a 90 s, porque Render lo duerme a los ~15); agotar el tiempo es un `ErrorTiempo` (subclase de `ErrorRed`: la cola lo deja pendiente y las pantallas usan su copia, nunca es un rechazo); si una peticion pasa de **5 s** aparece "Despertando el servidor..." (`AvisoServidor`, tambien en la pantalla de entrada). 502/503/504 con HTML del proveedor ya eran "reintentar" (≥500): ahora hay pruebas. Pruebas: tiempos con reloj simulado, y la cola con tiempos reales cortos (los tiempos son ajustables con `tiempos` solo para pruebas).
- **`vercel.json`**: reescritura de rutas de la SPA a `index.html` (excluye `/assets/`, para que un archivo viejo que ya no existe de 404 y no HTML), `sw.js`, `manifest.webmanifest` e `index.html` con `max-age=0, must-revalidate`, `Service-Worker-Allowed: /`, `/assets/*` y `workbox-*.js` inmutables 1 ano, y cabeceras de seguridad basicas. Probado por pruebas unitarias que leen el JSON (incluido que ninguna regla de cache largo alcanza al service worker o al manifest) y, con la app compilada, que `sw.js` y el manifest se sirven sin cache largo.
- **Actualizacion del service worker**: `registerType: "prompt"` (antes `autoUpdate`). Una version nueva se descarga en segundo plano y la app muestra **"Hay una versión nueva, actualizar"** con un boton "Actualizar" (44 px); no recarga sola (la cola sin enviar vive en IndexedDB, asi que actualizar no pierde nada). La app pregunta si hay version nueva al abrir, cada hora, al volver a la pestana (maximo cada 5 min) y al volver la conexion. El login muestra "Version <id>" (`VITE_BUILD_ID`, por defecto el commit de Vercel o "local").
- **E2E con la app compilada** (`npm run test:pwa`, `playwright.pwa.config.ts`, `e2e/pwa/pwa.spec.ts`, 3 pruebas): `scripts/servir-pwa.mjs` compila (`vite build --outDir dist-pwa`, apuntando al backend de prueba) y sirve con `vite preview` en el puerto 5298. Prueban: manifest valido + service worker activo con la app en cache; **abrir sin conexion despues de instalar** (recarga completa y abrir `/apoyos` directo, con los ultimos datos, y registrar sin conexion y sincronizar al volver); y el ciclo de **version nueva** (se compila "v2" en medio de la prueba: aparece el aviso, la app NO cambia sola, recargar sin tocar el aviso lo vuelve a mostrar, "Actualizar" pasa a v2 y v2 tambien abre sin conexion). `npm run test:e2e` ahora corre las dos configuraciones en serie.
- **`npm audit --omit=dev`** (antes: 3 altas): `npm audit fix` (sin `--force`) subio `react-router-dom` 6.28 -> **6.30.6** dentro del rango declarado y quito las 3 vulnerabilidades altas (open redirect/XSS del router). **Quedan 2 moderadas** en `react-router` 6 (GHSA-wrjc-x8rr-h8h6 open redirect con barra invertida en `<Link>`/`useNavigate`; GHSA-337j-9hxr-rhxg inyeccion en `deserializeErrors` de la hidratacion SSR). Solo se arreglan pasando a React Router 7 (cambio mayor, `--force`): no se hizo. Exposicion real: la app no usa SSR y todos los destinos de navegacion son rutas internas fijas (ids numericos); queda como riesgo bajo aceptado hasta migrar a v7.
  - Cuidado: `npm audit fix --omit=dev` PODA las dependencias de desarrollo de `node_modules`; hay que correr `npm install` despues (se hizo).

### Reglas que decidi por mi cuenta
- En produccion `DATABASE_URL` y `CORS_ORIGENES` tambien son obligatorios (ademas de `JWT_SECRET`): evita arrancar "bien" contra la base o el origen de desarrollo.
- El limite de login es por (IP del socket, correo). Detras del proxy de Render hay que poner `FORWARDED_ALLOW_IPS=*` para que uvicorn lea la IP real (no se toma `X-Forwarded-For` a mano: se podria falsificar para saltarse el limite). Es por proceso (un solo proceso en el plan gratuito).
- Un registro cerrado no bloquea `invitar` ni el login. La pantalla de entrada sigue mostrando "Crear una cuenta nueva"; con el registro cerrado el servidor responde el mensaje claro.
- La clave minima de 8 solo se exige al CREAR o CAMBIAR una clave (el login no la valida, para que cuentas existentes con claves mas cortas puedan entrar y cambiarla).
- Las E2E de la PWA son un proyecto aparte (`playwright.pwa.config.ts`, puerto 5298) porque necesitan compilar; `playwright.config.ts` las ignora.

### Respaldo y restauracion (verificados contra `arca_test`)
Ver `DESPLIEGUE.md` (seccion 4): `pg_dump --format=custom --no-owner` y `pg_restore`. Se comprobo con la copia de `arca_test` (nunca `arca`/`arca2`) que el respaldo se genera, se lee con `pg_restore --list` y se restaura incluyendo el trigger `historial_inmutable`.

### Pendiente / limitaciones (Fase 13)
- 2 vulnerabilidades moderadas de `react-router` 6 hasta migrar a React Router 7.
- Las dependencias TRANSITIVAS del backend no estan fijadas (solo las directas); para fijarlas del todo harian falta un `pip freeze`/`pip-compile` en cada actualizacion.
- El limite de intentos es en memoria: se reinicia al reiniciar el servicio y no se comparte entre procesos.
- Nunca se desplego de verdad en Neon/Render/Vercel (no hay cuentas aqui): lo verificado es el arranque con el comando de produccion contra PostgreSQL local, `sslmode` contra libpq local y la app compilada con `vite preview`. Pendiente: probar `sslmode=require` contra Neon real y el arranque en frio real de Render.
- El plan gratuito de Render duerme el servicio: la app lo tolera (90 s + aviso) pero la primera apertura del dia sera lenta.
- No hay monitoreo ni alertas, ni rotacion automatica de `JWT_SECRET` (cambiarlo cierra todas las sesiones).

### Resultado final de la Fase 13
Corrida completa DOS veces seguidas, en serie: backend **177/177** (111 + 66 nuevas), unitarias **338/338** (26 archivos; 303 + 35 nuevas), E2E de desarrollo **66/66** y E2E de la app compilada (PWA) **3/3** (dos pasadas identicas, sin intermitencias). `npm run build` compila (con `VITE_API_URL`; sin ella compila y avisa). `arca2` sigue en la migracion `0004` (la Fase 13 no agrega migraciones). Respaldo y restauracion verificados (con el trigger de `historial`). `npm audit --omit=dev`: de 3 altas a 2 moderadas (ver arriba). La primera corrida del lote dejo 2 E2E de Fase 11 fallando por la clave minima de 8 (etiqueta "minimo 6" en `familia.spec.ts` e `historial.spec.ts`): se actualizaron, no se quitaron.

Comandos nuevos: `npm run test:pwa` (E2E de la app compilada); `npm run test:e2e` corre desarrollo y PWA en serie; `pip install -r requirements-dev.txt` para desarrollo (produccion usa `requirements.txt`).

Fase 13: terminada.


## Fase 14 - Diseno y usabilidad
Solo interfaz y navegacion. **No se toco backend, API, permisos ni logica** (el backend no tiene ningun cambio en esta fase). Antes de empezar no se repitio la bateria completa: la Fase 13 acababa de cerrar con todo en verde (177 / 338 / 66 + 3) y no habia cambios entre medio.

### Que cambio en cada pantalla
- **Sistema de diseno** (`tailwind.config.js` + variables CSS en `src/index.css`): la paleta `stone` de Tailwind se re-mapeo a los grises del sistema (fondo #F4F6F5, bordes #E1E7E5, secundario #4A5A56, texto #12201C), asi toda la app lo toma sin reescribir cada clase; `arca.claro` #E3F1EC, `apoyo.claro` #FBEBDD y nuevo `apoyo.texto` #6E3207; radios `tarjeta` (18 px) y `campo` (14 px); altura `nav` (72 px). Foco verde visible global y esqueletos animados (respeta "reducir movimiento").
- **Componentes base** (`core/ui.tsx`): `Boton` con jerarquia (primario verde ancho completo 56 px / secundario con borde / destructivo rojo suave / apoyo naranja), `Campo` (etiqueta arriba, error DEBAJO del campo), `CampoClave` (mostrar/ocultar), `Interruptor` (checkbox real con rol switch), `Cargando` con esqueletos (el texto "Cargando..." queda solo para lectores de pantalla), `Vacio` con icono y accion, `ErrorCaja`/`MensajeError` con icono. Nuevos: `Encabezado` ("< Volver" + titulo + `AccionFija` para el boton principal fijo abajo) y `HojaOpciones` (lista de opciones que sube desde abajo).
- **Barra inferior**: 72 px, icono con fondo verde claro en la pestana activa. El "+" flotante (64 px) y el boton fijo de las listas quedan por encima de la barra.
- **Inicio**: tarjeta verde con el saldo grande y, debajo, Ingresos y Gastos en cifras destacadas (apoyos entregados y devoluciones en pequeno); tarjeta naranja de apoyos pendientes (toda tocable); "Ultimos movimientos" con el menu "..." (Editar, Anular o Reactivar, Ver historial) y los mismos permisos que la lista, **reutilizando `FilaActividad` y `useAccionesFila`** (extraidos de la lista); avatar con iniciales arriba a la derecha que abre "Mi perfil"; el boton "Salir" ya no esta aqui (pasa a Familia > Cerrar sesion).
- **Lista**: filtros como chips deslizables (Mes, Persona, Tipo, Categoria) que abren una hoja con las opciones (el chip muestra el valor elegido; "Categoria" se desactiva con Apoyos o Ingresos como antes); interruptor "Ver anulados"; estado vacio con "Quitar filtros" o "Registrar un movimiento".
- **Apoyos**: chips de estado (Pendiente naranja, Saldado verde, Cerrado/Anulado grises), barra de progreso mas gruesa, "Ver anulados" como interruptor, estado vacio con "Registrar un apoyo".
- **Familia**: ahora es un MENU de 5 tarjetas (Miembros, Categorias, Actividad de la familia [solo admin], Mi perfil, Cerrar sesion). Rutas nuevas: `/familia/miembros`, `/familia/miembros/nuevo`, `/familia/categorias`, `/familia/categorias/nueva`, `/familia/perfil` (y `/familia/actividad` ya existia). Miembros y Categorias tienen "Agregar ..." como boton principal fijo abajo que abre su pantalla de formulario (solo admin; un miembro que entre por la URL vuelve a la lista). Mi perfil muestra quien soy y tiene los formularios de nombre y clave. Cerrar sesion abre un dialogo de confirmacion que avisa si hay registros sin enviar.
- **Entrada (login), Nuevo movimiento, Reportes, Actividad**: mismos campos de 52 px y botones por jerarquia; clave con mostrar/ocultar; estados vacios con accion; la Actividad usa el nuevo encabezado "< Volver".

### Reglas que decidi por mi cuenta
- **"< Volver"**: vuelve a la pantalla anterior si el usuario llego navegando dentro de la app; si abrio la ruta directo o recargo (no hay pantalla anterior) va al menu de Familia (o a la lista de donde viene el formulario), asi nunca saca al usuario de la app.
- Tras crear un miembro o una categoria se vuelve a la lista con `replace` (atras no regresa al formulario ya enviado).
- **Cerrar sesion** lleva a Inicio al salir (si no, el siguiente ingreso volvia a `/familia`). Su advertencia de registros sin enviar ya no es un `confirm` del navegador sino un dialogo propio (mismo texto: "Hay N registro(s) sin enviar. Si sales ahora se perderan.").
- **El icono de error "⚠" es contenido CSS** (`before:content-['⚠']`): se ve siempre junto al texto (nunca solo color) pero no forma parte del texto del mensaje, asi las pruebas y los lectores de pantalla no lo leen como parte de la frase.
- Los `"Agregar miembro"` y `"Agregar categoria"` de las listas son **enlaces** (rol link) con aspecto de boton, porque navegan; el boton de enviar de cada formulario si es un boton.
- Un error del servidor al crear una categoria sale debajo del campo Nombre; en Mi perfil, "clave actual incorrecta" sale debajo de ese campo y "no coinciden" debajo de la repeticion; en Agregar miembro (correo repetido) el error sale encima del boton de enviar.
- Titulos largos, nombres y correos **se parten en varias lineas** en vez de cortarse con "..." (lo vi en las capturas y lo corregi).
- Se conservan todos los `data-testid`; se agregaron `fila-inicio` (movimientos de Inicio, ya existia), `estado-vacio` y `opcion-familia-<id>`.
- La paleta `stone` re-mapeada afecta tambien a los textos grises secundarios existentes (ahora #4A5A56, mas contraste).

### Pruebas
- Unitarias: 365 + 13 de `core/ui.test.tsx` (botones, campos, clave, interruptor, vacio, carga, encabezado, tokens). `PaginaFamilia.test.tsx` ahora prueba el menu y el cierre de sesion; **`Pantallas.test.tsx`** (nuevo) cubre Miembros, Agregar miembro, Categorias, Agregar categoria y Mi perfil; Lista y Inicio actualizadas (chips, interruptor, menu "..." con permisos, avatar, esqueletos).
- E2E: `familia.spec.ts` reescrito (menu, rutas, atras/adelante del navegador, recargar en cualquier ruta, "< Volver", avatar, formularios en su propia pantalla, boton fijo sin tapar la ultima fila, mostrar/ocultar); `permisos`, `historial`, `login`, `offline` y `sin-conexion` actualizados a la nueva navegacion (ayudantes `irAFamilia`, `irAOpcionFamilia`, `volver`, `cerrarSesion`). Nuevo **`visual.spec.ts`** (2 pruebas).
- **Prueba visual**: `e2e/visual.spec.ts` guarda 17 capturas a 390 px en `web_arca/capturas/` (Inicio, Lista, hoja de filtro, menu "...", Apoyos, menu de Familia, Miembros, Categorias, Mi perfil, Nuevo movimiento, Agregar miembro, Agregar categoria, Actividad, Reportes, estados vacios y esqueletos; la carpeta esta en `.gitignore`) y comprueba automaticamente en cada pantalla: sin desborde horizontal, sin texto cortado (tampoco con "..."), ningun control tapado por la barra inferior (tras bajar al final), areas tactiles de 44 px o mas y barra de 72 px. Revise yo mismo las capturas: encontre (y corregi) titulos y correos cortados con "...", un aviso que quedaba tapando un encabezado en las capturas (era el tiempo de mi propia prueba), "Mi nombre" duplicado en el perfil y "Ver anulados" de Apoyos sin interruptor.

### Pendiente / limitaciones (Fase 14)
- El "+" flotante de Inicio puede tapar el "..." de la fila que queda justo debajo mientras se desplaza (es propio de un boton flotante; al seguir bajando se despeja y la lista deja espacio al final).
- Los filtros de la pantalla "Actividad de la familia" (solo admin) siguen siendo listas desplegables nativas, no chips.
- La app sigue solo en espanol y sin modo oscuro; los textos usan, salvo los de la Fase 12, el estilo sin tildes ya existente.
- Las capturas se revisaron en Edge a 390 px (no en Safari ni en telefonos reales); no hay comparacion visual automatica entre versiones.

### Resultado final de la Fase 14
Corrida completa DOS veces seguidas, en serie: backend **177/177** (sin cambios), unitarias **378/378** (28 archivos; 338 + 40 nuevas), E2E de desarrollo **74/74** (66 + 8 nuevas: menu/rutas/atras/recargar/avatar/boton fijo/cerrar sesion/correo repetido, y 2 visuales) y E2E de la app compilada (PWA) **3/3**. `npx tsc` (app y E2E) y `npm run build` compilan. Capturas en `web_arca/capturas/` (en `.gitignore`).

Fase 14: terminada.



## Fase 15 - Bitacora unificada
Antes de empezar se corrio TODO y pasaba: backend 177, unitarias 378, E2E 74 + 3 (PWA). No se rehizo nada que ya funcionaba.

### Que se construyo
**Backend** (`app/modulos/bitacora/`: `models`, `registro` [escritura], `service` [lectura], `router`, `schemas`)
- Migracion `0005`: tabla `bitacora` + trigger `bitacora_inmutable` (rechaza UPDATE y DELETE). Verificada SUBIR / BAJAR / SUBIR sobre `arca_test` desde un esquema vacio (cadena 0001-0005; el trigger de `historial` sigue intacto) y probado a mano que el trigger rechaza. Aplicada en `arca2` solo hacia adelante (aditiva); `arca` no se toco.
- Eventos (14): los pedidos. `registro`, `cambio_clave_ok`, `restablecer_clave`, `cambio_rol`, `usuario_desactivado/reactivado` van en la MISMA transaccion (dentro de un SAVEPOINT: si la fila de bitacora falla se descarta solo ella, se loguea con `logger.exception` y el cambio sigue; si el cambio se revierte, la fila tambien). `login_ok`, `login_fallido`, `login_bloqueado`, `logout`, `cambio_clave_fallido`, `acceso_denegado`, `token_invalido` y `sincronizacion_rechazada` van en sesion APARTE (quedan aunque la peticion falle). Los 403 y los rechazos de la cola se registran en manejadores de errores de `main.py` (no hubo que tocar cada servicio).
- Sin secretos: `detalle` solo admite llaves de una lista blanca (`DETALLE_PERMITIDO`) y textos de 160 caracteres; `correo_intentado` solo se guarda si parece un correo (si alguien escribe su clave en ese campo no se guarda); el 409 guarda solo el mensaje, nunca el registro del servidor.
- IP = `request.client.host` (uvicorn la resuelve con `FORWARDED_ALLOW_IPS`; hay prueba de que `X-Forwarded-For` se ignora). Dispositivo = user-agent a 200.
- API: `GET /api/bitacora` (filtros origen, evento, resultado, persona, desde, hasta, ip; `limite` y `cursor`), `GET /api/bitacora/resumen`, `GET /api/bitacora/exportar.csv`, y nuevo `POST /api/auth/logout` (204). Todo solo admin (salvo logout, que es de cualquier sesion). Cada pagina pide `limite+1` a CADA tabla (hay prueba de que toda consulta lleva LIMIT) y mezcla; el cursor es (fecha, origen, id) y es opaco.

**Frontend** (`src/modulos/bitacora/`): ruta `/familia/bitacora` y tarjeta "Bitacora" en Familia solo para admin (un miembro es redirigido a Familia sin pedir nada al servidor). Resumen en tarjetas (ultimo acceso por persona, fallos de la semana, IP/dispositivo nuevos), chips Todo|Accesos|Datos, chips Evento/Resultado/Persona/Fechas (hojas de opciones; Fechas con presets y rango propio), lista con icono, color y etiqueta de texto, IP y dispositivo ("Edge en Windows") en una linea secundaria, "Cargar mas", vacio amable, esqueletos, "Exportar CSV". Cerrar sesion avisa a `/auth/logout` antes de borrar el token (sin esperar; offline no queda).

### Reglas que decidi por mi cuenta
- **Orden por la fecha del SERVIDOR** (la de registro): solo crece, asi lo nuevo siempre aparece arriba y nunca "detras" de una pagina ya vista. La fecha REAL (`fecha_real`, la del cliente si se hizo sin internet) se muestra aparte, junto con "Hecho sin conexion · sincronizado ..." cuando difieren mas de 60 s. Los filtros de fechas tambien actuan sobre la fecha del servidor. `desde`/`hasta` aceptan `AAAA-MM-DD` (dia completo, en UTC) o fecha-hora ISO; la interfaz manda instantes ISO calculados con el dia LOCAL del aparato.
- **Mismo hecho en dos origenes, por diseno**: cambio de rol, desactivar/reactivar, restablecer clave y cambiar clave existen en `bitacora` (vista de seguridad, con `objetivo` en el detalle) y en `historial` (vista de datos), como pide la lista de eventos. "No copiar" lo entendi como: no se replica el historial en la bitacora; solo estos pocos hechos de seguridad tienen su propia fila y el detalle de bitacora no copia `cambios`.
- `usuario_id` = quien HIZO la accion (como en historial); la persona afectada va en `detalle.objetivo(_id)`. El login fallido de un correo que existe guarda `usuario_id` y `familia_id`; el de uno inexistente, nulos (nadie lo ve en pantalla: ningun usuario tiene ese correo).
- Anti-inundacion (en memoria, por proceso): `token_invalido` 1 por IP por minuto (pedido); ademas `login_bloqueado` 1 por (IP, correo) por minuto y el 401 de "cuenta desactivada" 1 por usuario por minuto. Una peticion SIN cabecera Authorization no cuenta como token invalido (no hay token).
- Un 403 que llega por la cola (lleva `X-Operacion-Id`) deja DOS entradas: `acceso_denegado` y `sincronizacion_rechazada`. Se consideran rechazos de sincronizacion los 4xx menos 401/408/429 (igual que la cola del cliente).
- El login de un usuario desactivado (403) queda como `acceso_denegado` (motivo `usuario_desactivado`), no como `login_ok`.
- Resumen: "novedad" = IP o dispositivo que un usuario uso por primera vez en los ultimos 7 dias HABIENDO entrado antes (su primer ingreso no cuenta). "Fallos" cuenta `login_fallido`; los bloqueos van aparte.
- CSV: UTF-8 con BOM (Excel y acentos), fechas en UTC, cabecera `X-Truncado` si habia mas de 5000, y ademas de `= + - @` se neutralizan tab y retorno de carro al inicio.
- Titulos legibles: "Anulo gasto Transporte Bs 50.00" usa el estado ACTUAL del registro (categoria o nota y monto). Al crear una categoria/miembro/usuario no se listan campos (el titulo ya lo dice).
- Retoque fuera del alcance: los chips deslizables de la Lista (Fase 14) pegaban el primer chip al borde por el `snap`; agregue `scroll-pl-4` (aqui y en la Lista). Las pruebas del menu de Familia (unitaria y E2E) pasaron de 5 a 6 tarjetas para el admin.

### Pruebas
- Backend `tests/test_fase15_bitacora.py` (40): cada evento, IP/dispositivo/recorte, `X-Forwarded-For` ignorado, bloqueo sin inundar, trigger rechaza UPDATE/DELETE, ninguna ruta edita/borra, volcado sin claves/hashes/JWT (tabla, pantalla y CSV), solo admin, aislamiento entre familias, eventos sin familia, filtros (incluido rango de fechas), mezcla ordenada con empates de fecha, paginacion con tamanos 1 a 30 sin repetidos ni saltos y con eventos nuevos en medio, LIMIT en las consultas, textos legibles, "Anulado" con motivo, fecha real sin internet, CSV (cabecera, filtros, tope 5000, escape de `= + - @`), fallo de la bitacora (excepcion y error real de base) sin romper login ni cambio de clave y con error en el log, misma transaccion (si el commit falla no queda la fila; los fallos si), resumen.
- Unitarias `src/modulos/bitacora/Bitacora.test.tsx` (24) + 2 de `AuthContext` (logout antes de borrar el token, tolera fallo) + menu de Familia (6 para admin, miembro sin Bitacora).
- E2E `e2e/bitacora.spec.ts` (4): clave mala y luego buena -> se ve en la bitacora junto a crear y anular un gasto (orden, "Anulado" con motivo, IP/dispositivo, resumen, chips Todo/Accesos/Datos, Evento, Resultado, Persona, Fechas, vacio, CSV, 44 px, sin desborde, Volver); miembro sin opcion y redirigido por URL directa (y 403 en las 3 rutas, registrados); "Cargar mas" sin repetidos ni saltos contra el servidor; el logout queda anotado. `visual.spec.ts` (+2): 10 capturas nuevas (16 a 25, en `web_arca/capturas/`) con las revisiones automaticas. Las revise a ojo y corregi: motivo repetido en el login fallido, ruido de campos en categorias, user-agent ilegible, primer chip pegado al borde.
- **Descargas en E2E**: una descarga real con Edge deja cerrado el contexto de Playwright y rompe la limpieza; la prueba intercepta el clic del enlace `download` y lee el contenido que la app entrega (el flujo real de descarga no se automatiza).

### Pendiente / limitaciones (Fase 15)
- La bitacora y el historial solo crecen: sin politica de retencion ni purga. Un superusuario de PostgreSQL podria desactivar el trigger (igual que `historial`); sin firma ni cadena de hashes.
- Los limitadores (login, `token_invalido`, bloqueos) son en memoria y por proceso.
- El token no se revoca al cerrar sesion (JWT sin estado: vence solo); `logout` solo deja constancia y sin internet no se anota.
- Los eventos de datos no traen IP ni dispositivo (el historial no los guarda); no hay chip de IP en la pantalla (la API si filtra por `ip`).
- La bitacora no funciona sin conexion (no se guarda copia en el aparato). Eventos anteriores a la Fase 15 no existen y no se inventan.
- "Registro cerrado" (403) queda como `acceso_denegado` sin familia: ningun admin lo ve en pantalla.
- La descarga del CSV no se prueba con una descarga real (ver arriba).

### Resultado final de la Fase 15
Corrida completa DOS veces seguidas, en serie (la primera pasada solo fallo el E2E de Familia por las 6 tarjetas; se actualizo y se repitio entera): backend **217/217** (177 + 40), unitarias **405/405** (29 archivos; 378 + 27), E2E de desarrollo **80/80** (74 + 6) y E2E de la app compilada **3/3**. `npx tsc` (app y E2E) sin errores. `arca2` en la migracion `0005`.

Fase 15: terminada.



## Fase 16 - Periodos
Antes de empezar se corrio el backend (217/217) y las unitarias (405/405) y pasaban. Las E2E no se repitieron antes de tocar nada: se tomo como base el cierre verde de la Fase 15 (80 + 3), sin cambios entre medio. `arca` y `arca2` no se tocaron; la migracion `0006` se probo subir/bajar/subir sobre `arca_test` recreando su esquema (el trigger de `historial` y el de `bitacora` siguen intactos).

### Que se construyo
**Backend**
- Migracion `0006`: `familias.dia_inicio_mes` (entero, por defecto 1) con `CHECK` 1 a 28. `GET /api/familia` (cualquier miembro) y `PATCH /api/familia` (solo admin; fuera de rango = 422, miembro = 403). El cambio deja entrada en `historial` (entidad `familia`, accion `editar`) en la misma transaccion; si el valor no cambia no se escribe nada. Tambien aparece en la Bitacora unificada ("Edito los periodos de la familia · Dia de inicio del mes: 15 -> 28"). `/auth/yo` y el login devuelven `dia_inicio_mes`.
- `app/modulos/periodos/calculo.py`: unico modulo de calculo, funciones puras (sin base de datos ni imports de la app; una prueba lo vigila): `calcular`, `anterior`, `siguiente`, `mismo_largo_anterior`, `etiqueta`, `hoy_la_paz`, `fecha_local`. `hoy_la_paz()` toma el reloj de `ahora_utc()` (las pruebas lo sustituyen). Las fechas por defecto de movimientos y apoyos ya no usan `date.today()` sino el dia de La Paz.
- `GET /api/periodos/actual?tipo=&referencia=` (+ `desde`/`hasta` para `rango`).
- `desde`/`hasta` en `/movimientos`, `/actividad`, `/apoyos`, `/apoyos/resumen` y `/reportes/{resumen,por-categoria,por-miembro}`. `mes=AAAA-MM` sigue igual (mes calendario).
- Reportes: `comparacion` en `/resumen` (ingresos, gastos, saldo) y en `/por-categoria` (total y cada categoria). Apoyos: `entregado_periodo` / `devuelto_periodo` por beneficiario y totales; el pendiente y el estado son acumulados.
- `tzdata` agregado a `requirements.txt`; ademas `calculo.py` cae a UTC-4 fijo si el sistema no tiene la base de zonas (Windows sin `tzdata`): Bolivia no tiene horario de verano, asi que es identico.

**Frontend**
- `core/periodo.ts` (calculo identico al del backend), `core/PeriodoContext.tsx` (el periodo vive por encima de las pantallas; se reinicia a "Mes actual" cuando cambia la sesion), `core/SelectorPeriodo.tsx` (chips Hoy | Semana | Mes | Anio | Rango, flechas, etiqueta), `core/PaginaRango.tsx` (ruta `/periodo/rango`), `core/comparacion.ts`.
- Inicio, Lista, Reportes y Apoyos usan el selector; Familia > Mi familia (`/familia/mi-familia`, primera tarjeta del menu) con el campo para el admin y un texto de solo lectura para el miembro.
- Cache offline por periodo (la clave de cada lectura lleva `desde_hasta`); `useCarga(..., true)` no muestra los datos ni el error de otro periodo; sin conexion y sin copia de ese periodo sale "Sin datos guardados para este periodo".

### Reglas que decidi por mi cuenta
- **El calculo se repite en el telefono** (TypeScript) en vez de pedirle cada periodo al servidor, para que las flechas y los chips funcionen sin conexion y sin un viaje extra. Para que no se separen, `compartido/periodos_casos.json` (424 casos, generado por `backend_arca/tests/generar_casos_periodos.py`) lo leen las pruebas de los dos lados; si el backend cambia y no se regenera, su prueba falla. La interfaz no usa `GET /periodos/actual` (existe y esta probado, y las E2E comparan contra el).
- El "hoy" del telefono es el dia de La Paz calculado con UTC-4, no el reloj local del aparato.
- Cambiar de chip lleva al periodo ACTUAL de ese tipo (no conserva la referencia). Rango: las flechas mueven el tramo por su mismo largo. "Hoy" es el tipo `dia`.
- "Comparacion con el anterior" = tramo del MISMO NUMERO DE DIAS inmediatamente antes (un mes de 30 dias se compara con los 30 dias previos, no con el mes anterior completo). `porcentaje = diferencia / |anterior| * 100` redondeado a 1 decimal; nulo si el anterior es 0. Por categoria solo se listan las categorias con gasto en el periodo actual.
- Con periodo, el resumen de Apoyos oculta a quien no tiene pendiente ni entregas/devoluciones en el periodo; quien tiene pendiente se ve siempre. La lista de cada tarjeta muestra los apoyos entregados en el periodo o con una devolucion hecha en el; ese filtro se hace en el telefono sobre la lista completa (hace falta completa para repartir devoluciones entre apoyos).
- La Lista pierde la opcion "Todos los meses": ahora se usa el selector (Anio o Rango cubren ese caso).
- `desde`/`hasta` mandan sobre `mes`; en reportes se exigen los dos (uno solo = 422); en movimientos/apoyos/lista basta uno.
- Un miembro ve el cambio del dia de inicio la proxima vez que abre la app (el dato viaja en `/auth/yo`); el admin lo ve al instante.
- Correccion fuera del alcance: `AuthContext` lanzaba una promesa sin `catch` al limpiar el almacen local (error no manejado intermitente bajo carga en las unitarias); ahora se ignora el fallo.

### Pruebas
- Backend `tests/test_fase16_periodos.py` (105): tablas de casos para mes con dia de inicio 1/15/28 (primer y ultimo dia, diciembre-enero, febrero comun, bisiesto y 2100), semana (cruza mes y anio), anio, rango, invalidos, anterior/siguiente, encaje sin huecos en 4 anios, etiquetas, zona La Paz (21:00 y 00:30, 23:59, cambio de anio), movimiento sin fecha en el dia local, `/periodos/actual`, solo admin cambia el dia (0, 29 o texto = 422), historial y bitacora, efecto en el saldo, `desde`/`hasta` inclusivos, compatibilidad con `mes`, saldo con apoyos, devoluciones y anulados, pendiente acumulado, comparacion con anterior 0, distinto de 0 y por categoria, aislamiento entre familias, tabla compartida al dia.
- Unitarias: `core/periodo.test.ts` (tabla compartida + bordes), `core/comparacion.test.ts`, `core/SelectorPeriodo.test.tsx`, `PaginaMiFamilia.test.tsx`, y ampliadas Inicio, Reportes, Apoyos, Lista, Familia, superponer y sin conexion.
- E2E `e2e/periodos.spec.ts` (6): periodo anterior (saldo, aviso, etiqueta, conservar, reinicio), chips y rango, comparacion y pendiente acumulado, el admin cambia el dia y el saldo cambia (el miembro ve el mismo periodo), el miembro no ve el control, periodo sin datos sin conexion. `visual.spec.ts` (+1): capturas 26 a 36 en `web_arca/capturas/` con las revisiones automaticas; las revise a ojo (se partia "(+Bs / 500.00)" en dos lineas: corregido).
- Se actualizaron textos en E2E previas (`reportes`, `gasto`, `familia`, `offline`, `sin-conexion`, `editar-anular`, `visual`, `pwa`).
- Errores que encontraron las pruebas y se corrigieron: sin conexion, al ir a un periodo nunca abierto se veian los numeros del periodo anterior bajo la etiqueta nueva (falla de `useCarga`); el `aria-label` de la seccion de comparacion chocaba con "Periodo anterior".

### Pendiente / limitaciones (Fase 16)
- El periodo no sobrevive a recargar la pagina (vuelve a "Mes actual").
- Sin conexion, la comparacion se recalcula con lo pendiente pero las categorias solo se actualizan al sincronizar.
- Si un beneficiario saldado esta oculto por el periodo y se le registra un apoyo sin conexion, su fila temporal solo cuenta lo nuevo hasta sincronizar.
- "Actividad de la familia" y la Bitacora siguen con sus propios filtros de fechas.
- Las E2E usan el reloj real: justo en el cambio de dia de La Paz una corrida podria discrepar.

### Resultado final de la Fase 16
Corrida completa DOS veces seguidas (mas una anterior que sirvio para corregir 2 E2E de textos viejos), en serie y sin intermitencias: backend **322/322** (217 + 105), unitarias **908/908** (33 archivos; 405 + 503 con la tabla compartida), E2E de desarrollo **87/87** (80 + 7) y E2E de la app compilada (PWA) **3/3**. `tsc` (app y E2E) y `npm run build` compilan. Capturas 26 a 36 en `web_arca/capturas/`.

Fase 16: terminada.


## Fase 16b - Ajuste de la comparacion con el periodo anterior
- **Cambio**: para `mes`, `semana` y `anio` la comparacion ya NO usa "mismo largo": usa el periodo anterior del mismo tipo, el mismo que la flecha "anterior" (mes respetando `dia_inicio_mes`; asi marzo se compara con febrero completo y un anio bisiesto con el anterior entero). `dia` y `rango` conservan el mismo largo inmediatamente antes.
- **Backend**: `periodo_comparacion` y `etiqueta_comparacion` en `calculo.py`; `/reportes/resumen` y `/reportes/por-categoria` aceptan `tipo=dia|semana|mes|anio|rango` junto a `desde`/`hasta`. `comparacion.etiqueta` (resumen) y `periodo_anterior` (por categoria) traen "vs octubre 2026" / "vs 28 sep - 27 oct". Sin `tipo`: `mes=AAAA-MM` se trata como mes calendario y `desde`/`hasta` sueltos como rango (mismo largo). Si el tramo pedido no es exactamente un periodo de su tipo (p. ej. `tipo=mes` con 5 al 20), cae al mismo largo en vez de inventar un mes.
- **Frontend**: `periodoComparacion` / `etiquetaComparacion` en `core/periodo.ts` (idem backend); Reportes manda el tipo del selector y muestra "Comparado vs octubre 2026". `compartido/periodos_casos.json` ahora incluye `comparacion` y `comparacion_etiqueta` en los 424 casos y ambos lados los verifican.
- **Detalle**: un rango de un solo dia se etiqueta "9 nov 2026" (antes "9 nov - 9 nov 2026").
- **Pruebas nuevas**: backend 26 casos (meses de 28, 29, 30 y 31 dias, febrero y bisiesto, cambio de anio, `dia_inicio_mes` 1/15/28, semana, anio, dia, rango, tramo no exacto) + invariante "comparacion = flecha anterior" durante 3 anios + 6 de API; unitarias: los mismos casos en TypeScript; la E2E de Reportes ahora usa el 1 del mes pasado (que con "mismo largo" no entraba).


## Fase 17 - Privacidad
**Retomada tras un apagado del equipo.** NOTAS.md no tenia nada de la fase; el codigo estaba casi completo. Diagnostico antes de tocar nada: todos los archivos de privacidad existian y estaban enteros (compilan; ninguno truncado), `arca2` en la migracion `0005` (la `0006` y la `0007` no se han aplicado ahi: no se toco), `arca_test` recreada por las pruebas, sin procesos de prueba (puertos 8199 y 5299 libres) ni conexiones colgadas, backend 889/889 y un unico fallo de `tsc` (2 errores de tipos en `SelectorVisibilidad.test.tsx`). `arca` y `arca2` no se tocaron en esta sesion.

### Que se construyo
**Backend** (`app/modulos/visibilidad/`: `models`, `service` [UNICO filtro], `cambios` [escritura], `router`)
- Migracion `0007`: `visibilidad` en `movimientos` y `apoyos` (`CHECK`, por defecto `familia`), `miembros.visibilidad_defecto`, tabla `compartidos`. Subir/bajar/subir verificado sobre `arca_test` recreando su esquema; ambos triggers (`historial_inmutable`, `bitacora_inmutable`) intactos.
- `visibilidad.service`: `condicion`/`filtrar` (SQL), `puede_ver`/`exigir_ver` (404 con el mismo cuerpo), `condicion_historial` (visibilidad ACTUAL), `puede_editar`, `puede_registrar_devolucion`, `privados_propios`. Lo usan movimientos, apoyos, actividad, reportes, historial y bitacora.
- Endpoints: `GET/PATCH /privacidad`, `POST /privacidad/aplicar-defecto`, `PATCH /movimientos|apoyos/{id}/visibilidad`, `GET /sincronizacion/visibles`; `incluye_privados` en reportes y apoyos.

**Frontend** (`src/modulos/privacidad/`): `SelectorVisibilidad`, `ElegirPersonas`, `DialogoCompartir`, `Etiquetas` (candado con texto y "Incluye tus N registros privados"), `PaginaPrivacidad` (`/familia/perfil/privacidad`), `visibilidad.ts`; `sync/visibles.ts` olvida de la copia local lo que dejo de verse.

### Que corregi al retomar
- **Fuga**: en `devolver`, un `uuid_cliente` de devolucion ya usado devolvia el apoyo de esa devolucion previa sin comprobar que fuera visible (ni que fuera el mismo apoyo). Ahora responde 409 generico. Prueba nueva.
- **Candado ausente en Inicio**: `movimientoAItem` y `apoyoAItem` descartaban `visibilidad` y `compartido_con`; las filas de Inicio nunca mostraban "Solo tu". Corregido (prueba unitaria nueva `sync/itemsVisibilidad.test.ts`).
- Los 2 errores de tipos del selector (el valor por defecto se ensanchaba a `"familia"`).
- **Aviso honesto** ampliado: ademas de "el administrador del servidor puede acceder tecnicamente a la base de datos", dice que los datos no van cifrados de extremo a extremo, que lo ya visto no se puede "des-ver" y que quien tenga copia en su telefono la pierde al sincronizar.
- Faltaba la E2E de la fase: `e2e/privacidad.spec.ts` (6) y capturas 37 a 42. `permisos.spec.ts` espera ahora "Compartir..." en el menu de lo propio.

### Reglas que decidi por mi cuenta
- El admin edita solo lo que ve y es de `familia`; lo compartido con personas es de solo lectura para todos menos el dueno.
- Las devoluciones no tienen columna: heredan la visibilidad del apoyo. En un apoyo de `familia` cualquiera registra devoluciones (como siempre); en uno privado o compartido, solo el dueno.
- La entrada `cambiar_visibilidad` del historial solo la ve quien la hizo.
- Al olvidar registros que dejaron de verse, tambien se descartan las copias de totales guardadas (sumaban el registro): sin conexion sale "Sin datos guardados para este periodo" en vez de una cifra que lo delate.
- Si el dueno se desactiva, lo oculto sigue oculto y lo compartido con elegidos sigue visible para ellos.

### Pendiente / lugares donde aun puede filtrarse informacion
- **El que administra el servidor / la base** ve todo (sin cifrado); el aviso lo dice.
- **Lo que ya se vio** antes de pasarlo a privado, o copiado/fotografiado, no se retira. Un telefono sin conexion conserva su copia hasta que se sincroniza (puede pasar mucho tiempo si no vuelve a conectarse); el token JWT no se revoca.
- **Tiempos de respuesta**: hay una prueba de que el 404 de "inexistente" y "no visible" tarda lo mismo, pero no es una garantia estadistica estricta.
- **Identificadores**: los ids son secuenciales, y la lista de ids visibles (`/sincronizacion/visibles`) revela cuantos registros tienes visibles (no los de otros). Un `uuid_cliente` ajeno responde 409 (distinto del 201/200 normal): permitiria saber que ese UUID existe en la familia, no su contenido.
- **Totales por diferencia**: dos personas que comparan sus totales pueden deducir que alguien tiene registros privados (los totales de cada quien son distintos por diseno); el admin sabe que el saldo de la familia no es la suma de lo que ve.
- **Bitacora de accesos**: `sincronizacion_rechazada` y `acceso_denegado` guardan solo tipo y motivo, no montos ni nombres (hay prueba), pero la IP y la hora de un acceso a un registro oculto quedan registradas.
- **Historial de categorias**: renombrar o desactivar una categoria es visible para todos; puede insinuar en que se gasta.
- **Registros antiguos** (anteriores a la fase) son `familia`: nada se oculta retroactivamente salvo con "Aplicar a mis registros anteriores".
- La pantalla no se recarga sola al volver la conexion cuando mostraba "Sin datos guardados" (se relee al navegar).
- Las E2E usan el reloj real y Edge a 390 px.

### Pruebas
- Backend `tests/test_fase17_privacidad.py` (24, incluye la nueva de UUID de devolucion) y `tests/test_fase17_matriz.py` (matriz: cada ruta con solo_yo/familia/elegidas para dueno, admin, otro, elegido y otra familia; `test_todas_las_rutas_estan_en_la_matriz` falla si aparece una ruta sin clasificar).
- Unitarias: `privacidad/*.test.*`, `sync/visibles.test.ts`, `sync/itemsVisibilidad.test.ts` y las pantallas ya actualizadas.
- E2E `e2e/privacidad.spec.ts` (6): lo privado de Beto no lo ve el admin (Inicio, lista, totales, 404 por API identico al inexistente, historial global, bitacora y CSV); compartir y dejar de compartir; apoyo privado; Mi perfil > Privacidad con aviso honesto y "aplicar" con confirmacion; copia sin conexion que se reemplaza; otra familia. Capturas 37 a 42 en `web_arca/capturas/` (revisadas: sin desborde ni texto cortado).

### Resultado final de la Fase 17
Corrida completa DOS veces seguidas, en serie y sin nada en paralelo: backend **890/890** (889 + la prueba nueva de UUID de devolucion), unitarias **964/964** (38 archivos), E2E de desarrollo **93/93** (incluye las 6 de `privacidad.spec.ts`) y E2E de la app compilada (PWA) **3/3**. `tsc` (app y E2E) y `npm run build` compilan. Capturas 37 a 42 en `web_arca/capturas/`. Dos corridas intermedias fallaron por mi propia causa y se corrigieron (expectativa de menu "..." en `permisos.spec.ts`) o por el cambio de dia de La Paz a media corrida (`HOY` se calcula al importar; es la limitacion del reloj real ya anotada en la Fase 16: la prueba pasa sola y en la corrida siguiente). `arca` y `arca2` no se tocaron; `arca2` sigue en `0005` (aplicar `0006` y `0007` con `alembic upgrade head` cuando se decida).

Fase 17: terminada.


## Fase 18: mejoras de UX (bloques A-H, D2 y J)
Solo frontend (`web_arca`), solo presentacion y navegacion: no se toco la cola offline (`modulos/sync/`), los periodos, la privacidad, los contratos de la API ni el backend. Se hicieron en bloques, uno a la vez, cada uno con tsc (app y E2E), build, Vitest y E2E en verde y capturas antes/despues a 390 px.

### Que cambio por bloque
- **A, registrar sin friccion** (`PaginaNuevo.tsx`, `core/formato.ts`): "Guardar" fijo sobre la barra (`AccionFija`), el error de validacion baja a la vista y se enfoca, y atajos "Hoy" / "Ayer" junto a la fecha (`ayerISO`).
- **B, contraste y tamano** (`FilaActividad`, `PaginaApoyos`, `PaginaReportes`, `PaginaInicio`, `index.css`): lo anulado pasa de `stone-400` (2.58:1) a `stone-600` (6.26:1), el motivo de anulado a `red-700` solido (5.57:1) y la insignia "Anulado" a `stone-600` (5.80:1); `text-sm` en estado del apoyo, "sin enviar", "en conflicto", "editado por", comparaciones y desglose por periodo; clase `.monto` (`tabular-nums`) en todos los montos.
- **C, dialogos accesibles** (`core/useDialogo.ts`, `Fondo`, `HojaOpciones`, `MenuFila`, `Aviso`): Escape cierra, el foco entra y vuelve a quien abrio, Tab queda atrapado, tocar el fondo cierra salvo con datos sin guardar (`sinGuardar`); `MenuFila` con flechas, Inicio, Fin y Escape; `max-h` con scroll; los errores de `Aviso` son `role="alert"`, duran 10 s y tienen "Cerrar aviso". Se arreglo de paso un error previo: `Fondo` quedaba 16 px desplazado por el `space-y` del contenedor (`!m-0`).
- **D, el "+" que no estorbe** (`PaginaInicio.tsx`, `BotonNuevo.tsx`): primer intento, un "+" flotante que se achicaba y se atenuaba al bajar por la lista (con area tactil de 44 px y respeto de `prefers-reduced-motion`). No bastaba: al quedarse quieto volvia a tapar el monto y el ⋯ de las filas. Quedo reemplazado por D2 (se borro `BotonNuevo.tsx` y su prueba).
- **D2, el "+" en la barra** (`Layout.tsx`, `core/Encabezado.tsx`): el "+" es un circulo en el centro de la barra (`grid-cols-5`: Inicio, Apoyos, +, Reportes, Familia), global y con un solo enlace "Nuevo movimiento" por pantalla; en `/nuevo` y `/editar` queda marcado y no navega (`aria-current`, `aria-disabled`). El `<main>` deja `pb-[calc(env(safe-area-inset-bottom)+7rem)]` y `AccionFija` sube de `pb-3` a `pb-5` para que el circulo no roce "Guardar".
- **E, navegacion coherente** (`Layout.tsx`, `PaginaLista.tsx`, `core/DialogoConfirmar.tsx`): Inicio se resalta en `/todos`, `/nuevo` y `/editar/...` (`estadoPestana`); solo en `/todos` lleva `aria-current` (en `/nuevo` y `/editar` el unico es el "+"); `/todos` usa `Encabezado` con "< Volver"; los dos `window.confirm` ("Marcar consumido", "Restablecer clave") pasan a un solo dialogo propio, con foco inicial en Cancelar.
- **F, estado de sincronizacion** (`core/EtiquetaSync.tsx`, `Layout.tsx`, `BarraSync.tsx`): pildoras "sin enviar" / "en conflicto" en las filas, insignia con el numero de cambios sin enviar en la pestana Inicio, `BarraSync` en una fila compacta (el boton de sincronizar pasa a icono; "Ver detalle" sigue abriendo el panel) y "Todo sincronizado" 3,6 s despues de quedar sin cambios.
- **G, lista mas legible** (`PaginaLista.tsx`, `movimientos/agrupar.ts`, `FilaActividad.tsx`, `core/ChipFiltro.tsx`, `PaginaActividadFamilia.tsx`): encabezados por dia (Hoy / Ayer / 6 nov) con su total derivado de lo cargado (con paginas pendientes el ultimo dia no muestra total), autor abreviado (el nombre completo queda en `title` y en texto solo para lectores de pantalla, clase `.solo-lectores`) y oculto si se filtro una persona, "Ver anulados" como chip, filtros de Actividad como chips con `HojaOpciones` (ya no hay `<select>` ni texto cortado) y montos de Apoyos y de la linea por persona de Reportes sin partirse (`whitespace-nowrap`).
- **H, reportes mas claros** (`PaginaReportes.tsx`, `PaginaApoyos.tsx`): sin periodo anterior (ninguna comparacion tiene base) sale UN solo mensaje arriba del Resumen en vez de repetirlo en cada tarjeta y categoria (ahi ya no se dibujan las tarjetas `comparacion-*`); sin base en una sola tarjeta se dice "Sin datos en el periodo anterior..." sin flecha ni "+Bs ..." (con base queda igual); leyenda de las barras de "Ultimos 6 meses" (verde = ingresos, gris = gastos) y mes/saldo sin solaparse; y la barra inferior de la tarjeta de Apoyos con la etiqueta arriba y el monto abajo. La dona o barra apilada de gastos por categoria no se hizo: la lista ya muestra barra y porcentaje de cada categoria y exigiria una paleta de colores por categoria que el sistema de diseno no tiene.
- **J, tildes y enie** (solo textos visibles, ~45 archivos de `src/`, `index.html` y la descripcion del manifest en `vite.config.ts`): titulos, etiquetas, botones, avisos, mensajes de error propios del frontend, `aria-label` y la bitacora/historial. Decisiones: se acentuaron tambien los 4 `aria-label` que coinciden con texto visible (`PaginaApoyos`, `PaginaFamilia`, `HojaOpciones`, `DialogoAnular`) y los 5 que no ("Navegacion principal", radiogroup "Categoria", "Nombre de la categoria", "Comparacion de totales", "Acciones de la devolucion ..."); "Anio" pasa a "Año" solo como texto (la clave `anio` y las rutas no cambian); "periodo" queda igual; "Beneficiario (quien recibe)", "Quien entro", "Quienes forman tu familia", "Tia Rosa". Ademas, en `BarraSync.tsx`: dos "¿" que faltaban y "se desharon" -> "se deshicieron". No se toco: rutas, claves, `data-testid`, campos de la API, variables, comentarios ni los mensajes `detail=` del backend.

### Pendiente del backend (no se toco en J)
- ~35 mensajes `detail=` del backend salen sin tilde (ej. "Correo o contrasena incorrectos") y los textos que el backend genera para la bitacora/historial (ej. "Creo categoria X", "Anulo gasto ..."). Las pruebas del frontend y las E2E los siguen esperando sin tilde. Corregirlos es un cambio de backend + sus pruebas y de las E2E que los leen.

### Pruebas (cierre de la Fase 18)
Vitest **1140/1140** (59 archivos), E2E de desarrollo **100/100** y E2E de la app compilada (PWA) **3/3**; `tsc` (app y E2E) y `npm run build` compilan. El backend no se toco (pytest sigue en 890). Cada bloque se verifico con una corrida completa en serie, y las pruebas nuevas se comprobaron con mutaciones (se rompe el codigo y la prueba tiene que fallar).
- **Pruebas nuevas (unitarias):** `PaginaNuevo.test` (atajos de fecha, error enfocado), `useDialogo`, `useDialogo.autofoco`, `DialogoConfirmar`, `MenuFila.teclado`, `Aviso.roles`, `DialogoAnular.dialogo`, `Layout`, `Layout.activo`, `Layout.insignia`, `PaginaLista.volver`, `PaginaLista.dias`, `movimientos/agrupar`, `ChipFiltro`, `EtiquetaSync`, `FilaActividad.pildora`, `FilaActividad.autor`, `BarraSync.compacta`, `Actividad.chips`, `Montos.nowrap`, `PorPersona.nowrap` y `Reportes.comparacion`. Se borro `BotonNuevo.test`.
- **Pruebas nuevas (E2E):** `dialogos.spec.ts` (3) y `navegacion.spec.ts` (4).
- **Pruebas existentes que cambiaron (y por que):**
  - E2E `apoyos.spec.ts` y `familia.spec.ts`: sin `page.once("dialog")`, ahora hacen clic en Confirmar (bloque E: el `confirm()` nativo paso a dialogo propio).
  - E2E `historial.spec.ts`: los filtros de Actividad son chips con hoja en vez de `<select>`, y dos busquedas de monto se acotaron a `fila-lista` porque el total del dia repite el monto de la unica fila (bloque G).
  - E2E `visual.spec.ts` (linea 352): espera el encabezado "Resumen" en vez de `comparacion-ingresos`, que ya no existe cuando el periodo anterior esta vacio (bloque H).
  - E2E `sin-conexion.spec.ts` (REINTENTO AUTOMATICO): `expect(intentos).toBe(1)` paso a `expect.poll`, era una carrera de la propia prueba (bloque H).
  - Unitarias: `PaginaInicio.test` (2, el "+" ya no es de Inicio), `PaginaApoyos.test` (3 de confirmar, 1 por los montos sin partir y 2 por la barra inferior apilada), `Pantallas.test` (2 de restablecer clave), `Historial.test` (filtros como chips) y `PaginaReportes.test` (1: sin base ya no hay "+Bs ...").

### Avisos conocidos
- **(a)** Una E2E que pulse el "+" estando en `/nuevo` o `/editar/...` debe forzar el clic (`click({ force: true })`): el "+" lleva `aria-disabled="true"` y Playwright lo da por no clicable y espera sin terminar.
- **(b)** `ElegirPersonas` (privacidad) no usa `Fondo`: no tiene Escape ni trampa de Tab y queda desplazado 8 px por el `space-y-2` de `SelectorVisibilidad`. Pendiente (se dejo intacto por la regla de no tocar privacidad).
- **(c)** Montos partidos en dos lineas: resuelto en G ("entregado Bs 150.00" y la linea por persona de Reportes) y H (barra "Devuelto / Consumido / Pendiente" de Apoyos). No queda ninguno conocido.
- **(d)** Las capturas de `web_arca/capturas/mejoras/` (antes-X / despues-X) y su script (`e2e/mejoras-capturas/mejoras.captura.ts`, `playwright.capturas.config.ts`) **no son parte de la suite**: se corren a mano con `CAPTURA_FASE=<nombre> npx playwright test -c playwright.capturas.config.ts` (mismo backend de pruebas y mismos puertos: no correr a la vez que pytest ni las E2E). La carpeta `capturas/` esta en `.gitignore`.
- **(e)** No hay repositorio git (ni en `Arca/`, ni en `web_arca/`, ni en `backend_arca/`): los cambios de esta fase no estan en ningun commit. Si se crea uno, `capturas/` esta en `.gitignore` y el script de capturas esta en `e2e/mejoras-capturas/` (no en una carpeta llamada `capturas`, que tambien se habria ignorado).
- Sin hacer (propuestos en el analisis): I (periodo compacto) y K (formato es-BO de los montos). J hecho (queda el pendiente de backend de arriba).

Fase 18: bloques A-H, D2 y J terminados.
