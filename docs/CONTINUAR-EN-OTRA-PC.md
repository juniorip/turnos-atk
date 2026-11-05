# Continuar en otra PC

Rama de trabajo: `codex/portal-login`. Conservar cualquier cambio local antes de
cambiar de rama o actualizar. No se necesita trabajar sobre `main`.

```sh
git switch codex/portal-login
git pull --ff-only origin codex/portal-login
npm install
```

## Últimos cambios

- Acceso demo directo en `/acceso-local.html`, sin necesitar el portal 3100.
- Validación de nombre completo por DNI desde la página `/registro/LIN`.
- Consulta de Pancake en segundo plano mientras el ticket espera.
- Estado de registro y datos completos al llamar/atender; actualización con ↻.
- Tarjetas registradas, logos, comisión y depósito automáticos para efectivización.
- Pago de deuda conserva su cálculo anterior.

Las reglas y el funcionamiento se documentan en `COMISIONES.md` y
`ESTADO-PANCAKE.md`.

## Configuración local

Las credenciales y la base local no están en GitHub. Conservar o configurar en
`.env.local` las variables privadas de la PC: `DATABASE_URL`, `AUTH_SECRET`,
`PANCAKE_PAGE_ID` y `PANCAKE_PAGE_ACCESS_TOKEN`. La demo requiere
`TURNOS_LOCAL_DEMO_AUTH=1` y `npm run dev`; nunca utiliza la autenticación demo
en producción. Sin `JSONPE_API_TOKEN`, la demo valida documentos a través del
servicio ya publicado de Turnos.

El esquema incorpora `TicketPancakeSnapshot`. Después de instalar dependencias,
con la conexión apuntando a la **base local de pruebas**, sincronizar el esquema:

```sh
npx prisma db push
npm run db:seed:local-demo
npm run dev -- --hostname 127.0.0.1 --port 3000
```

El seed demo solo acepta una base local en `127.0.0.1` o `localhost`, puerto
5433. Esa base debe estar iniciada antes de sincronizar o ejecutar el seed.
Los tickets de prueba de esta PC no se transfieren mediante GitHub.

Accesos: `/acceso-local.html` para atención, `/buscar-cliente.html` para el
buscador administrador y `/registro/LIN` para crear tickets.

## Validación

TypeScript y las pruebas nuevas pasan. La última ejecución completa tuvo 56
pruebas correctas de 58; permanecen dos fallos anteriores: preservación de rol
en autenticación externa y concurrencia de asignación de cola. No se han
modificado esos comportamientos como parte de este trabajo.

Esta entrega a GitHub no publica los cambios nuevos en Vercel.
