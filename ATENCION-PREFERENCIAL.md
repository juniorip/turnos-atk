# Atención preferencial — Turnos ATK

Versión actualizada a partir del proyecto local turnos-atk-rediseño-2026-09-16.

- Casilla «Atención preferencial» desactivada por defecto en registro público y recepción.
- El valor se guarda en el ticket y se valida como booleano en el servidor.
- Prioridad en el llamado manual, la asignación automática, la cola interna y la pantalla pública.
- Entre preferenciales se respeta la llegada; el ID desempata fechas iguales.
- Se mantienen la compatibilidad de trámites, la distribución de asesores y las atenciones en curso.
- Etiqueta visible «Preferencial» en la cola y en la confirmación.

## Publicado

Publicado el 24 de septiembre de 2026 en https://turnos-atk-vercel.vercel.app. La migración aditiva se ejecutó correctamente durante el despliegue. Compilación de producción correcta y formulario público verificado.

1. Configurar las variables de entorno del proyecto existente en el entorno de despliegue.
2. Ejecutar `prisma/changes/preferential.sql` en PostgreSQL antes de publicar la aplicación. Solo agrega una columna con valor false para los tickets existentes.
3. Ejecutar `prisma generate` y `next build`, y desplegar en el proyecto Vercel correspondiente a Turnos ATK.

La compilación ya no ejecuta `db push --accept-data-loss`; el cambio de base de datos es explícito y aditivo.

## Validación realizada

Compilación de producción y TypeScript correctos. Pruebas con base de datos simulada: creación preferencial y regular en ambos formularios/API, omisión de la marca, rechazo de valores no booleanos, prioridad y orden de llegada en el llamado manual y automático, bloqueo de otro llamado cuando ya existe atención activa. No se ejecutaron pruebas contra la base de producción.

