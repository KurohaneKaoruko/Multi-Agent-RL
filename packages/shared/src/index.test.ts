import { describe, expect, it } from 'vitest'
import { SHARED_VERSION } from './index'

describe('shared placeholder', () => {
  it('exposes version', () => {
    expect(SHARED_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
