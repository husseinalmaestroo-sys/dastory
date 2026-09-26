/**
 * Strict shape validation of every ailegal_hussein response (Phase 2,
 * "never trust any-like upstream responses"). A response that does not match
 * — wrong types, oversized strings, a citation marker pointing past the
 * source list, a "grounded" flag contradicting the mode — is rejected as a
 * whole (the route answers 502 and the call does not count against quota)
 * rather than partially shown as legal information.
 *
 * Hand-written guards rather than a schema library: Dastoori has no runtime
 * schema dependency, and these few shapes do not justify adding one.
 */

export class EngineShapeError extends Error {
  constructor(path: string, what: string) {
    super(`engine response: ${path} ${what}`)
  }
}

type Json = Record<string, unknown>

function obj(x: unknown, path: string): Json {
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw new EngineShapeError(path, 'is not an object')
  return x as Json
}
function str(x: unknown, path: string, max = 20_000): string {
  if (typeof x !== 'string' || x.length > max) throw new EngineShapeError(path, `is not a string ≤ ${max}`)
  return x
}
function optStr(x: unknown, path: string, max = 20_000): string | null {
  return x === null || x === undefined ? null : str(x, path, max)
}
function num(x: unknown, path: string): number {
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new EngineShapeError(path, 'is not a number')
  return x
}
function optNum(x: unknown, path: string): number | null {
  return x === null || x === undefined ? null : num(x, path)
}
function bool(x: unknown, path: string): boolean {
  if (typeof x !== 'boolean') throw new EngineShapeError(path, 'is not a boolean')
  return x
}
function arr<T>(x: unknown, path: string, item: (v: unknown, p: string) => T, max = 200): T[] {
  if (!Array.isArray(x) || x.length > max) throw new EngineShapeError(path, `is not an array ≤ ${max}`)
  return x.map((v, i) => item(v, `${path}[${i}]`))
}
function oneOf<T extends string>(x: unknown, path: string, values: readonly T[]): T {
  if (typeof x !== 'string' || !values.includes(x as T)) throw new EngineShapeError(path, `is not one of ${values.join('|')}`)
  return x as T
}
/** Numeric-or-string id (Postgres BIGINTs arrive as either). */
function id(x: unknown, path: string): string {
  if (typeof x === 'number' && Number.isFinite(x)) return String(x)
  return str(x, path, 40)
}
const articleNo = (x: unknown, path: string) => (typeof x === 'number' ? String(x) : optStr(x, path, 40))

export const GROUNDING_LEVELS = ['full', 'partial', 'none'] as const
export type GroundingLevel = (typeof GROUNDING_LEVELS)[number]

export const CHAT_MODES = [
  'grounded', 'partial', 'sources_only', 'no_evidence', 'law_not_in_corpus', 'article_not_in_corpus',
  'decision_not_in_corpus', 'clarification', 'out_of_jurisdiction', 'general', 'blocked',
] as const
export type ChatMode = (typeof CHAT_MODES)[number]

export interface EngineCitation {
  ref: number
  id: string
  sourceId: string | null
  title: string
  sourceType: string
  articleNumber: string | null
  lawName: string | null
  court: string | null
  decisionNumber: string | null
  year: number | null
  category: string | null
  excerpt: string
  isCurrentVersion: boolean | null
  effectiveDate: string | null
  provenance: string | null
  cited: boolean
}

export function citation(x: unknown, path: string): EngineCitation {
  const o = obj(x, path)
  return {
    ref: num(o.ref, `${path}.ref`),
    id: id(o.id, `${path}.id`),
    sourceId: o.sourceId === undefined || o.sourceId === null ? null : id(o.sourceId, `${path}.sourceId`),
    title: str(o.title, `${path}.title`, 500),
    sourceType: str(o.sourceType ?? 'law', `${path}.sourceType`, 40),
    articleNumber: articleNo(o.articleNumber, `${path}.articleNumber`),
    lawName: optStr(o.lawName, `${path}.lawName`, 500),
    court: optStr(o.court, `${path}.court`, 200),
    decisionNumber: optStr(o.decisionNumber, `${path}.decisionNumber`, 60),
    year: optNum(o.year, `${path}.year`),
    category: optStr(o.category, `${path}.category`, 100),
    excerpt: str(o.excerpt, `${path}.excerpt`, 1000),
    isCurrentVersion: o.isCurrentVersion === undefined || o.isCurrentVersion === null ? null : bool(o.isCurrentVersion, `${path}.isCurrentVersion`),
    effectiveDate: optStr(o.effectiveDate, `${path}.effectiveDate`, 40),
    provenance: optStr(o.provenance, `${path}.provenance`, 40),
    cited: o.cited === undefined ? false : bool(o.cited, `${path}.cited`),
  }
}

export interface EngineUsage {
  requestId: string
  llmCalls: number
  tokensIn: number
  tokensOut: number
  embeddingTokens: number
  estimatedCostUsd: number
}

