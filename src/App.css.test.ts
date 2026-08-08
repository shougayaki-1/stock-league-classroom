import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const stylesheet = readFileSync(join(process.cwd(), 'src/App.css'), 'utf8')

describe('Phase A stylesheet', () => {
  it('retains selectors used by the landing and public-document surfaces', () => {
    for (const selector of ['.landing-page', '.landing-nav', '.landing-closing', '.doc-page', '.doc-nav', '.doc-body', '.doc-callout', '.doc-footer', '.app-version']) {
      expect(stylesheet).toContain(selector)
    }
  })

  it('does not retain selectors for the removed lesson UI', () => {
    expect(stylesheet).not.toMatch(/\.(teacher-shell|template-page|student-market-page|signage-page|host-workspace)\b/)
  })
})
