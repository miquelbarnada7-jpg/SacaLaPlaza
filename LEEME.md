# SacaLaPlaza · Guía de la web

Web de tests gratis para oposiciones, con cuentas de usuario, Premium de pago único ligado a la cuenta y la herramienta «Sube tus apuntes», que convierte un PDF o un Word en un test adaptado a cada oposición.

Todo funciona gratis en Cloudflare Pages (dirección `sacalaplaza.pages.dev`). Esta guía explica qué hay en el proyecto y cómo dejarlo configurado.

## Qué hay en la carpeta

| Carpeta o archivo | Para qué sirve |
|---|---|
| `public/` | La web: portada, una página por oposición, «Sube tus apuntes», la calculadora de nota, el banco de preguntas y la configuración. |
| `public/config.js` | **El único archivo que tienes que editar**: email, datos legales, PayPal y AdSense. |
| `functions/api/[[path]].js` | El servidor: cuentas, sesiones, progreso, tests guardados, IA, Premium y test del día. |
| `lib/` | Piezas del servidor (contraseñas, base de datos, PayPal e IA). No hay que tocarlas. |

## Configuración en Cloudflare (una sola vez)

Todo se hace en Cloudflare → **Workers & Pages → sacalaplaza → Settings**.

### 1. Base de datos (D1) · obligatoria para las cuentas

1. En el menú de Cloudflare: **Storage & databases → D1 SQL database → Create database**. Nombre: `sacalaplaza`. Pulsa **Create**.
2. Vuelve a **Workers & Pages → sacalaplaza → Settings → Bindings → Add → D1 database**.
3. **Variable name**: `DB` (en mayúsculas). **D1 database**: `sacalaplaza`. Guarda.

Las tablas se crean solas la primera vez que alguien usa la web. No hay que ejecutar nada.

### 2. Inteligencia artificial (Workers AI) · para crear preguntas con IA

1. En **Settings → Bindings → Add → Workers AI**.
2. **Variable name**: `AI`. Guarda.

Es gratis hasta 10.000 «neuronas» al día (unos 70 tests de 10 preguntas con el modelo que usamos). Si un día se gasta, la web usa sola el generador rápido, que no tiene límite. Si la web crece, el plan Workers Paid (5 $/mes) da mucho más margen.

### 3. Variables y secretos

En **Settings → Variables and Secrets** deben estar estas (los nombres, exactamente así, en mayúsculas):

| Nombre | Valor | Tipo |
|---|---|---|
| `PAYPAL_CLIENT_ID` | el Client ID de PayPal | Text |
| `PAYPAL_CLIENT_SECRET` | el Secret de PayPal | Secret |
| `PAYPAL_ENV` | `sandbox` para pruebas, `live` para cobrar de verdad | Text |
| `LICENSE_SECRET` | una frase larga inventada (40 caracteres o más) | Secret |
| `PRICE` | `4.99` | Text |

`LICENSE_SECRET` protege las contraseñas y los códigos de recuperación. **No la cambies nunca**: si la cambias, nadie podrá iniciar sesión con su contraseña actual.

Opcionales:

| Nombre | Para qué |
|---|---|
| `AI_LIMIT_FREE` | Preguntas con IA al día por cuenta gratis (por defecto 20). |
| `AI_LIMIT_PREMIUM` | Preguntas con IA al día por cuenta Premium (por defecto 300). |
| `AI_MODELS` | Modelos de IA separados por comas, si quieres cambiarlos. |

### 4. Volver a publicar

Los cambios de enlaces (bindings) y variables solo se aplican en una publicación nueva. **No uses «Retry deployment» en un despliegue antiguo**: vuelve a publicar código viejo. Haz un cambio pequeño en GitHub (por ejemplo, un espacio en `public/config.js`) y Cloudflare publica la versión actual con la configuración nueva.

### 5. Comprobar que todo está bien

Abre `https://sacalaplaza.pages.dev/api/salud`. Debe salir algo así:

```
{"ok":true,"db":true,"ia":true,"paypal":true,"entorno":"sandbox","secreto":true,"tablas":true}
```

Si algún valor sale `false`, revisa el paso correspondiente.

## Cuentas de usuario

