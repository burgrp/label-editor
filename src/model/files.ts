interface FilePickerOptions {
  types: { description: string; accept: Record<string, string[]> }[]
  suggestedName?: string
  multiple?: boolean
}

interface FilePickerWindow extends Window {
  showOpenFilePicker?: (options: FilePickerOptions) => Promise<FileSystemFileHandle[]>
  showSaveFilePicker?: (options: FilePickerOptions) => Promise<FileSystemFileHandle>
}

export const JSON_FILE_TYPE = {
  description: 'Label document',
  accept: { 'application/json': ['.json'] },
}

export const CSV_FILE_TYPE = {
  description: 'CSV data',
  accept: { 'text/csv': ['.csv'] },
}

export function getFilePickers() {
  const host: FilePickerWindow = window
  if (
    !host.isSecureContext ||
    typeof host.showOpenFilePicker !== 'function' ||
    typeof host.showSaveFilePicker !== 'function'
  ) {
    return undefined
  }

  const open = host.showOpenFilePicker.bind(host)
  const save = host.showSaveFilePicker.bind(host)
  return {
    async open(options: FilePickerOptions) {
      const handles = await chooseFile(open(options))
      if (handles === null) return null
      if (!handles[0]) throw new Error('The file picker returned no file.')
      return handles[0]
    },
    save: (options: FilePickerOptions) => chooseFile(save(options)),
  }
}

export async function writeTextFile(
  handle: FileSystemFileHandle,
  text: string,
): Promise<void> {
  const stream = await handle.createWritable()
  const writer = stream.getWriter()
  try {
    await writer.write(text)
    await writer.close()
  } catch (error) {
    try {
      await writer.abort(error)
    } catch (abortError) {
      console.error('Could not abort the failed file write.', abortError)
    }
    throw error
  } finally {
    writer.releaseLock()
  }
}

async function chooseFile<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null
    throw error
  }
}

export function downloadTextFile(text: string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  try {
    const anchor = window.document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
  } finally {
    URL.revokeObjectURL(url)
  }
}
