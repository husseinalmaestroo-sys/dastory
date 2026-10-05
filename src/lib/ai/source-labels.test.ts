// Corpus repair (2026-10): what the interface may say about a legal source.
// Each label states a recorded fact and no more — "from an official source"
// is not "compared with the Official Gazette", and nothing says "موثّق".
import { describe, expect, it } from 'vitest'
import { AUTHORITY_LABEL_AR, MODE_LABEL_AR, SOURCE_CLASS_LABEL_AR, citedSourcesLabel } from './source-labels'
import { AUTHORITY_LEVELS, CHAT_MODES, SOURCE_CLASSES } from './engine-schema'

describe('source labels', () => {
  it('only a Gazette-verified text is said to be compared with the Gazette; no label claims "verified"', () => {
    for (const level of AUTHORITY_LEVELS) {
      const label = AUTHORITY_LABEL_AR[level]
      expect(label).toBeTruthy()
      expect(label).not.toMatch(/موثّق|موثق|متحقَّق منه|متحقق منه/)
      if (level === 'gazette_verified') expect(label).toMatch(/قورن/)
      else if (level !== 'synthetic') expect(label).toMatch(/لم يُقارن بالجريدة الرسمية/)
    }
    expect(AUTHORITY_LABEL_AR.official_not_verified).toMatch(/رسمية/)
    expect(AUTHORITY_LABEL_AR.secondary_not_verified).toMatch(/ثانوي/)
  })

  it('every engine mode and class has an Arabic label — none is shown raw, none claims a verified source', () => {
    for (const mode of CHAT_MODES) expect(MODE_LABEL_AR[mode]?.label, mode).toBeTruthy()
    for (const c of SOURCE_CLASSES) expect(SOURCE_CLASS_LABEL_AR[c], c).toBeTruthy()
    for (const { label } of Object.values(MODE_LABEL_AR)) expect(label).not.toMatch(/موثّق|موثق/)
    expect(MODE_LABEL_AR.law_unavailable.label).toMatch(/محجوب/)
  })

  it('summarises the cited sources by what may be said of them; an unlabelled citation is not compared', () => {
    expect(citedSourcesLabel([])).toBe('لا يستشهد بمصدر')
    expect(citedSourcesLabel([{ cited: false, authorityLevel: 'gazette_verified' }])).toBe('لا يستشهد بمصدر')
    const label = citedSourcesLabel([
      { cited: true, authorityLevel: 'official_not_verified' },
      { cited: true, authorityLevel: 'secondary_not_verified' },
      { cited: true, authorityLevel: 'official_not_verified' },
      { cited: true },
    ])
    expect(label).toBe(
      '4 مصدر: 2 من جهة نشر رسمية — لم يُقارن بالجريدة الرسمية؛ 1 من مصدر ثانوي — لم يُقارن بالجريدة الرسمية؛ 1 مصدره غير مسجّل — لم يُقارن بالجريدة الرسمية'
    )
  })
})