- Registro con email y contraseña. Al crear la cuenta, cada usuario recibe un **código de recuperación** (no hay envío de emails). Con ese código puede cambiar la contraseña si la olvida.
- Si alguien pierde también el código, puedes ayudarle desde la consola de D1 (ver «Tareas de administración»).
- Con la sesión iniciada, el progreso (respuestas, racha, fallos, marcadas) se sincroniza entre dispositivos.
- Desde «Mi cuenta» cada usuario puede cambiar la contraseña, cerrar sesión en otros dispositivos, descargar sus datos y borrar su cuenta.

## Premium

- Para comprar hay que tener cuenta. El pago se hace con PayPal (o tarjeta a través de PayPal) y la cuenta queda Premium para siempre, en cualquier dispositivo.
- Con Premium no se carga ningún anuncio.

### Probar el pago (modo sandbox)

1. Con `PAYPAL_ENV` = `sandbox`, entra en la web, crea una cuenta y ve a **Premium**.
2. Paga con la **cuenta de comprador de prueba** (developer.paypal.com → Testing Tools → Sandbox Accounts → la de tipo *Personal*, que acaba en `@personal.example.com`). No uses la cuenta *Business*: es la tuya como vendedor.
3. La cuenta debe pasar a Premium al momento.

### Cobrar de verdad

1. En developer.paypal.com cambia a **Live**, crea una app y copia sus claves Live.
2. En Cloudflare cambia `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` y pon `PAYPAL_ENV` en `live`.
3. En `public/config.js` pon el Client ID Live en `paypalClientId`. Guarda: se publica solo.

PayPal cobra en España 2,90 % + 0,35 € por venta: de cada 4,99 € te quedan unos 4,50 € (de los que unos 0,87 € son IVA).

## Sube tus apuntes

- Solo se aceptan **PDF** y **Word (.docx)**, hasta 40 MB. Los `.doc` antiguos se rechazan con un aviso para guardarlos como `.docx`.
- El documento se lee **en el navegador del usuario**; no se sube al servidor. Si el PDF está escaneado, se reconoce el texto con OCR (hasta 60 páginas por archivo).
- Se detectan los temas («Tema 1», «Título II», «Capítulo III», títulos de Word…) para que el usuario elija qué estudiar.
- Las preguntas se adaptan a la oposición elegida: **3 opciones en Policía Nacional** (cada fallo resta 1/2) y 4 en las demás, con su penalización.
- Dos formas de crear preguntas: **con IA** (Workers AI, con cupo diario) o con el **generador rápido** (sin límite, frases del texto con huecos en plazos, cifras, órganos y artículos). Si la IA falla o se agota el cupo, se completa con el generador rápido.
- Límites: cuenta gratis, tests de hasta 10 preguntas y 10 tests guardados; Premium, hasta 50 preguntas y 300 tests.
- Para la IA solo se envían al servidor fragmentos de texto, que no se guardan.

## Otras funciones

- **Calculadora de nota** (`/calculadora-nota/`): nota con penalización, netas y aciertos necesarios.
- **Comparativa del test del día**: al terminar, cada usuario ve qué porcentaje de opositores ha superado ese día (se muestra a partir de 10 participantes).

## Google y AdSense

- Search Console: añade la propiedad con **Prefijo de URL** (`https://sacalaplaza.pages.dev/`), verifica con **Archivo HTML** (súbelo a la carpeta `public/` desde GitHub: se conserva aunque se regenere la web) y envía `sitemap.xml` (se genera solo con todas las páginas).
- AdSense: pon tu ID (`ca-pub-…`) en `adsenseClient` de `public/config.js`. El archivo `ads.txt` se rellena solo con ese ID; compruébalo en `https://sacalaplaza.pages.dev/ads.txt`. Para verificar el sitio en AdSense, elige el método **ads.txt**.

### Aviso de cookies (obligatorio antes de mostrar anuncios en España)

La web ya está preparada: no carga anuncios ni cookies publicitarias hasta que Google pide el consentimiento, las fuentes y las librerías se sirven desde la propia web, y el pie tiene el enlace **Configurar cookies** para cambiar la elección. Solo falta crear el aviso en AdSense, que es gratis y está certificado por IAB Europe (lo exige Google en Europa desde el 16 de enero de 2024):

