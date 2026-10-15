import { afterEach, describe, expect, it, vi } from 'vitest'
import { googleFontUrl, parseFontFamilies } from './googleFonts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('font discovery helpers', () => {
  it('parses quoted names, embedded commas, and generic fallback stacks', () => {
    expect(parseFontFamilies('"Roboto Condensed", \'Family, With Comma\', sans-serif')).toEqual(
      ['Roboto Condensed', 'Family, With Comma', 'sans-serif'],
    )
    expect(parseFontFamilies(String.raw`"Ro\62 oto", sans-serif`)).toEqual(
      ['Roboto', 'sans-serif'],
    )
  })

  it('only sends family, weight, and style, never label text', () => {
    const url = new URL(googleFontUrl({
      family: 'Roboto Condensed',
      weight: '700',
      style: 'italic',
    }))
    expect(url.origin).toBe('https://fonts.googleapis.com')
    expect(url.searchParams.get('family')).toBe('Roboto Condensed:ital,wght@1,700')
    expect([...url.searchParams.keys()]).toEqual(['family', 'display'])
    expect(url.searchParams.has('text')).toBe(false)
  })

  it('normalizes keyword weights and validates numeric weights', () => {
    expect(googleFontUrl({ family: 'Roboto', weight: 'bold', style: 'normal' })).toContain('0%2C700')
    expect(() => googleFontUrl({
      family: 'Roboto', weight: 'NaN', style: 'normal',
    })).toThrow(/font weight/)
  })
})

describe('font loading', () => {
  const request = { family: 'Label Test Font', weight: '400', style: 'normal' } as const

  async function loader() {
    vi.resetModules()
    vi.stubGlobal('caches', undefined)
    return (await import('./googleFonts')).loadGoogleFont
  }

  it('surfaces HTTP errors and permits retries', async () => {
    const load = await loader()
    const fetchMock = vi.fn().mockResolvedValue(new Response('unknown font', { status: 400 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(load(request)).rejects.toThrow(/Label Test Font.*HTTP 400/)
    await expect(load(request)).rejects.toThrow(/HTTP 400/)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).not.toContain('text=')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      credentials: 'omit', referrerPolicy: 'no-referrer',
    })
  })

  it('blocks font file hosts outside Google', async () => {
    const load = await loader()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      '@font-face{font-family:"Label Test Font";src:url("https://example.com/font.woff2")}',
    )))
    await expect(load(request)).rejects.toThrow(/Blocked unexpected font resource/)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('rejects unrelated families and empty provider stylesheets', async () => {
    const load = await loader()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('@font-face{font-family:"Other";src:url("https://fonts.gstatic.com/font.woff2")}'))
      .mockResolvedValueOnce(new Response('/* no font */'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(load(request)).rejects.toThrow(/different family/)
    await expect(load(request)).rejects.toThrow(/no font faces/)
  })

  it('reads embedded CSS from persistent storage without network requests', async () => {
    const load = await loader()
    const css = '@font-face{font-family:"Label Test Font";src:url(data:font/woff2;base64,AAAA)}'
    vi.stubGlobal('caches', {
      open: vi.fn().mockResolvedValue({
        match: vi.fn().mockResolvedValue(new Response(css)),
      }),
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    expect(await load(request)).toEqual({ css })
    expect(await load(request)).toEqual({ css })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(caches.open).toHaveBeenCalledTimes(1)
  })

  it('cancels a stale render without cancelling another consumer of the same download', async () => {
    const load = await loader()
    let finish: (response: Response) => void = () => {
      throw new Error('Fetch has not started.')
    }
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
      finish = resolve
    })))
    const controller = new AbortController()
    const old = load(request, controller.signal)
    const current = load(request)
    controller.abort()
    await expect(old).rejects.toMatchObject({ name: 'AbortError' })
    finish(new Response('', { status: 404 }))
    await expect(current).rejects.toThrow(/HTTP 404/)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
