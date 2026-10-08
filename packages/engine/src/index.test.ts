import { describe, expect, it } from 'vitest'
import { SHARED_VERSION } from '@arlaf/shared'
import { ENGINE_VERSION } from './index'

describe('engine placeholder', () => {
  it('exposes version and compatible shared version', () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
    expect(SHARED_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
