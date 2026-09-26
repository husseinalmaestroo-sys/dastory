#!/usr/bin/env node
// Turns `next build`'s .next/standalone output into a complete, runnable
// server directory — the one the Docker image ships and the HTTP-level test
// suite (src/__http__) starts. Keeping this in one script means the tests
// exercise exactly the file layout production runs, instead of two copies of
// the list drifting apart.
//
// `next build` output tracing only follows static imports, so it leaves out:
//   - .next/static and public/ (documented Next.js behavior)
//   - the Prisma CLI, schema and migrations (needed for `migrate deploy` on
//     the box, never imported by app code)
//   - tesseract.js's worker script, WASM core and the worker's own
//     dependencies (spawned/loaded by file path at runtime)
//   - the bundled OCR language models
//   - scripts/platform-admin.mjs (operator CLI, see ARCHITECTURE.md)
//   - packages that load their own dependencies dynamically — e.g. pdf-parse
//     -> pdfjs-dist -> @napi-rs/canvas (without it every route that imports
//     the PDF extractor fails to load: contract review, case analysis, OCR)
//
// Every package in next.config.ts's serverExternalPackages, plus the ones
// listed below, is copied together with its full production dependency
// closure, so a new transitive dependency can't silently go missing.
//
// Usage: node scripts/assemble-standalone.mjs [targetDir]
//   default targetDir: .next/standalone (assembled in place). Any other
//   directory gets a fresh copy of .next/standalone first — the HTTP and E2E
//   suites use one OUTSIDE the repo, so Node can't quietly resolve a missing
//   package from the repo's own node_modules (which is how the pdf-parse gap
//   above once went unnoticed).
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { dirname, join, resolve } from 'path'

const root = resolve(dirname(new URL(import.meta.url).pathname), '..')
const built = join(root, '.next/standalone')
const target = resolve(root, process.argv[2] ?? '.next/standalone')

if (!existsSync(join(built, 'server.js'))) {
  console.error(`[assemble-standalone] ${built}/server.js not found — run \`next build\` first`)
  process.exit(1)
}
if (target !== built) {
  rmSync(target, { recursive: true, force: true })
  cpSync(built, target, { recursive: true, dereference: true })
}

function copy(from, to, opts = {}) {
  const src = join(root, from)
  if (!existsSync(src)) {
    console.error(`[assemble-standalone] missing ${from}`)
    process.exit(1)
  }
  const dest = join(target, to ?? from)
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dirname(dest), { recursive: true })
  cpSync(src, dest, { recursive: true, dereference: true, ...opts })
}

copy('.next/static')
copy('public')
copy('ocr-models')
copy('prisma/schema.prisma')
copy('prisma/migrations')
copy('scripts/platform-admin.mjs')

// Node packages + their production dependency closure (hoisted layout).
const nextConfig = readFileSync(join(root, 'next.config.ts'), 'utf8')
const externals = /serverExternalPackages:\s*\[([^\]]*)\]/.exec(nextConfig)
if (!externals) {
  console.error('[assemble-standalone] could not read serverExternalPackages from next.config.ts')
  process.exit(1)
}
const RUNTIME_PACKAGES = [
  ...externals[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean),
  '.prisma', 'prisma', 'tesseract.js-core',
]
const seen = new Set()
function copyPackage(name, optional = false) {
  if (seen.has(name)) return
  const dir = join('node_modules', name)
  if (!existsSync(join(root, dir))) {
    if (optional) return
    console.error(`[assemble-standalone] missing package ${name}`)
    process.exit(1)
  }
  seen.add(name)
  copy(dir)
  const pkgFile = join(root, dir, 'package.json')
  if (!existsSync(pkgFile)) return
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
  for (const dep of Object.keys(pkg.dependencies ?? {})) copyPackage(dep)
  // Optional deps are platform-specific (e.g. fsevents): copy only if installed.
  for (const dep of Object.keys(pkg.optionalDependencies ?? {})) copyPackage(dep, true)
}
RUNTIME_PACKAGES.forEach((name) => copyPackage(name))

console.log(`[assemble-standalone] ${target} ready (${seen.size} runtime packages)`)
