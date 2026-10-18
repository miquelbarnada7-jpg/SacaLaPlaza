# Tema Común · Guía para publicar la web

Esta carpeta tiene todo lo necesario para poner la web en Internet con su propio dominio, cobrar Premium por PayPal y mostrar anuncios de Google AdSense. Sigue los pasos en orden. Calcula una tarde para los pasos 1 a 6 y unos días de espera para la aprobación de AdSense.

## Qué hay en la carpeta

| Carpeta o archivo | Para qué sirve |
|---|---|
| `public/` | La web: la portada, una página por oposición, el banco de preguntas y la configuración. |
| `public/config.js` | **El único archivo que tienes que editar**: tu email, tus datos legales, PayPal y AdSense. |
| `functions/` y `lib/` | El pequeño servidor que cobra con PayPal y genera los códigos Premium. No hay que tocarlos. |
| `herramientas/generar-codigo.mjs` | Crea códigos Premium a mano si algún día vendes por Bizum o transferencia. |

Coste total para empezar: solo el dominio (unos 10 € al año). El alojamiento en Cloudflare es gratis.

---

## Paso 1 · Compra un dominio

1. Elige un nombre corto y fácil de escribir, por ejemplo `temacomun.es`.
2. Cómpralo en un registrador como DonDominio, Dinahosting, Namecheap o el propio Cloudflare. Un `.es` o un `.com` cuesta entre 7 y 15 € al año.
3. Guarda el usuario y la contraseña del registrador: los necesitarás en el paso 4.

## Paso 2 · Sube la carpeta a GitHub

GitHub guarda tu web y avisa a Cloudflare cada vez que cambias algo.

1. Crea una cuenta gratis en github.com.
2. Pulsa **New repository**, ponle de nombre `tema-comun`, déjalo en **Private** y pulsa **Create repository**.
3. En la página del repositorio vacío, pulsa **uploading an existing file**.
4. Arrastra **el contenido** de esta carpeta (las carpetas `public`, `functions`, `lib`, `herramientas` y este `LEEME.md`), no la carpeta que las contiene. Hazlo desde Chrome o Edge para que se respeten las subcarpetas.
5. Pulsa **Commit changes**.

## Paso 3 · Publica la web en Cloudflare Pages

1. Crea una cuenta gratis en dash.cloudflare.com.
2. Ve a **Workers & Pages → Create → Pages → Connect to Git** y elige tu repositorio `tema-comun`.
3. En la configuración de compilación pon:
   - **Framework preset**: None
   - **Build command**: déjalo vacío
   - **Build output directory**: `public`
4. Pulsa **Save and Deploy**. En un minuto tendrás la web en una dirección del tipo `tema-comun.pages.dev`. Ábrela y comprueba que funciona.

Cloudflare detecta solo la carpeta `functions/`: ahí está el servidor de pagos.

## Paso 4 · Conecta tu dominio

1. En tu proyecto de Cloudflare Pages, ve a **Custom domains → Set up a custom domain** y escribe tu dominio.
2. Cloudflare te dirá qué hacer: o mover los DNS del dominio a Cloudflare (recomendado, te guía paso a paso) o añadir un registro CNAME en tu registrador.
3. Puede tardar desde unos minutos hasta 24 horas. El certificado https se crea solo.

## Paso 5 · Rellena tus datos

Abre `public/config.js` en GitHub (pulsa el archivo y luego el lápiz para editar) y cambia:

```js
siteUrl: "https://temacomun.es",        // tu dominio
contactEmail: "hola@temacomun.es",      // un email que leas
legal: {
  titular: "Nombre Apellido Apellido",
  nif: "12345678Z",
  domicilio: "Calle, número, CP, ciudad",
  email: "hola@temacomun.es"
}
```

La ley española (LSSI) obliga a mostrar estos datos en el aviso legal si la web tiene anuncios o vende algo. Pulsa **Commit changes**: Cloudflare vuelve a publicar la web sola en un minuto.

