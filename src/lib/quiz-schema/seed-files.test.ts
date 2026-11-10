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
})
