import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import type { ParsedQuestion, QuizFile } from './types'

export type { ParsedOption, ParsedQuestion, QuestionType, QuizFile } from './types'

const httpUrl = z.url({
  protocol: /^https?$/,
  error: 'must be a valid http: or https: URL',
})

const optionSchema = z.object({
  text: z.string().min(1).max(500),
  correct: z.boolean(),
})

const optionsBetween = z
  .array(optionSchema)
  .min(2, { error: 'must have between 2 and 10 options' })
  .max(10, { error: 'must have between 2 and 10 options' })

const countCorrect = (options: { correct: boolean }[]) => options.filter((o) => o.correct).length

const baseQuestionShape = {
  prompt: z.string().min(1).max(2000),
  imageUrl: httpUrl.optional(),
  explanation: z.string().optional(),
  theoryUrl: httpUrl.optional(),
}

const singleQuestionSchema = z.object({
  type: z.literal('single'),
  ...baseQuestionShape,
  options: optionsBetween.refine((options) => countCorrect(options) === 1, {
    error: 'a single question must have exactly one correct option',
  }),
})

const multiQuestionSchema = z.object({
  type: z.literal('multi'),
  ...baseQuestionShape,
  options: optionsBetween.refine((options) => countCorrect(options) >= 1, {
    error: 'a multi question must have at least one correct option',
  }),
})

const booleanQuestionSchema = z.object({
  type: z.literal('boolean'),
  ...baseQuestionShape,
  answer: z.boolean(),
  options: z
    .undefined({ error: 'options is not allowed on a boolean question, use answer' })
    .optional(),
})

const questionSchema = z
  .discriminatedUnion('type', [singleQuestionSchema, multiQuestionSchema, booleanQuestionSchema])
  .transform((question): ParsedQuestion => {
    if (question.type !== 'boolean') return question
    const { answer, ...rest } = question
    return {
      ...rest,
      options: [
        { text: 'True', correct: answer },
        { text: 'False', correct: !answer },
      ],
    }
  })

export const quizFileSchema = z
  .object({
    version: z.literal(1),
    title: z.string().min(1).max(200),
    description: z.string().optional(),
    language: z.string().min(1).max(10),
    tags: z.array(z.string().max(30)).max(10).default([]),
    run: z.object({
      questionsPerRun: z.number().int().min(1),
      maxErrors: z.number().int().min(0),
      timePerQuestionSec: z.number().int().min(5).max(600).optional(),
    }),
    questions: z.array(questionSchema).min(1).max(1000),
  })
  .refine((quiz) => quiz.run.questionsPerRun <= quiz.questions.length, {
    path: ['run', 'questionsPerRun'],
    error: 'must not exceed the number of questions',
  })
  .refine((quiz) => quiz.run.maxErrors <= quiz.run.questionsPerRun, {
    path: ['run', 'maxErrors'],
    error: 'must not exceed questionsPerRun',
  })

export function parseQuizText(
  text: string,
): { ok: true; data: QuizFile } | { ok: false; errors: string[] } {
  const trimmed = text.trim()
  let raw: unknown
  try {
    raw = trimmed.startsWith('{') ? JSON.parse(trimmed) : parseYaml(trimmed)
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)] }
  }

  const result = quizFileSchema.safeParse(raw)
  if (!result.success) {
    const errors = result.error.issues.map((issue) => {
      const path = issue.path.map(String).join('.') || '(root)'
      return `${path}: ${issue.message}`
    })
    return { ok: false, errors }
  }
  return { ok: true, data: result.data }
}