Haz lo mismo en `public/sitemap.xml` y `public/robots.txt`: sustituye `TU-DOMINIO.es` por tu dominio.

## Paso 6 · Cobra Premium con PayPal

### 6.1 Cuenta y claves

1. Crea una cuenta **PayPal Business** en paypal.com/es (se puede como particular o autónomo). Si ya tienes una cuenta personal, puedes convertirla.
2. Entra en developer.paypal.com con esa cuenta y ve a **Apps & Credentials**.
3. Arriba verás un interruptor **Sandbox / Live**. Empieza en **Sandbox** (pruebas sin dinero real).
4. Pulsa **Create App**, ponle de nombre `Tema Comun` y tipo **Merchant**. Copia el **Client ID** y el **Secret**.

### 6.2 Variables secretas en Cloudflare

En Cloudflare, en tu proyecto: **Settings → Variables and Secrets → Add**. Crea estas cinco, en el entorno **Production**:

| Nombre | Valor | Tipo |
|---|---|---|
| `PAYPAL_CLIENT_ID` | el Client ID de PayPal | Text |
| `PAYPAL_CLIENT_SECRET` | el Secret de PayPal | **Secret** |
| `PAYPAL_ENV` | `sandbox` (luego `live`) | Text |
| `LICENSE_SECRET` | una frase larga inventada, de 40 caracteres o más | **Secret** |
| `PRICE` | `2.00` | Text |

`LICENSE_SECRET` firma los códigos Premium. Guárdala en un sitio seguro y no la cambies nunca: si la cambias, los códigos ya vendidos dejarán de funcionar.

Después, ve a **Deployments** y pulsa **Retry deployment** en el último para que se apliquen.

### 6.3 Activa el botón

En `public/config.js` pon tu Client ID:

```js
paypalClientId: "AbCdEf...",   // el mismo Client ID de PAYPAL_CLIENT_ID
```

### 6.4 Prueba con dinero ficticio

1. En developer.paypal.com → **Testing Tools → Sandbox Accounts** tienes una cuenta de comprador de prueba (personal). Mira su email y contraseña.
2. Abre tu web, ve a **Premium**, marca la casilla y paga con esa cuenta de prueba.
3. Debe aparecer «Premium activado» y tu código. Comprueba que desaparecen los anuncios.

### 6.5 Pasa a cobrar de verdad

1. En developer.paypal.com cambia el interruptor a **Live**, crea otra app igual y copia sus claves **Live**.
2. En Cloudflare cambia `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` y pon `PAYPAL_ENV` en `live`. Vuelve a publicar.
3. En `config.js` pon el Client ID **Live**.

Cuánto te queda: PayPal cobra en España un 2,90 % + 0,35 € por venta, así que de cada 2 € recibes unos 1,59 €. Si en el futuro quieres pagar menos comisión, Stripe cobra 1,5 % + 0,25 € con tarjetas europeas (te quedarían 1,72 €); dímelo y lo adaptamos.

### ¿Y por transferencia o Bizum?

No lo recomiendo como método principal: tendrías que comprobar cada pago a mano y enviar el código tú mismo, y la gente abandona si no recibe Premium al momento. Si aun así quieres ofrecerlo:

1. Escribe las instrucciones en `manualPayment` de `config.js`, por ejemplo: `"Bizum al 600 000 000 con el concepto TEMA y tu email. Te enviamos el código en 24 horas."`
2. Cuando recibas un pago, genera el código en tu ordenador (necesitas Node.js instalado):
   ```
   LICENSE_SECRET="tu-frase-secreta" node herramientas/generar-codigo.mjs "Bizum Ana 12-11-2026"
   ```
3. Envía ese código por email. La persona lo pega en la página Premium, en «¿Ya lo compraste?».

No publiques tu IBAN en la web: pásalo solo por email a quien te lo pida.

## Paso 7 · Que Google encuentre la web

