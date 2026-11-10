import { z } from 'zod'
import { formatIssues, readDocument } from '../quiz-schema'

export const MAX_PATH_STEPS = 100

export type PathStepRef = { quiz: string } | { title: string }

export type PathFile = {
  version: 1
  kind: 'path'
  title: string
  description?: string
  language: string
  steps: PathStepRef[]
}

const stepSchema = z.union(
  [
    z.strictObject({ quiz: z.string().min(1).max(200) }),
    z.strictObject({ title: z.string().min(1).max(200) }),
  ],
  { error: 'a step needs exactly one of quiz or title' },
)

function stepKey(step: PathStepRef): string {
  return 'quiz' in step ? `quiz:${step.quiz}` : `title:${step.title}`
}

const pathFileSchema = z.object({
  version: z.literal(1),
  kind: z.literal('path'),
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  language: z.string().min(1).max(10),
  steps: z
    .array(stepSchema)
    .min(1)
    .max(MAX_PATH_STEPS)
    .superRefine((steps, ctx) => {
      const firstSeen = new Map<string, number>()
      steps.forEach((step, index) => {
        const key = stepKey(step)
        const first = firstSeen.get(key)
        if (first === undefined) {
          firstSeen.set(key, index)
          return
        }
        ctx.addIssue({
          code: 'custom',
          message: `step ${index + 1} repeats step ${first + 1}`,
        })
      })
    }),
})

export function parsePathText(
  text: string,
): { ok: true; data: PathFile } | { ok: false; errors: string[] } {
  const document = readDocument(text)
  if (!document.ok) return { ok: false, errors: [document.error] }

  const result = pathFileSchema.safeParse(document.raw)
  if (!result.success) return { ok: false, errors: formatIssues(result.error.issues) }
  return { ok: true, data: result.data }
}

export function isPathText(text: string): boolean {
  const document = readDocument(text)
  if (!document.ok) return false
  const raw = document.raw
  return typeof raw === 'object' && raw !== null && (raw as { kind?: unknown }).kind === 'path'
}
