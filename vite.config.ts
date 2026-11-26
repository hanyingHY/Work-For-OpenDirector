import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import type { ProxyOptions } from "vite";

// The local API serves projects, model settings and generation tasks.
const api: Record<string, ProxyOptions> = {
  "/api": {
    target: process.env.OPENDIRECTOR_API_URL ?? "http://127.0.0.1:8000",
    changeOrigin: true,
    configure(proxy) {
      proxy.on("proxyReq", (upstream, request, response) => {
        // Normalize proxied Origin so remote preview hosts (e.g. cloud sandboxes)
        // talk cleanly to the loopback FastAPI host without relaxing API security.
        if (request.headers.origin) {
          upstream.setHeader("origin", "http://127.0.0.1:5173");
        }
        // Forward browser cancellation too: transient SAM previews should stop
        // inference when their editor closes, including behind the dev proxy.
        response.on("close", () => {
          if (!response.writableEnded) upstream.destroy();
        });
      });
    },
  },
};

// Machine-local toolchains and project data are not frontend source files.
const ignoredDirectories = [
  "**/.toolchain/**",
  "**/.venv/**",
  "**/projects/**",
  "**/.opendirector/**",
];

export default defineConfig({
  plugins: [react()],
  server: {
    host: process.env.OPENDIRECTOR_BIND_HOST ?? "127.0.0.1",
    port: 5173,
    allowedHosts: true,
    proxy: api,
    watch: { ignored: ignoredDirectories },
  },
  preview: {
    host: process.env.OPENDIRECTOR_BIND_HOST ?? "127.0.0.1",
    allowedHosts: true,
    proxy: api,
  },
});
