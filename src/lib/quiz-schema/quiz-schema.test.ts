import { stringify } from 'yaml'
import { parseQuizText } from './index'

const singleQuestion = {
  type: 'single',
  prompt: 'What does a red triangular sign mean?',
  options: [
    { text: 'Warning', correct: true },
    { text: 'Prohibition', correct: false },
  ],
}

const booleanQuestion = {
  type: 'boolean',
  prompt: 'You may park on a pedestrian crossing.',
  answer: false,
}

function makeQuiz(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    title: 'Italian Driving Licence - Road Signs',
    language: 'it',
    run: { questionsPerRun: 2, maxErrors: 1 },
    questions: [singleQuestion, booleanQuestion],
    ...overrides,
  }
}

function makeRun(overrides: Record<string, unknown> = {}) {
  return { questionsPerRun: 2, maxErrors: 1, ...overrides }
}

function parseObject(quiz: unknown) {
  return parseQuizText(stringify(quiz))
}

function errorsOf(quiz: unknown): string[] {
  const result = parseObject(quiz)
  if (result.ok) throw new Error('expected validation to fail')
  return result.errors
}

describe('parseQuizText', () => {
  it('parses a minimal valid YAML quiz', () => {
    const result = parseObject(makeQuiz())
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.questions).toHaveLength(2)
  })

  it('parses the same quiz as JSON', () => {
    const quiz = makeQuiz()
    expect(parseQuizText(JSON.stringify(quiz))).toEqual(parseObject(quiz))
  })

  it('normalizes a boolean question into two options', () => {
    const result = parseObject(makeQuiz())
    if (!result.ok) throw new Error('expected ok')
    expect(result.data.questions[1].options).toEqual([
      { text: 'True', correct: false },
      { text: 'False', correct: true },
    ])
  })

  it("keeps type 'boolean' after normalization", () => {
    const result = parseObject(makeQuiz())
    if (!result.ok) throw new Error('expected ok')
    expect(result.data.questions[1].type).toBe('boolean')
  })

  it('drops the `answer` key from the parsed output', () => {
    const result = parseObject(makeQuiz())
    if (!result.ok) throw new Error('expected ok')
    expect(result.data.questions[1]).not.toHaveProperty('answer')
  })

  it('rejects a single question with two correct options', () => {
    const question = {
      ...singleQuestion,
      options: [
        { text: 'A', correct: true },
        { text: 'B', correct: true },
      ],
    }
    expect(errorsOf(makeQuiz({ questions: [question, booleanQuestion] })).join('\n')).toMatch(
      /exactly one correct/,
    )
  })

  it('rejects a single question with one option', () => {
    const question = { ...singleQuestion, options: [{ text: 'A', correct: true }] }
    expect(errorsOf(makeQuiz({ questions: [question, booleanQuestion] })).join('\n')).toMatch(
      /at least 2|between 2/,
    )
  })

  it('rejects a multi question with no correct option', () => {
    const question = {
      ...singleQuestion,
      type: 'multi',
      options: [
        { text: 'A', correct: false },
        { text: 'B', correct: false },
      ],
    }
    expect(errorsOf(makeQuiz({ questions: [question, booleanQuestion] })).join('\n')).toMatch(
      /at least one correct/,
    )
  })

  it('rejects a boolean question that also declares options', () => {
    const question = { ...booleanQuestion, options: singleQuestion.options }
    expect(errorsOf(makeQuiz({ questions: [singleQuestion, question] })).join('\n')).toMatch(
      /options/,
    )
  })

  it('rejects questionsPerRun greater than the question count', () => {
    expect(errorsOf(makeQuiz({ run: makeRun({ questionsPerRun: 3 }) })).join('\n')).toMatch(
      /questionsPerRun/,
    )
  })

  it('rejects questionsPerRun of 0', () => {
    const errors = errorsOf(makeQuiz({ run: makeRun({ questionsPerRun: 0, maxErrors: 0 }) }))
    expect(errors.join('\n')).toMatch(/questionsPerRun/)
  })

  it('rejects maxErrors greater than questionsPerRun', () => {
    expect(errorsOf(makeQuiz({ run: makeRun({ maxErrors: 3 }) })).join('\n')).toMatch(/maxErrors/)
  })

  it('accepts maxErrors equal to questionsPerRun', () => {
    expect(parseObject(makeQuiz({ run: makeRun({ maxErrors: 2 }) })).ok).toBe(true)
  })

  it('rejects timePerQuestionSec of 1', () => {
    const errors = errorsOf(makeQuiz({ run: makeRun({ timePerQuestionSec: 1 }) }))
    expect(errors.join('\n')).toMatch(/timePerQuestionSec/)
  })

  it('rejects timePerQuestionSec of 601', () => {
    const errors = errorsOf(makeQuiz({ run: makeRun({ timePerQuestionSec: 601 }) }))
    expect(errors.join('\n')).toMatch(/timePerQuestionSec/)
  })

  it('accepts timePerQuestionSec of 5 and of 600', () => {
    expect(parseObject(makeQuiz({ run: makeRun({ timePerQuestionSec: 5 }) })).ok).toBe(true)
    expect(parseObject(makeQuiz({ run: makeRun({ timePerQuestionSec: 600 }) })).ok).toBe(true)
  })

  it('accepts an omitted timePerQuestionSec', () => {
    const result = parseObject(makeQuiz())
    if (!result.ok) throw new Error('expected ok')
    expect(result.data.run.timePerQuestionSec).toBeUndefined()
  })

  it('rejects a javascript: imageUrl', () => {
    const question = { ...singleQuestion, imageUrl: 'javascript:alert(1)' }
    expect(errorsOf(makeQuiz({ questions: [question, booleanQuestion] })).join('\n')).toMatch(
      /imageUrl/,
    )
  })

  it('rejects a javascript: theoryUrl', () => {
    const question = { ...singleQuestion, theoryUrl: 'javascript:alert(1)' }
    expect(errorsOf(makeQuiz({ questions: [question, booleanQuestion] })).join('\n')).toMatch(
      /theoryUrl/,
    )
  })

  it('accepts an http: and an https: imageUrl', () => {
    const http = { ...singleQuestion, imageUrl: 'http://example.com/a.png' }
    const https = { ...singleQuestion, imageUrl: 'https://example.com/a.png' }
    expect(parseObject(makeQuiz({ questions: [http, https] })).ok).toBe(true)
  })

  it('rejects version 2', () => {
    expect(errorsOf(makeQuiz({ version: 2 })).join('\n')).toMatch(/version/)
  })

  it('defaults tags to an empty array when omitted', () => {
    const result = parseObject(makeQuiz())
    if (!result.ok) throw new Error('expected ok')
    expect(result.data.tags).toEqual([])
  })

  it('reports every validation error, not just the first', () => {
    const badSingle = { ...singleQuestion, options: [{ text: 'A', correct: true }] }
    const badMulti = {
      ...singleQuestion,
      type: 'multi',
      options: [
        { text: 'A', correct: false },
        { text: 'B', correct: false },
      ],
    }
    expect(errorsOf(makeQuiz({ questions: [badSingle, badMulti] })).length).toBeGreaterThanOrEqual(
      2,
    )
  })

  it('returns an error instead of throwing for malformed YAML', () => {
    const result = parseQuizText('title: [unclosed\n  - nope: : :')
    expect(result.ok).toBe(false)
  })

  it('returns an error instead of throwing for malformed JSON', () => {
    const result = parseQuizText('{ "version": 1, ')
    expect(result.ok).toBe(false)
  })
})
