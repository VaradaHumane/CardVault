import { useCallback, useRef, useState } from 'react'
import { runOcr } from '../lib/ocr'
import type { OcrOutput, OcrProgress } from '../lib/ocr'

export type OcrStatus = 'idle' | 'running' | 'done' | 'error'

export interface UseOcrResult {
  status: OcrStatus
  progress: OcrProgress | null
  output: OcrOutput | null
  error: string | null
  start: (image: HTMLCanvasElement) => Promise<OcrOutput | null>
  reset: () => void
}

const IDLE_PROGRESS: OcrProgress = {
  stage: 'preparing',
  progress: 0,
  label: 'Preparing the image',
}

/**
 * Owns one OCR run at a time.
 *
 * Tesseract.js has no cancellation, so `start` simply ignores the result of a
 * run that has been superseded. This keeps the hook honest without pretending
 * the worker can be interrupted.
 */
export function useOcr(): UseOcrResult {
  const [status, setStatus] = useState<OcrStatus>('idle')
  const [progress, setProgress] = useState<OcrProgress | null>(null)
  const [output, setOutput] = useState<OcrOutput | null>(null)
  const [error, setError] = useState<string | null>(null)
  const runIdRef = useRef(0)

  const start = useCallback(
    async (image: HTMLCanvasElement): Promise<OcrOutput | null> => {
      runIdRef.current += 1
      const runId = runIdRef.current

      setStatus('running')
      setProgress(IDLE_PROGRESS)
      setOutput(null)
      setError(null)

      try {
        const result = await runOcr(image, (next) => {
          if (runIdRef.current !== runId) return
          setProgress(next)
        })

        if (runIdRef.current !== runId) return null

        setStatus('done')
        setProgress(null)
        setOutput(result)

        return result
      } catch (caught) {
        if (runIdRef.current !== runId) return null

        setStatus('error')
        setProgress(null)
        setError(
          caught instanceof Error
            ? caught.message
            : 'The card could not be read. Please try another photo.',
        )

        return null
      }
    },
    [],
  )

  const reset = useCallback(() => {
    runIdRef.current += 1
    setStatus('idle')
    setProgress(null)
    setOutput(null)
    setError(null)
  }, [])

  return { status, progress, output, error, start, reset }
}