1. AdSense → **Privacidad y mensajes → Normativa europea → Crear mensaje**.
2. Sitio: `sacalaplaza.pages.dev`. Idioma: **Español**. Enlace a la política de privacidad: `https://sacalaplaza.pages.dev/#privacidad`.
3. En **Opciones de usuario** elige **Consentir, No consentir y Gestionar opciones**. Es importante: la AEPD exige que rechazar sea tan fácil como aceptar.
4. Activa la opción de mostrar el **icono o enlace para volver a cambiar la elección** si te la ofrece (la web ya trae su propio enlace «Configurar cookies»).
5. Pulsa **Publicar**. Desde ese momento, quien entre desde Europa verá el aviso antes de que se personalicen los anuncios.

## Tareas de administración (consola de D1)

En Cloudflare → **Storage & databases → D1 → sacalaplaza → Console** puedes ejecutar:

Dar Premium a mano (por ejemplo, si alguien paga por Bizum):

```sql
UPDATE users SET premium = 1, premium_at = strftime('%s','now') * 1000 WHERE email = 'correo@ejemplo.com';
```

Ver cuántas cuentas y cuántas Premium hay:

```sql
SELECT COUNT(*) AS cuentas, SUM(premium) AS premium FROM users;
```

Ver los pagos:

```sql
SELECT p.order_id, u.email, p.amount, datetime(p.created_at / 1000, 'unixepoch') AS fecha FROM payments p LEFT JOIN users u ON u.id = p.user_id ORDER BY p.created_at DESC;
```

Si alguien ha perdido la contraseña y el código de recuperación: comprueba que el email es suyo (que te escriba desde ese correo) y borra la cuenta para que se registre de nuevo; si era Premium, vuelve a darle Premium con la primera orden.

```sql
DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = 'correo@ejemplo.com');
DELETE FROM users WHERE email = 'correo@ejemplo.com';
```

## Impuestos y autónomo (resumen revisado en octubre de 2026; confírmalo con un gestor)

**Qué es fiscalmente esta web.** Cobrar anuncios y vender Premium de forma continuada es una *actividad económica*, aunque los importes sean pequeños.

**Alta en Hacienda (gratis).** Modelo 036 antes de empezar a cobrar, en el epígrafe de servicios de publicidad o de servicios digitales que te indique el gestor. En el mismo modelo pide el alta en el **ROI** (operadores intracomunitarios): AdSense te paga desde Google Ireland y sin ROI no puedes facturarle correctamente.

**IVA.**
- Premium (venta a particulares): se cobra IVA español del 21 % mientras tus ventas a consumidores de otros países de la UE no pasen de 10.000 € al año. Con 4,99 € IVA incluido, unos 0,87 € son IVA. Hoy no hay en España un mínimo de ventas por debajo del cual no se cobre IVA.
- AdSense (Google Ireland, empresa de la UE): factura sin IVA, por *inversión del sujeto pasivo*, e informa en el modelo 349.
- Declaraciones: modelo 303 cada trimestre y 390 al año.

**IRPF.** Los beneficios (ingresos menos gastos) tributan en tu renta como rendimientos de actividades económicas. Normalmente hay que presentar el modelo 130 cada trimestre (pago a cuenta del 20 % del beneficio).

**Autónomo (Seguridad Social).**
- El Tribunal Supremo (sentencia 941/2025, de 10 de julio) aclaró que ganar menos que el salario mínimo **no exime por sí solo** del alta: cuenta si la actividad es habitual. El SMI solo es un criterio orientativo (salvo para pensionistas, para quienes sí es el límite).
- Si te das de alta por primera vez (o no lo estuviste en los últimos 2 años): **tarifa plana de 80 € al mes** durante 12 meses, y otros 12 si tus ingresos netos previstos son inferiores al SMI.
- Después, la cuota depende del rendimiento neto: el tramo más bajo (hasta 670 € al mes) está en torno a 205 € al mes en 2026.

**Facturación.** Guarda los justificantes de PayPal y de Google. El sistema **Verifactu** (software de facturación homologado) será obligatorio para autónomos desde el **1 de julio de 2027** (Real Decreto-ley 15/2025).

**Consejo práctico.** Mientras la web no genere ingresos no hay nada que declarar. Antes del primer cobro real (AdSense aprobado o PayPal en modo Live), habla con un gestor para el 036, el ROI y la decisión sobre el alta de autónomo. PayPal cobra en España 2,90 % + 0,35 € por venta, que es un gasto deducible.
