import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getFilePickers, JSON_FILE_TYPE } from './files'

beforeEach(() => {
  vi.stubGlobal('isSecureContext', true)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('native file pickers', () => {
  it('passes file filters and filenames to pickers bound to the window', async () => {
    const handle = { name: 'labels.json' }
    const open = vi.fn(function (this: Window) {
      expect(this).toBe(window)
      return Promise.resolve([handle])
    })
    const save = vi.fn(function (this: Window) {
      expect(this).toBe(window)
      return Promise.resolve(handle)
    })
    vi.stubGlobal('showOpenFilePicker', open)
    vi.stubGlobal('showSaveFilePicker', save)
    const pickers = getFilePickers()
    expect(pickers).toBeDefined()

    expect(await pickers?.open({ types: [JSON_FILE_TYPE], multiple: false })).toBe(handle)
    expect(await pickers?.save({
      types: [JSON_FILE_TYPE],
      suggestedName: 'labels.json',
    })).toBe(handle)
    expect(open).toHaveBeenCalledWith({ types: [JSON_FILE_TYPE], multiple: false })
    expect(save).toHaveBeenCalledWith({
      types: [JSON_FILE_TYPE],
      suggestedName: 'labels.json',
    })
  })

  it.each(['open', 'save'] as const)('treats cancellation of %s as a non-error', async (method) => {
    const cancelled = new DOMException('User cancelled', 'AbortError')
    vi.stubGlobal('showOpenFilePicker', vi.fn().mockRejectedValue(cancelled))
    vi.stubGlobal('showSaveFilePicker', vi.fn().mockRejectedValue(cancelled))

    expect(await getFilePickers()?.[method]({ types: [JSON_FILE_TYPE] })).toBeNull()
  })

  it.each(['open', 'save'] as const)('propagates %s permission failures', async (method) => {
    const denied = new DOMException('Permission denied', 'NotAllowedError')
    vi.stubGlobal('showOpenFilePicker', vi.fn().mockRejectedValue(denied))
    vi.stubGlobal('showSaveFilePicker', vi.fn().mockRejectedValue(denied))

    await expect(getFilePickers()?.[method]({ types: [JSON_FILE_TYPE] })).rejects.toBe(denied)
  })

  it('rejects a malformed empty picker result', async () => {
    vi.stubGlobal('showOpenFilePicker', vi.fn().mockResolvedValue([]))
    vi.stubGlobal('showSaveFilePicker', vi.fn())

    await expect(getFilePickers()?.open({ types: [JSON_FILE_TYPE] }))
      .rejects.toThrow('The file picker returned no file.')
  })

  it.each([
    [true, undefined, undefined],
    [true, vi.fn(), undefined],
    [true, undefined, vi.fn()],
    [false, vi.fn(), vi.fn()],
  ])('falls back when native file access is unavailable: %j', (secure, open, save) => {
    vi.stubGlobal('isSecureContext', secure)
    vi.stubGlobal('showOpenFilePicker', open)
    vi.stubGlobal('showSaveFilePicker', save)

    expect(getFilePickers()).toBeUndefined()
  })
})