1. Entra en search.google.com/search-console con tu cuenta de Google.
2. Añade tu dominio como **propiedad de dominio** y verifica con el registro DNS que te indica (en Cloudflare: **DNS → Add record → TXT**).
3. Ve a **Sitemaps** y envía `https://tudominio/sitemap.xml`.

Cada oposición tiene su propia página (por ejemplo `/oposiciones/justicia/`) con su título y descripción para buscadores, así puedes aparecer en búsquedas como «test justicia gratis».

## Paso 8 · Pon anuncios con Google AdSense

AdSense revisa la web antes de aprobarla. Ayuda tener el dominio propio, las páginas legales rellenas y algo de tráfico. La aprobación suele tardar de unos días a dos semanas.

1. Entra en adsense.google.com y regístrate con tu dominio.
2. AdSense te dará tu ID de editor, del tipo `ca-pub-1234567890123456`.
3. Para verificar el sitio, elige el método **fragmento de ads.txt**: abre `public/ads.txt` y sustituye `pub-0000000000000000` por tu ID (sin el `ca-`). Guarda.
4. En `public/config.js` pon:
   ```js
   adsenseClient: "ca-pub-1234567890123456",
   ```
5. **Aviso de cookies (obligatorio en Europa)**: en AdSense ve a **Privacidad y mensajes → Europa (RGPD) → Crear mensaje**, elige tu sitio, el idioma español y publícalo. Es la herramienta de consentimiento certificada de Google: sin ella Google no muestra anuncios a usuarios europeos.
6. Pulsa **Solicitar revisión** en AdSense y espera.
7. Cuando te aprueben, activa los **anuncios automáticos** en AdSense (**Anuncios → Por sitio**). Si prefieres controlar dónde aparecen, crea tres bloques de anuncios «display» y pega sus IDs en `adSlots` de `config.js` (`top`, `middle`, `bottom`).

**Premium sin anuncios ya está programado**: si alguien tiene Premium, la web no carga el código de AdSense en absoluto.

Los anuncios nunca aparecen dentro del test, junto a los botones de respuesta: AdSense penaliza los clics accidentales.

## Paso 9 · Impuestos (resumen, consulta a un gestor)

- Los ingresos de AdSense y las ventas de Premium hay que declararlos en el IRPF.
- Si vendes de forma habitual, Hacienda y la Seguridad Social pueden considerarlo actividad económica, lo que implica darse de alta como autónomo. Consulta a una gestoría antes de empezar a cobrar.
- El precio de 2 € se muestra «IVA incluido». Si estás de alta, el IVA (21 %) sale de esos 2 €.

## Cómo conseguir visitas

- **Publica la pregunta del día** en TikTok, Instagram y X: una captura de la pregunta y la respuesta al día siguiente. Los opositores comparten mucho.
- **Comparte el resultado del test del día** (el botón «Copiar resultado») en grupos de Telegram y WhatsApp de opositores.
- **Aprovecha los exámenes cercanos**: el 25 de octubre de 2026 es el examen de Ayudantes de Instituciones Penitenciarias. Publica esa semana tests de LOGP y Reglamento Penitenciario.
- **Amplía preguntas** en las oposiciones con más búsquedas (Auxiliar del Estado, Guardia Civil, Policía Nacional). Más preguntas = más páginas vistas por visita = más ingresos.
- Responde dudas en foros y en Reddit (r/oposiciones) enlazando la web cuando aporte.

## Cómo hacer cambios más adelante

- **Cambiar textos, precio, PayPal o AdSense**: edita `public/config.js` en GitHub y guarda. Se publica solo.
- **Añadir preguntas**: están en `public/datos.js`, en el bloque de cada oposición. Cada pregunta es: referencia, enunciado, opciones (la primera es la correcta) y explicación.
- **Actualizar fechas de convocatorias**: en `public/datos.js`, en `CAL` (tabla del calendario) y `EVENTS` (aviso destacado de arriba).

Si algo no funciona, cuéntamelo con una captura y lo arreglamos.