export interface EngineProvenance {
  promptVersion: string
  corpusVersion: string
  chatModels: string[]
  embeddingModel: string | null
}

function usage(x: unknown): EngineUsage {
  const o = obj(x, 'usage')
  return {
    requestId: str(o.requestId, 'usage.requestId', 100),
    llmCalls: num(o.llmCalls, 'usage.llmCalls'),
    tokensIn: num(o.tokensIn, 'usage.tokensIn'),
    tokensOut: num(o.tokensOut, 'usage.tokensOut'),
    embeddingTokens: num(o.embeddingTokens, 'usage.embeddingTokens'),
    estimatedCostUsd: num(o.estimatedCostUsd, 'usage.estimatedCostUsd'),
  }
}

function provenance(x: unknown): EngineProvenance {
  const o = obj(x, 'provenance')
  return {
    promptVersion: str(o.promptVersion, 'provenance.promptVersion', 100),
    corpusVersion: str(o.corpusVersion, 'provenance.corpusVersion', 100),
    chatModels: arr(o.chatModels, 'provenance.chatModels', (v, p) => str(v, p, 100), 20),
    embeddingModel: optStr(o.embeddingModel, 'provenance.embeddingModel', 100),
  }
}

/** Every [n] in `text` must denote one of `sources`. */
function checkMarkers(text: string, sources: EngineCitation[], path: string) {
  for (const m of text.matchAll(/\[(\d{1,3})\]/g)) {
    const n = Number(m[1])
    if (n < 1 || n > sources.length) throw new EngineShapeError(path, `cites [${n}] with only ${sources.length} source(s)`)
  }
}

// ---------------------------------------------------------------- chat

export interface EngineChatResult {
  answer: string
  mode: ChatMode
  groundingLevel: GroundingLevel
  grounded: boolean
  sources: EngineCitation[]
  disclaimer: string | null
  notices: string[]
  confidence: { label: string; score: number } | null
  usage: EngineUsage
  provenance: EngineProvenance
}

export function parseChatResponse(x: unknown): EngineChatResult {
  const o = obj(x, 'response')
  const sources = arr(o.sources, 'sources', citation, 40)
  const answer = str(o.answer, 'answer', 20_000)
  const mode = oneOf(o.mode, 'mode', CHAT_MODES)
  const groundingLevel = oneOf(o.groundingLevel, 'groundingLevel', GROUNDING_LEVELS)
  const grounded = bool(o.grounded, 'grounded')
  if (grounded !== (mode === 'grounded' || mode === 'partial')) throw new EngineShapeError('grounded', `contradicts mode ${mode}`)
  if (grounded && groundingLevel === 'none') throw new EngineShapeError('groundingLevel', 'is none for a grounded answer')
  checkMarkers(answer, sources, 'answer')
  const conf = o.confidence && typeof o.confidence === 'object' ? (o.confidence as Json) : null
  return {
    answer,
    mode,
    groundingLevel,
    grounded,
    sources,
    disclaimer: optStr(o.disclaimer, 'disclaimer', 1000),
    notices: o.notices === undefined ? [] : arr(o.notices, 'notices', (v, p) => str(v, p, 1000), 10),
    confidence: conf ? { label: str(conf.label, 'confidence.label', 40), score: num(conf.score, 'confidence.score') } : null,
    usage: usage(o.usage),
    provenance: provenance(o.provenance),
  }
}

// ---------------------------------------------------------------- documents

export interface EngineCoverage {
  totalChars: number
  analyzedChars: number
  partial: boolean
  segments: number
  notAnalyzed: { fromChar: number; toChar: number; startsWith: string }[]
}

function coverage(x: unknown): EngineCoverage {
  const o = obj(x, 'coverage')
  return {
    totalChars: num(o.totalChars, 'coverage.totalChars'),
    analyzedChars: num(o.analyzedChars, 'coverage.analyzedChars'),
    partial: bool(o.partial, 'coverage.partial'),
    segments: num(o.segments, 'coverage.segments'),
    notAnalyzed: arr(o.notAnalyzed, 'coverage.notAnalyzed', (v, p) => {
      const r = obj(v, p)
      return { fromChar: num(r.fromChar, `${p}.fromChar`), toChar: num(r.toChar, `${p}.toChar`), startsWith: str(r.startsWith, `${p}.startsWith`, 300) }
    }, 20),
  }
}

export interface EngineContractReview {
  summary: string
  parties: string[]
  keyTerms: { label: string; value: string }[]
  risks: { severity: 'high' | 'medium' | 'low' | 'info'; title: string; excerpt: string; explanation: string }[]
  coverage: EngineCoverage
  sources: EngineCitation[]
  usage: EngineUsage
  provenance: EngineProvenance
}

