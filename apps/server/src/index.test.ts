import { describe, expect, it } from 'vitest'
import { SERVER_VERSION } from './index'

describe('server placeholder', () => {
  it('exposes version', () => {
    expect(SERVER_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
