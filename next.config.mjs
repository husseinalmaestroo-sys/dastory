import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // This repo is checked out inside dastory/, which has its own lockfile.
  // Next 15.5+ would otherwise infer the parent as the workspace root and
  // trace files from there. Pin it to this directory.
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  // pdf-parse / tesseract / canvas are native-ish CJS deps: keep them external
  // so Next bundles a require() call instead of trying to trace their internals.
  serverExternalPackages: [
    "pdf-parse",
    "pdfjs-dist",
    "tesseract.js",
    "@napi-rs/canvas",
  ],
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