export function parseContractReview(x: unknown): EngineContractReview {
  const o = obj(x, 'response')
  const sources = arr(o.sources, 'sources', citation, 40)
  const risks = arr(o.risks, 'risks', (v, p) => {
    const r = obj(v, p)
    const explanation = str(r.explanation, `${p}.explanation`, 3000)
    checkMarkers(explanation, sources, `${p}.explanation`)
    return {
      severity: oneOf(r.severity, `${p}.severity`, ['high', 'medium', 'low', 'info'] as const),
      title: str(r.title, `${p}.title`, 300),
      excerpt: str(r.excerpt ?? '', `${p}.excerpt`, 1500),
      explanation,
    }
  }, 150)
  return {
    summary: str(o.summary, 'summary', 4000),
    parties: arr(o.parties, 'parties', (v, p) => str(v, p, 200), 40),
    keyTerms: arr(o.keyTerms, 'keyTerms', (v, p) => {
      const k = obj(v, p)
      return { label: str(k.label, `${p}.label`, 200), value: str(k.value, `${p}.value`, 2000) }
    }, 150),
    risks,
    coverage: coverage(o.coverage),
    sources,
    usage: usage(o.usage),
    provenance: provenance(o.provenance),
  }
}

export interface EngineCaseAnalysis {
  analysis: {
    summary: string
    parties: { role: string; name: string }[]
    facts: string[]
    case_type: string
    cited_articles: string[]
    legal_basis: { point: string; citation?: string }[]
    possible_defenses: { defense: string; citation?: string }[]
    strengths: { point: string; citation?: string }[]
    weaknesses: { point: string; citation?: string }[]
    gaps: string[]
  }
  groundingLevel: GroundingLevel
  coverage: EngineCoverage
  sources: EngineCitation[]
  usage: EngineUsage
  provenance: EngineProvenance
}

export function parseCaseAnalysis(x: unknown): EngineCaseAnalysis {
  const o = obj(x, 'response')
  const sources = arr(o.sources, 'sources', citation, 40)
  const a = obj(o.analysis, 'analysis')
  const cited = <K extends 'point' | 'defense'>(key: K) => (v: unknown, p: string) => {
    const it = obj(v, p)
    const citationText = optStr(it.citation, `${p}.citation`, 60) ?? undefined
    if (citationText) checkMarkers(citationText, sources, `${p}.citation`)
    return { [key]: str(it[key], `${p}.${key}`, 1500), citation: citationText } as { [P in K]: string } & { citation?: string }
  }
  return {
    analysis: {
      summary: str(a.summary, 'analysis.summary', 4000),
      parties: arr(a.parties, 'analysis.parties', (v, p) => {
        const r = obj(v, p)
        return { role: str(r.role, `${p}.role`, 60), name: str(r.name, `${p}.name`, 200) }
      }, 40),
      facts: arr(a.facts, 'analysis.facts', (v, p) => str(v, p, 1500), 80),
      case_type: str(a.case_type ?? 'أخرى', 'analysis.case_type', 60),
      cited_articles: arr(a.cited_articles, 'analysis.cited_articles', (v, p) => str(v, p, 300), 80),
      legal_basis: arr(a.legal_basis, 'analysis.legal_basis', cited('point'), 40),
      possible_defenses: arr(a.possible_defenses, 'analysis.possible_defenses', cited('defense'), 40),
      strengths: arr(a.strengths, 'analysis.strengths', cited('point'), 40),
      weaknesses: arr(a.weaknesses, 'analysis.weaknesses', cited('point'), 40),
      gaps: arr(a.gaps, 'analysis.gaps', (v, p) => str(v, p, 600), 40),
    },
    groundingLevel: oneOf(o.groundingLevel, 'groundingLevel', GROUNDING_LEVELS),
    coverage: coverage(o.coverage),
    sources,
    usage: usage(o.usage),
    provenance: provenance(o.provenance),
  }
}

export interface EngineDraft {
  draft: string
  grounded: boolean
  groundingLevel: GroundingLevel
  mode: string
  unverifiedFacts: number
  sources: EngineCitation[]
  usage: EngineUsage
  provenance: EngineProvenance
}

export function parseDraft(x: unknown): EngineDraft {
  const o = obj(x, 'response')
  const sources = arr(o.sources, 'sources', citation, 40)
  const draft = str(o.draft, 'draft', 40_000)
  checkMarkers(draft, sources, 'draft')
  const validation = o.validation && typeof o.validation === 'object' ? (o.validation as Json) : null
  return {
    draft,
    grounded: bool(o.grounded, 'grounded'),
    groundingLevel: oneOf(o.groundingLevel, 'groundingLevel', GROUNDING_LEVELS),
    mode: str(o.mode ?? 'drafted', 'mode', 40),
    unverifiedFacts: validation && Array.isArray(validation.unverifiedFacts) ? validation.unverifiedFacts.length : 0,
    sources,
    usage: usage(o.usage),
    provenance: provenance(o.provenance),
  }
}
