import { pool } from '@/db/client'
import { ALREADY_IMPORTED, seedQuizzes } from '@/lib/quizzes/seed'

const outcomes = await seedQuizzes({})

for (const outcome of outcomes) {
  if (outcome.status === 'imported') {
    const route = outcome.kind === 'path' ? 'p' : 'q'
    console.log(`imported ${outcome.file} as /${route}/${outcome.slug}`)
  } else console.log(`skipped ${outcome.file}: ${outcome.reason}`)
}

const imported = outcomes.filter((outcome) => outcome.status === 'imported').length
const broken = outcomes.filter(
  (outcome) => outcome.status === 'skipped' && outcome.reason !== ALREADY_IMPORTED,
)
console.log(
  `${outcomes.length} file(s): ${imported} imported, ${outcomes.length - imported} skipped`,
)

await pool.end()

// A seed file that no longer validates is a broken build, not a warning. A file
// skipped because it is already in the catalog is the idempotent path, and fine.
if (broken.length > 0) process.exitCode = 1
