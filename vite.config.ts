import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { sites } from "./build/sites-vite-plugin";

const serverEnvironmentKeys = [
  "MODU_BRAIN_ANALYSIS_PROVIDER",
  "MODU_BRAIN_OPENAI_ENABLED",
  "MODU_BRAIN_OPENAI_MODEL",
  "MODU_BRAIN_OPENAI_REASONING_EFFORT",
  "OPENAI_API_KEY",
  "SAFETY_IDENTIFIER_SECRET",
  "SUPABASE_ANON_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_URL",
];

export default defineConfig(async ({ mode, command }) => {
  const fileEnvironment = loadEnv(mode, process.cwd(), "");

  for (const key of serverEnvironmentKeys) {
    if (!process.env[key] && fileEnvironment[key]) process.env[key] = fileEnvironment[key];
  }

  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/wrangler.log";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";
  if (command === "serve") {
    process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV ??= "true";
  }

  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    plugins: [
      react(),
      sites(),
      cloudflare({ configPath: "./wrangler.sites.jsonc" }),
    ],
  };
});
