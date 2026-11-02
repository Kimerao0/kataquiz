// Usage (from the repo root): npx tsx .claude/skills/kata-quiz/scripts/check.mts seeds/<prefix>-*.yaml
// Validates each file with the app's own parser and measures the answer-length tell.
import { readFileSync } from 'node:fs'
import { parseQuizText } from '../../../../src/lib/quiz-schema/index.ts'

const MAX_TELL = 30 // % of single questions where the correct option is the uniquely longest/shortest
let failed = 0

for (const file of process.argv.slice(2)) {
  const text = readFileSync(file, 'utf8')
  const parsed = parseQuizText(text)
  if (!parsed.ok) {
    failed++
    console.log(`FAIL ${file}\n  ${parsed.errors.join('\n  ')}`)
    continue
  }
  const questions = parsed.data.questions
  const problems: string[] = []
  const noUrl = questions.filter((q) => !q.theoryUrl).length
  const noExplanation = questions.filter((q) => !q.explanation).length
  if (noUrl) problems.push(`${noUrl} without theoryUrl`)
  if (noExplanation) problems.push(`${noExplanation} without explanation`)

  const singles = questions.filter((q) => q.type === 'single')
  let longest = 0
  let shortest = 0
  for (const q of singles) {
    const lengths = q.options.map((o) => o.text.length)
    const correct = lengths[q.options.findIndex((o) => o.correct)]
    const unique = lengths.filter((l) => l === correct).length === 1
    if (unique && correct === Math.max(...lengths)) longest++
    if (unique && correct === Math.min(...lengths)) shortest++
  }
  const pct = (n: number) => (singles.length ? Math.round((100 * n) / singles.length) : 0)
  if (pct(longest) > MAX_TELL) problems.push(`correct is longest in ${pct(longest)}% of singles`)
  if (pct(shortest) > MAX_TELL) problems.push(`correct is shortest in ${pct(shortest)}% of singles`)

  const code = questions.filter((q) => q.code).length
  const summary = `${questions.length} q, ${code} code, longest ${pct(longest)}%, shortest ${pct(shortest)}%`
  if (problems.length) failed++
  console.log(
    `${problems.length ? 'FAIL' : 'ok  '} ${file}: ${summary}${problems.length ? `\n  ${problems.join('\n  ')}` : ''}`,
  )
}
process.exitCode = failed ? 1 : 0
