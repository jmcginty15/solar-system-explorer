import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/** Full page reload on src edits — more reliable than HMR for the WebGL canvas. */
function fullReloadOnSrcChange(): Plugin {
  return {
    name: "full-reload-on-src-change",
    handleHotUpdate({ file, server }) {
      if (!file.includes("/src/")) return;
      server.ws.send({ type: "full-reload", path: "*" });
      return [];
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), fullReloadOnSrcChange()],
  assetsInclude: ["**/*.exr"],
  server: {
    watch: {
      // Helps file watching stay reliable on some macOS / network FS setups.
      usePolling: false,
    },
    proxy: {
      // Forward API calls to the local FastAPI / spiceypy server.
      "/api": {
        // Prefer 8765 — Docker often already owns :8000 on this machine.
        target: "http://127.0.0.1:8765",
        changeOrigin: true,
      },
    },
  },
});
