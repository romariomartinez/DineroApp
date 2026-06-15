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
- `login.html`: acceso por correo y clave.

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

## Login

La app usa Supabase Auth. En Supabase, revisa `Authentication > Providers` y deja activo el proveedor `Email`.

Cada prestamo se guarda con el `user_id` del usuario autenticado. Por eso cada persona entra con su correo y solo ve su propia cartera.

En `Authentication > URL Configuration`, pon la URL de Vercel como `Site URL` y agregala tambien en `Redirect URLs`.

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
5. Deploy.

Importante: despues de publicar, crea los accesos desde `login.html` o desde `Authentication > Users` en Supabase.

## Error 404 de Supabase

Si en la consola aparece un `404` apuntando a una URL de Supabase como `/rest/v1/loans`, falta crear las tablas.
Ejecuta completo el archivo `supabase/schema.sql` en el `SQL Editor` de Supabase y vuelve a cargar la app.

## Datos demo

La app ya no crea datos de ejemplo automaticamente. Si en Supabase quedaron datos demo antiguos
como `Juan Perez`, `Ana Gomez`, `Luis Diaz`, `Maria Lopez` o `Carlos Ruiz`, ejecuta
`supabase/remove-demo-data.sql` en el `SQL Editor` para borrarlos.
