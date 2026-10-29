# Turnos ATK

Aplicación independiente para recepción, cola digital y atención por sede.

## Puesta en marcha

1. Para uso local, copia `.env.example` como `.env` y configura `DATABASE_URL` para una base PostgreSQL de desarrollo, `AUTH_SECRET` y `JSONPE_API_TOKEN`.
2. El proyecto utiliza PostgreSQL; no crea una base SQLite local automáticamente.
3. Ejecuta `npm.cmd run db:push` para crear las tablas en la base de desarrollo.
4. Solo en una base de desarrollo, ejecuta `npm.cmd run db:seed` para configurar el acceso inicial y los trámites base. Este comando restablece la contraseña de los usuarios `jefe` y `recepcion` existentes.
5. Ejecuta `npm.cmd run dev`.

En PowerShell, `npm.cmd` permite usar npm sin ejecutar el archivo `npm.ps1`. Para verificar la compilación de producción, ejecuta `npm.cmd run build`.

`AUTH_SECRET` es obligatorio para usar sesiones. No se aceptan valores vacíos ni los secretos de ejemplo del proyecto. En Vercel, conserva el valor privado existente en las variables del entorno correspondiente; cambiarlo invalida las sesiones anteriores. La compilación no necesita esta variable, pero iniciar sesión sí. Si falta, configura un secreto aleatorio privado antes de desplegar. El proyecto no genera ni reemplaza automáticamente esta clave.

Para vincular cuentas, configura `REGISTROS_ATK_URL` con la URL de Registros ATK. Turnos valida cada usuario y contraseña directamente allí; no recibe ni almacena la contraseña de Registros como credencial local. Configura también el mismo `REGISTROS_ATK_SHARED_SECRET` en ambos proyectos para habilitar la sincronización de usuarios. Las cuentas sincronizadas conservan en Turnos sus permisos de atención, módulo y activación; su sede se actualiza desde Registros ATK. Las jefaturas solo reciben la lista de usuarios y estadísticas de su sede; la vista global corresponde al administrador.

Para ejecutar las pruebas de sesiones y concurrencia con base simulada: `node --test tests/session-queue.test.cjs`. Los llamados manuales y automáticos comparten un bloqueo transaccional PostgreSQL por sede; las lecturas usan `ReadCommitted` para ver las asignaciones confirmadas después de esperar. Estas pruebas no sustituyen una prueba de integración con PostgreSQL.

## Correcciones de prioridad alta — 3 de octubre de 2026

Ejecuta `npm.cmd test` para verificar permisos, revocación de sesiones, concurrencia de cierre/estados, numeración, errores externos y aislamiento de formularios. Estas pruebas ejecutan código real con dependencias simuladas; no usan una base real ni proveedores externos.

Las sesiones consultan la cuenta actual y quedan invalidadas al cambiar la contraseña o desactivar la cuenta. Las sesiones emitidas antes de esta corrección requieren volver a iniciar sesión. Se conserva `AUTH_SECRET`; no se necesita modificar el esquema ni migrar tablas.

La sincronización externa conserva los permisos, sede y activación de las cuentas locales existentes. Las cuentas nuevas requieren asignación local de trámites y módulo. El inicio de sesión respeta las pausas existentes.

La numeración y la creación comparten una transacción y bloqueo por sede; el corte diario usa America/Lima. Cierre y confirmación de llamados cambian de estado de forma condicional y registran un único historial.

Una atención fallida no registra operaciones nuevas ni cuenta como conversión exitosa. La interfaz avisa antes de descartar un borrador de operaciones; una operación realizada debe cerrarse como exitosa. Los indicadores comerciales excluyen operaciones de fallidos históricos sin borrar esos datos.

Un error de red de Registros ATK se devuelve como fallo de integración junto al cierre local exitoso. El envío tiene un límite de 10 segundos. Sigue pendiente una cola persistente de reintentos y conciliación externa; no se reenvía automáticamente un cierre ya confirmado.

El acceso inicial es `admin` / `Cambiar123!`; debe cambiarse antes de usar el sistema. El esquema actual ya utiliza PostgreSQL.

## Incluido en esta primera entrega

- Inicio de sesión por rol y sede.
- Recepción: creación de tickets digitales.
- Cola por sede en orden de llegada.
- Reclamo concurrente de turnos: dos trabajadores no pueden tomar el mismo ticket.
- Atención: finalizar como exitosa o fallida y registrar el historial de estados.
- Estructura preparada para múltiples operaciones, bancos y tasas configurables.
- Panel responsive de recepción, trabajador y jefatura/administración.

La impresión se mantiene separada de la creación de tickets y no se implementa en esta fase.
