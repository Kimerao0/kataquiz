import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseQuizText } from './index'

// The seed quizzes are the first thing a visitor plays and the only worked
// examples of the file format. They are also hand-edited, so without this they
// would drift out of validity silently and be discovered by an operator
// running the import for real.
const SEEDS_DIR = 'seeds'

describe('seed quizzes', () => {
  const files = readdirSync(SEEDS_DIR).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))

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
