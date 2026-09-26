// Every API route loads and answers in the production bundle. A route whose
// module (or one of its dependencies) is missing from the standalone output
// fails at import time with a 500 for every caller — which is exactly how
// the contract-review / case-analysis routes once broke (pdf-parse's
// dynamically loaded @napi-rs/canvas was not traced). Anonymous calls are
// enough to force each module to load; none of them may 500.
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'
import { describe, expect, it } from 'vitest'
import { http } from './client'

const API_DIR = join(process.cwd(), 'src/app/api')
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return routeFiles(full)
    return name === 'route.ts' ? [full] : []
  })
}

const routes = routeFiles(API_DIR).flatMap((file) => {
  const source = readFileSync(file, 'utf8')
  const path = '/api/' + relative(API_DIR, file).split(sep).slice(0, -1)
    .map((seg) => seg.replace(/^\[.*\]$/, 'probe-id')).join('/')
  return METHODS
    .filter((m) => new RegExp(`export (const|async function|function) ${m}\\b`).test(source))
    .map((method) => ({ method, path }))
})

describe('every API route module loads in the production bundle', () => {
  it('found the routes', () => {
    expect(routes.length).toBeGreaterThan(50)
  })

  it.each(routes)('$method $path answers anonymously without a 500', async ({ method, path }) => {
    const res = await http(path, method === 'GET' ? {} : { method, json: {} })
    const body = await res.text()
    // 503 is an honest "not configured" (AI, billing); any other 5xx is a failure.
    const acceptable = res.status < 500 || res.status === 503
    expect(acceptable, `${res.status}: ${body.slice(0, 300)}`).toBe(true)
  })
})
