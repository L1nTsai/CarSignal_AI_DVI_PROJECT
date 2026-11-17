import type { NextConfig } from "next";

// Allow the tunnel origin in dev (plan §12). Set PUBLIC_BASE_URL in .env.local.
const devOrigins: string[] = [];
try {
  if (process.env.PUBLIC_BASE_URL) devOrigins.push(new URL(process.env.PUBLIC_BASE_URL).host);
} catch {}
// Quick tunnels change URL every run; allow them by wildcard too.
devOrigins.push("*.trycloudflare.com", "*.ngrok-free.app", "*.ngrok.app");

const nextConfig: NextConfig = {
  allowedDevOrigins: devOrigins,
  serverExternalPackages: ["sharp"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
