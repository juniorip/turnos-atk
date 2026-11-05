# Estado de registro durante la atención

La creación del ticket programa la consulta por DNI con `after`, sin bloquear
la respuesta de registro. La lectura autenticada de la cola también prepara los
clientes pendientes existentes, de dos en dos, en orden de llegada/prioridad.
El estado aparece junto al nombre completo;
si no cabe en el ancho disponible, continúa debajo sin cortar el nombre.

- ✓ Registrado: se encontró el DNI en un alias.
- ✕ Posiblemente no registrado: no apareció en las conversaciones revisadas.
- No se pudo comprobar: la consulta falló o la integración no está configurada.

La búsqueda conserva el límite existente de 100 páginas de 60 conversaciones;
una ausencia no prueba que el cliente nunca se haya registrado. El botón ↻
permite repetir la consulta si lo registran durante la atención. No hay consultas
periódicas adicionales de Pancake ni escrituras en Pancake. Cambiar de ticket cancela la
consulta anterior y evita mostrar su resultado en el cliente siguiente.

El endpoint del ticket responde únicamente con `registered` y `complete`.
Un asesor solo puede consultar tickets asignados a él en su sede, una jefa de
sede queda limitada a su sede y un administrador puede consultar cualquier ticket.
El endpoint administrador con notas, tarjetas y cuentas conserva sus permisos.

El nombre del ticket procede de la validación del documento en la página de
registro, no del nombre ni del alias de Pancake.

La opción «Activar registro del cliente» de efectivización y pago de deuda solo
aparece cuando la búsqueda muestra «Posiblemente no registrado». Se oculta al
consultar, ante errores y cuando ya está registrado. Una confirmación positiva
desactiva una selección de registro previa, y la finalización solo solicita el
registro si el estado negativo corresponde al ticket actual.

## Datos preparados durante la espera

`TicketPancakeSnapshot` conserva el resultado por ticket y DNI en la misma base
privada, con una reserva temporal para que varios asesores no repitan la consulta.
Los resultados positivos duran 15 minutos, las búsquedas sin coincidencia 2
minutos y los fallos tienen 30 segundos de espera antes de reintentarse. La reserva
vence en 55 segundos si un proceso se interrumpe; cada búsqueda tiene un límite
de 45 segundos. Las filas se eliminan al eliminar el ticket relacionado.

`/api/tickets/[id]/pancake-customer` entrega el resultado preparado o responde
202 y programa el trabajo pendiente. Solo el asesor asignado de esa sede (o un
administrador) puede leer estos datos; esto incluye a las jefas cuando atienden.
Los datos completos no se incluyen en la respuesta pública de la cola ni en las
pantallas de TV. El endpoint anterior de estado sigue devolviendo solo el estado.

Al abrir el llamado o la atención se muestran automáticamente bancos, tarjetas,
cuentas, CCI, perfil de comisión, correo, dirección, nombre del perfil y notas.
Se reutiliza el parser del buscador, incluidas ITB/IBK y la prioridad de las notas
para la comisión. El nombre validado por DNI del ticket no se reemplaza por el
perfil de Pancake. El botón ↻ fuerza una actualización del resultado preparado.

Los datos y credenciales no se incluyen en archivos del repositorio. Los cambios
de esquema se aplicaron únicamente en la base local durante esta implementación.

## Efectivización automática

Al agregar una operación de efectivización se muestran únicamente tarjetas y
bancos identificados en las notas del cliente. Cada tarjeta tiene su propia
opción con banco y cuatro dígitos; si solo consta el banco, se indica que no hay
terminación registrada. Los bancos habilitados con imagen local muestran su logo;
los otros usan una etiqueta de marca. No se inventan terminaciones ni tarjetas.

El perfil de 0.35%, 0.5% o 1% se toma automáticamente de Pancake, con prioridad de
las notas sobre el alias. Si falta o es ambiguo, se pide confirmarlo manualmente.
El asesor elige una tarjeta e ingresa el monto; la tarifa, el mínimo, la comisión
y el depósito se calculan automáticamente. El plazo solo se solicita para BanBif
y Scotiabank. Se pueden agregar varias operaciones y se actualiza el total.

Al finalizar se comprueba que la tarjeta siga en los datos cargados y se obtiene
de nuevo el plan a partir del perfil; el servidor recalcula la comisión usando
las mismas reglas. La operación guarda el banco, la tarifa, la comisión y el neto;
la selección de terminación de tarjeta pertenece al borrador de atención.
El flujo de pago de deuda conserva su selección y cálculo propios.
