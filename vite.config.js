import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        dashboard: "index.html",
        prestamos: "prestamos.html",
        nuevoPrestamo: "nuevo-prestamo.html",
        clientes: "clientes.html",
        pagos: "pagos.html",
        reportes: "reportes.html",
      },
    },
  },
});
