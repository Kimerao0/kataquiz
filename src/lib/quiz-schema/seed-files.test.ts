import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isPathText, parsePathText } from '../paths/file'
import { parseQuizText } from './index'

// The seed quizzes are the first thing a visitor plays and the only worked
// examples of the file format. They are also hand-edited, so without this they
// would drift out of validity silently and be discovered by an operator
// running the import for real.
const SEEDS_DIR = 'seeds'

const allFiles = readdirSync(SEEDS_DIR).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
const texts = new Map(allFiles.map((f) => [f, readFileSync(join(SEEDS_DIR, f), 'utf8')]))
const files = allFiles.filter((f) => !isPathText(texts.get(f) ?? ''))
const pathFiles = allFiles.filter((f) => isPathText(texts.get(f) ?? ''))

describe('seed quizzes', () => {
  it('there is at least one seed to import', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files)('%s parses against the current schema', (file) => {
    const result = parseQuizText(readFileSync(join(SEEDS_DIR, file), 'utf8'))
    if (!result.ok) throw new Error(`${file} is invalid:\n  ${result.errors.join('\n  ')}`)
    expect(result.data.questions.length).toBeGreaterThan(0)
  })

  it.each(files)('%s has enough questions for a full run', (file) => {
    const result = parseQuizText(readFileSync(join(SEEDS_DIR, file), 'utf8'))
    if (!result.ok) throw new Error(`${file} is invalid`)
    // A bank the same size as the run means every run is identical, which
    // defeats the point of sampling.
    expect(result.data.questions.length).toBeGreaterThan(result.data.run.questionsPerRun)
  })
})

function quizTitle(file: string): string | undefined {
  const parsed = parseQuizText(texts.get(file) ?? '')
  return parsed.ok ? parsed.data.title : undefined
}

function quizTitlesOf(match: (file: string) => boolean): string[] {
  return files
    .filter(match)
    .sort()
    .flatMap((f) => quizTitle(f) ?? [])
}

function pathTitles(file: string): string[] {
  const result = parsePathText(texts.get(file) ?? '')
  if (!result.ok) throw new Error(`${file} is invalid`)
  return result.data.steps.flatMap((step) => ('title' in step ? [step.title] : []))
}

describe('seed paths', () => {
  it('there is at least one seed path', () => {
    expect(pathFiles.length).toBeGreaterThan(0)
  })

  it.each(pathFiles)('%s parses as a path file', (file) => {
    const result = parsePathText(texts.get(file) ?? '')
    if (!result.ok) throw new Error(`${file} is invalid:\n  ${result.errors.join('\n  ')}`)
  })

  // A typo here would otherwise only surface when the seed runs against prod.
  it.each(pathFiles)('%s names only titles of quizzes in seeds/', (file) => {
    const quizTitles = new Set(
      files.flatMap((f) => {
        const parsed = parseQuizText(texts.get(f) ?? '')
        return parsed.ok ? [parsed.data.title] : []
      }),
    )
    const result = parsePathText(texts.get(file) ?? '')
    if (!result.ok) throw new Error(`${file} is invalid`)
    const unknown = result.data.steps.flatMap((step) =>
      'title' in step && !quizTitles.has(step.title) ? [step.title] : [],
    )
    expect(unknown).toEqual([])
  })

  // importPath resolves seed steps by title only, so any other step throws at seed time.
  it.each(pathFiles)('%s has only title steps', (file) => {
    const result = parsePathText(texts.get(file) ?? '')
    if (!result.ok) throw new Error(`${file} is invalid`)
    const offending = result.data.steps.flatMap((step, i) => ('title' in step ? [] : [i + 1]))
    if (offending.length > 0) {
      throw new Error(`${file} has non-title steps at step number(s) ${offending.join(', ')}`)
    }
  })

  it('the architect path lists every architect-*.yaml quiz in file-number order', () => {
    const expected = quizTitlesOf((f) => /^architect-\d+/.test(f))
    expect(expected.length).toBeGreaterThan(0)
    expect(pathTitles('path-road-to-software-architect.yaml')).toEqual(expected)
  })

  it('the AWS path lists the numbered topic quizzes in order, then the mock exam', () => {
    const numbered = files
      .map((f) => ({ f, title: quizTitle(f) ?? '' }))
      .flatMap(({ title }) => {
        const match = /^AWS Cloud Practitioner (\d+):/.exec(title)
        return match ? [{ n: Number(match[1]), title }] : []
      })
      .sort((a, b) => a.n - b.n)
      .map((q) => q.title)
    expect(numbered.length).toBeGreaterThan(0)
    expect(pathTitles('path-aws-cloud-practitioner.yaml')).toEqual([
      ...numbered,
      'AWS Cloud Practitioner: Mock exam (CLF-C02)',
    ])
  })
})
