import { expect, test, type Page } from '@playwright/test'

test('explains when browser printing is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: undefined,
    })
  })
  await page.goto('/')

  await expect(page.getByText('Web Serial unavailable')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Connect printer' })).toBeDisabled()
  await expect(
    page.getByText(/Printing needs Chrome or Edge over HTTPS or localhost/),
  ).toBeVisible()
  await expect(page.getByLabel('Monochrome label preview')).toBeVisible()
})

test('connects, detects media, prints the selected label, and disconnects', async ({
  page,
}) => {
  await installSuccessfulSerialMock(page, 9)
  await page.goto('/')
  await page.evaluate(() => window.localStorage.clear())
  await page.reload()

  await page.getByRole('button', { name: 'Connect printer' }).click()
  await expect(page.getByText('PT-P300BT - 9 mm')).toBeVisible()
  await expect(page.getByLabel('Tape')).toHaveValue('9')
  await expect(page.getByRole('button', { name: 'Disconnect' })).toBeEnabled()

  await page.getByRole('button', { name: 'Print current' }).click()
  await expect(page.getByText(/Selected label sent successfully/)).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByRole('button', { name: 'Disconnect' })).toBeEnabled()

  const serialState = await page.evaluate(() => {
    const state = (
      window as typeof window & {
        __serialMock: {
          requestOptions: unknown
          openOptions: unknown
          writes: number[][]
          closeCount: number
        }
      }
    ).__serialMock
    return state
  })
  expect(serialState.requestOptions).toEqual({
    filters: [
      {
        bluetoothServiceClassId:
          '00001101-0000-1000-8000-00805f9b34fb',
      },
    ],
    allowedBluetoothServiceClassIds: [
      '00001101-0000-1000-8000-00805f9b34fb',
    ],
  })
  expect(serialState.openOptions).toEqual({ baudRate: 9600 })
  expect(serialState.writes.length).toBeGreaterThan(20)
  expect(serialState.writes.some((write) => write.includes(0x1a))).toBe(true)

  await page.getByRole('button', { name: 'Disconnect' }).click()
  await expect(page.getByText('Printer not connected')).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __serialMock: { closeCount: number }
            }
          ).__serialMock.closeCount,
      ),
    )
    .toBe(1)
})

test('surfaces serial permission failures without reporting a connection', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: {
        requestPort: async () => {
          throw new DOMException('Permission denied by user.', 'NotAllowedError')
        },
      },
    })
  })
  await page.goto('/')

  await page.getByRole('button', { name: 'Connect printer' }).click()

  await expect(page.getByText(/Printer permission:/)).toBeVisible()
  await expect(page.getByText('Printer not connected')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Connect printer' })).toBeEnabled()
})

test('prints one continuous job even when the preview wraps labels', async ({
  page,
}) => {
  await installSuccessfulSerialMock(page, 12)
  await page.goto('/')
  await page.evaluate(() => window.localStorage.clear())
  await page.reload()

  await page.getByRole('button', { name: 'Wrapped', exact: true }).click()
  await expect(page.locator('.preview-tapes canvas')).toHaveCount(3)
  await page.getByRole('button', { name: 'Connect printer' }).click()
  await page.getByRole('button', { name: 'Print strip' }).click()

  await expect(page.getByText(/Strip sent successfully/)).toBeVisible({
    timeout: 15_000,
  })
  const writes = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __serialMock: { writes: number[][] }
        }
      ).__serialMock.writes,
  )
  expect(
    writes.filter((write) => write.length === 1 && write[0] === 0x1a),
  ).toHaveLength(1)
})

async function installSuccessfulSerialMock(
  page: Page,
  mediaWidthMm: 3.5 | 6 | 9 | 12,
): Promise<void> {
  await page.addInitScript(
    ({ mediaWidth }) => {
      const statusFrame = (statusType: number) => {
        const frame = new Uint8Array(32)
        frame.set([0x80, 0x20, 0x42, 0x30])
        frame[4] = 0x72
        frame[7] = 4
        frame[10] = mediaWidth
        frame[11] = 1
        frame[18] = statusType
        return frame
      }

      const state = {
        requestOptions: null as unknown,
        openOptions: null as unknown,
        writes: [] as number[][],
        closeCount: 0,
      }
      let readableController: ReadableStreamDefaultController<Uint8Array>
      const readable = new ReadableStream<Uint8Array>({
        start(controller) {
          readableController = controller
          controller.enqueue(statusFrame(0))
          controller.enqueue(statusFrame(0))
          controller.enqueue(statusFrame(1))
        },
      })
      const writable = new WritableStream<Uint8Array>({
        write(chunk) {
          state.writes.push([...chunk])
        },
      })
      const port = {
        readable,
        writable,
        async open(options: unknown) {
          state.openOptions = options
        },
        async close() {
          state.closeCount += 1
          try {
            readableController.close()
          } catch {
            // The transport may already have cancelled the stream.
          }
        },
      }

      Object.defineProperty(window, '__serialMock', {
        configurable: true,
        value: state,
      })
      Object.defineProperty(navigator, 'serial', {
        configurable: true,
        value: {
          async requestPort(options: unknown) {
            state.requestOptions = options
            return port
          },
        },
      })
    },
    { mediaWidth: mediaWidthMm },
  )
}
