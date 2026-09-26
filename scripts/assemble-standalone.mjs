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
//
// Packages are copied together with their full production dependency
// closure, so a new transitive dependency can't silently go missing.
//
// Usage: node scripts/assemble-standalone.mjs [targetDir]   (default .next/standalone)
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { dirname, join, resolve } from 'path'

const root = resolve(dirname(new URL(import.meta.url).pathname), '..')
const target = resolve(root, process.argv[2] ?? '.next/standalone')

if (!existsSync(join(target, 'server.js'))) {
  console.error(`[assemble-standalone] ${target}/server.js not found — run \`next build\` first`)
  process.exit(1)
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
const RUNTIME_PACKAGES = ['.prisma', '@prisma/client', 'prisma', 'tesseract.js', 'tesseract.js-core']
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
