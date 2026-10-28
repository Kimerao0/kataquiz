export type QuestionType = 'single' | 'multi' | 'boolean'

export type ParsedOption = { text: string; correct: boolean }

export type ParsedQuestion = {
  type: QuestionType
  prompt: string
  imageUrl?: string
  explanation?: string
  theoryUrl?: string
  // A snippet shown as its own block, rather than crammed into the prompt.
  code?: string
  codeLanguage?: string
  // Always present after parsing, including for boolean questions
  options: ParsedOption[]
}

export type QuizFile = {
  version: 1
  title: string
  description?: string
  language: string
  tags: string[]
  run: { questionsPerRun: number; maxErrors: number; timePerQuestionSec?: number }
  questions: ParsedQuestion[]
}
