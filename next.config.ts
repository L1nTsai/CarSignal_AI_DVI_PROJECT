import type { NextConfig } from "next";

// Allow the tunnel origin in dev (plan §12). Set PUBLIC_BASE_URL in .env.local.
const devOrigins: string[] = [];
try {
  if (process.env.PUBLIC_BASE_URL) devOrigins.push(new URL(process.env.PUBLIC_BASE_URL).host);
} catch {}
// Quick tunnels change URL every run; allow them by wildcard too.
devOrigins.push("*.trycloudflare.com", "*.ngrok-free.app", "*.ngrok.app");
// Phone on the same Wi-Fi (npm run dev:lan). Change this if the Mac's address changes.
devOrigins.push("192.168.1.158");

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
