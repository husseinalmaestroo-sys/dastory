/** @type {import('next').NextConfig} */
const nextConfig = {
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
