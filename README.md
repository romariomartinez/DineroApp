# PrestApp - Control de prestamos

Sistema web responsive para administrar prestamos, clientes, cuotas, pagos y reportes.

## Modulos

La app esta separada en paginas reales:

- `index.html`: Dashboard.
- `prestamos.html`: prestamos y cuotas.
- `nuevo-prestamo.html`: formulario de nuevo prestamo.
- `clientes.html`: clientes.
- `pagos.html`: registro de pagos.
- `reportes.html`: exportacion de datos.
- `login.html`: acceso por usuario y clave.

## Supabase

1. Crea un proyecto en Supabase.
2. Abre `SQL Editor`.
3. Ejecuta el archivo `supabase/schema.sql`.
4. Copia la URL del proyecto y la anon public key.
5. Crea `.env.local` usando `.env.example`:

```bash
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=TU_LLAVE_PUBLICA
```

## Notificaciones Firebase

La app registra el telefono con Firebase Cloud Messaging y guarda el dispositivo en Supabase. Cuando se registra un pago, PrestApp crea un evento de notificacion y llama la funcion de Vercel `api/send-payment-notification.js` para enviarlo con Firebase Admin.

Importante: las notificaciones solo llegan a telefonos que abrieron PrestApp, iniciaron sesion y tocaron el boton de notificaciones para aceptar permisos. Para clientes externos que no tienen acceso a la app, hace falta crearles un acceso propio o un enlace de registro.

En Firebase:

1. Crea un proyecto en Firebase.
2. Agrega una app Web.
3. Copia la configuracion web a las variables `VITE_FIREBASE_*`.
4. Ve a `Cloud Messaging > Web Push certificates` y genera/copia la VAPID key publica.
5. Ve a `Project settings > Service accounts` y genera una llave privada JSON.

En Vercel agrega tambien estas variables privadas:

- `SUPABASE_SERVICE_ROLE_KEY`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `APP_BASE_URL`

La `FIREBASE_PRIVATE_KEY` debe quedar con saltos `\n`, por ejemplo:

```bash
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nTU_LLAVE\n-----END PRIVATE KEY-----\n"
```

## Desarrollo local

En PowerShell, si `npm` falla por politicas de ejecucion, usa `npm.cmd`.

```bash
npm.cmd install
npm.cmd run dev
```

## GitHub

```bash
git init
git add .
git commit -m "Initial PrestApp"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/prestapp.git
git push -u origin main
```

## Login y usuarios

La app usa usuario y clave en pantalla. Internamente Supabase Auth guarda cada usuario como `usuario@prestapp.local`, pero la persona no tiene que escribir correo.

Cada prestamo se guarda con el `user_id` del usuario autenticado. Por eso cada persona entra con su usuario y solo ve su propia cartera.

En Supabase:

1. Ve a `Authentication > Providers` y deja activo `Email`.
2. Desactiva confirmacion obligatoria de email, porque los usuarios no entran con correo real.
3. En `Authentication > URL Configuration`, pon la URL de Vercel como `Site URL` y agregala tambien en `Redirect URLs`.
4. Ejecuta `supabase/schema.sql`.

Si sale `email rate limit exceeded`, espera unos minutos, confirma que la verificacion de email este desactivada y vuelve a intentar una sola vez.

Para crear el primer administrador:

1. Abre `login.html`.
2. Toca `Crear super usuario`.
3. Escribe un usuario, por ejemplo `admin`, y una clave.
4. Entra al modulo `Usuarios` para crear, activar o desactivar usuarios.

Si ya tenias datos reales antes de activar login, en Supabase debes asignarlos a un usuario:

```sql
update public.loans
set user_id = 'ID_DEL_USUARIO'
where user_id is null;
```

## Vercel

1. Entra a Vercel.
2. Importa el repositorio de GitHub.
3. Framework: Vite.
4. Agrega estas variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`
   - `VITE_FIREBASE_VAPID_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_CLIENT_EMAIL`
   - `FIREBASE_PRIVATE_KEY`
   - `APP_BASE_URL`
5. Deploy.

Importante: despues de publicar, crea los accesos desde `login.html` o desde `Authentication > Users` en Supabase.

## Android

La app esta preparada como PWA. En Android:

1. Abre el URL de Vercel en Chrome.
2. Toca el menu de tres puntos.
3. Toca `Instalar app` o `Agregar a pantalla principal`.
4. Confirma `Instalar`.

Android agregara el icono de PrestApp en la pantalla principal y se abrira como aplicacion independiente.

Si no aparece la opcion, copia el enlace y abrelo directamente en Chrome. Los navegadores internos de WhatsApp, Facebook o Instagram normalmente no muestran `Instalar app`.

## Error 404 de Supabase

Si en la consola aparece un `404` apuntando a una URL de Supabase como `/rest/v1/loans`, falta crear las tablas.
Ejecuta completo el archivo `supabase/schema.sql` en el `SQL Editor` de Supabase y vuelve a cargar la app.

## Datos demo

La app ya no crea datos de ejemplo automaticamente. Si en Supabase quedaron datos demo antiguos
como `Juan Perez`, `Ana Gomez`, `Luis Diaz`, `Maria Lopez` o `Carlos Ruiz`, ejecuta
`supabase/remove-demo-data.sql` en el `SQL Editor` para borrarlos.
