import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { brand } from '@/config/brand'

describe('Pika adapter identity documentation', () => {
  it('documents only opaque principals at the cross-application boundary', () => {
    const contract = readFileSync(resolve(
      process.cwd(),
      `docs/system/pika-${brand.name.toLowerCase()}-contract-v1.md`,
    ), 'utf8')
    const roadmap = readFileSync(resolve(
      process.cwd(),
      `docs/system/pika-${brand.name.toLowerCase()}-attendance-roadmap.md`,
    ), 'utf8')

    expect(contract).toContain('actor_principal_ref')
    expect(contract).toContain(`${brand.name} never receives the Pika WorkOS subject`)
    expect(contract).not.toContain('verified WorkOS actor subject')
    expect(contract).not.toContain('Staff commands carry the verified actor subject')
    expect(roadmap).toContain('the WorkOS subject never crosses the adapter')
    expect(roadmap).not.toContain(`WorkOS-subject-to-${brand.name}-owner resolution`)
  })
})
