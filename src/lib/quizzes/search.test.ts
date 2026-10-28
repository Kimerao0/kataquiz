import { eq } from 'drizzle-orm'
import { questions, quizzes, user } from '@/db/schema'
import { type TestTx, withTestDb } from '@/test/db'
import { getQuizBySlug, listPopularTags, PAGE_SIZE, searchQuizzes } from './search'

// A nonsense word the text search parser keeps as one token, unique per call so
// two tests can never match each other's rows.
function uniqueWord() {
  return `w${crypto.randomUUID().replaceAll('-', '')}`
}

async function insertUser(tx: TestTx, name = 'Author') {
  const id = `user-${crypto.randomUUID()}`
  await tx.insert(user).values({ id, name, email: `${id}@example.com` })
  return id
}

type QuizSeed = {
  title?: string
  description?: string
  tags?: string[]
  isHidden?: boolean
  authorId?: string
  createdAt?: Date
  questionCount?: number
}

async function seedQuiz(tx: TestTx, seed: QuizSeed = {}) {
  const [quiz] = await tx
    .insert(quizzes)
    .values({
      slug: `quiz-${crypto.randomUUID()}`,
      authorId: seed.authorId ?? (await insertUser(tx)),
      title: seed.title ?? `Quiz ${uniqueWord()}`,
      description: seed.description,
      language: 'it',
      tags: seed.tags ?? [],
      isHidden: seed.isHidden,
      createdAt: seed.createdAt,
      questionsPerRun: 2,
      maxErrors: 1,
      timePerQuestionSec: 30,
    })
    .returning({ id: quizzes.id, slug: quizzes.slug })

  if (seed.questionCount) {
    await tx.insert(questions).values(
      Array.from({ length: seed.questionCount }, (_, position) => ({
        quizId: quiz.id,
        position,
        type: 'single' as const,
        prompt: 'A question',
      })),
    )
  }

  return quiz
}

describe('searchQuizzes', () => {
  it('finds a quiz by a word in its title', async () => {
    await withTestDb(async (tx) => {
      const word = uniqueWord()
      const quiz = await seedQuiz(tx, { title: `Road signs ${word}` })

      const { items, total } = await searchQuizzes({ q: word, executor: tx })

      expect(items.map((item) => item.slug)).toEqual([quiz.slug])
      expect(total).toBe(1)
    })
  })

  it('finds a quiz by a word in its description', async () => {
    await withTestDb(async (tx) => {
      const word = uniqueWord()
      const quiz = await seedQuiz(tx, { description: `Covers ${word} in depth` })

      const { items } = await searchQuizzes({ q: word, executor: tx })

      expect(items.map((item) => item.slug)).toEqual([quiz.slug])
    })
  })

  it('is case-insensitive', async () => {
    await withTestDb(async (tx) => {
      const word = uniqueWord()
      const quiz = await seedQuiz(tx, { title: `Road signs ${word}` })

      const { items } = await searchQuizzes({ q: word.toUpperCase(), executor: tx })

      expect(items.map((item) => item.slug)).toEqual([quiz.slug])
    })
  })

  it('returns nothing for a word that appears in neither', async () => {
    await withTestDb(async (tx) => {
      await seedQuiz(tx, { title: `Road signs ${uniqueWord()}` })

      const { items, total } = await searchQuizzes({ q: uniqueWord(), executor: tx })

      expect(items).toEqual([])
      expect(total).toBe(0)
    })
  })

  it('treats an empty q as no filter', async () => {
    await withTestDb(async (tx) => {
      const quiz = await seedQuiz(tx)

      const { items, total } = await searchQuizzes({ q: '', executor: tx })

      expect(items.map((item) => item.slug)).toEqual([quiz.slug])
      expect(total).toBe(1)
    })
  })

  it('treats a whitespace-only q as no filter', async () => {
    await withTestDb(async (tx) => {
      const quiz = await seedQuiz(tx)

      const { items, total } = await searchQuizzes({ q: '   ', executor: tx })

      expect(items.map((item) => item.slug)).toEqual([quiz.slug])
      expect(total).toBe(1)
    })
  })

  it('filters by tag', async () => {
    await withTestDb(async (tx) => {
      const tag = uniqueWord()
      const quiz = await seedQuiz(tx, { tags: [tag, uniqueWord()] })
      await seedQuiz(tx, { tags: [uniqueWord()] })

      const { items, total } = await searchQuizzes({ tag, executor: tx })

      expect(items.map((item) => item.slug)).toEqual([quiz.slug])
      expect(total).toBe(1)
    })
  })

  it('combines q and tag', async () => {
    await withTestDb(async (tx) => {
      const word = uniqueWord()
      const tag = uniqueWord()
      const quiz = await seedQuiz(tx, { title: `Road signs ${word}`, tags: [tag] })
      await seedQuiz(tx, { title: `Road signs ${word}`, tags: [uniqueWord()] })
      await seedQuiz(tx, { title: `Road signs ${uniqueWord()}`, tags: [tag] })

      const { items } = await searchQuizzes({ q: word, tag, executor: tx })

      expect(items.map((item) => item.slug)).toEqual([quiz.slug])
    })
  })

  it('excludes hidden quizzes from text search', async () => {
    await withTestDb(async (tx) => {
      const word = uniqueWord()
      await seedQuiz(tx, { title: `Road signs ${word}`, isHidden: true })

      const { items, total } = await searchQuizzes({ q: word, executor: tx })

      expect(items).toEqual([])
      expect(total).toBe(0)
    })
  })

  it('excludes hidden quizzes from tag search', async () => {
    await withTestDb(async (tx) => {
      const tag = uniqueWord()
      await seedQuiz(tx, { tags: [tag], isHidden: true })

      const { items, total } = await searchQuizzes({ tag, executor: tx })

      expect(items).toEqual([])
      expect(total).toBe(0)
    })
  })

  it('excludes hidden quizzes from an unfiltered listing', async () => {
    await withTestDb(async (tx) => {
      const visible = await seedQuiz(tx)
      await seedQuiz(tx, { isHidden: true })

      const { items, total } = await searchQuizzes({ executor: tx })

      expect(items.map((item) => item.slug)).toEqual([visible.slug])
      expect(total).toBe(1)
    })
  })

  it('counts questions per quiz', async () => {
    await withTestDb(async (tx) => {
      const tag = uniqueWord()
      const withThree = await seedQuiz(tx, { tags: [tag], questionCount: 3 })
      const withNone = await seedQuiz(tx, { tags: [tag] })

      const { items } = await searchQuizzes({ tag, executor: tx })

      expect(items.find((item) => item.slug === withThree.slug)?.questionCount).toBe(3)
      expect(items.find((item) => item.slug === withNone.slug)?.questionCount).toBe(0)
    })
  })

  it('returns the author name', async () => {
    await withTestDb(async (tx) => {
      const authorId = await insertUser(tx, 'Giulia Rossi')
      const word = uniqueWord()
      await seedQuiz(tx, { title: `Road signs ${word}`, authorId })

      const { items } = await searchQuizzes({ q: word, executor: tx })

      expect(items[0].authorName).toBe('Giulia Rossi')
    })
  })

  it('returns a quiz whose author was deleted', async () => {
    await withTestDb(async (tx) => {
      const authorId = await insertUser(tx)
      const word = uniqueWord()
      const quiz = await seedQuiz(tx, { title: `Road signs ${word}`, authorId })

      await tx.delete(user).where(eq(user.id, authorId))

      const { items, total } = await searchQuizzes({ q: word, executor: tx })

      // An inner join would hide the quiz here while still counting it.
      expect(items.map((item) => item.slug)).toEqual([quiz.slug])
      expect(total).toBe(1)
    })
  })

  it('reports a null author name for an orphaned quiz', async () => {
    await withTestDb(async (tx) => {
      const authorId = await insertUser(tx, 'Giulia Rossi')
      const word = uniqueWord()
      await seedQuiz(tx, { title: `Road signs ${word}`, authorId })

      await tx.delete(user).where(eq(user.id, authorId))

      const { items } = await searchQuizzes({ q: word, executor: tx })

      expect(items[0].authorName).toBeNull()
    })
  })

  it('paginates at PAGE_SIZE and reports the true total', async () => {
    await withTestDb(async (tx) => {
      const tag = uniqueWord()
      const authorId = await insertUser(tx)
      const extra = 5
      // Explicit timestamps: everything inserted in one transaction shares the
      // same now(), which would leave the page boundary up to Postgres.
      for (let index = 0; index < PAGE_SIZE + extra; index++) {
        const createdAt = new Date(Date.now() - index * 1000)
        await seedQuiz(tx, { tags: [tag], authorId, createdAt })
      }

      const first = await searchQuizzes({ tag, executor: tx })
      const second = await searchQuizzes({ tag, page: 2, executor: tx })

      expect(first.items).toHaveLength(PAGE_SIZE)
      expect(second.items).toHaveLength(extra)
      expect(first.total).toBe(PAGE_SIZE + extra)
      expect(second.total).toBe(PAGE_SIZE + extra)
      const slugs = [...first.items, ...second.items].map((item) => item.slug)
      expect(new Set(slugs).size).toBe(PAGE_SIZE + extra)
    })
  })

  it('returns an empty page rather than throwing for a page past the end', async () => {
    await withTestDb(async (tx) => {
      const tag = uniqueWord()
      await seedQuiz(tx, { tags: [tag] })

      const { items, total } = await searchQuizzes({ tag, page: 99, executor: tx })

      expect(items).toEqual([])
      expect(total).toBe(1)
    })
  })
})

describe('getQuizBySlug', () => {
  it('returns the quiz for a known slug', async () => {
    await withTestDb(async (tx) => {
      const title = `Road signs ${uniqueWord()}`
      const seeded = await seedQuiz(tx, { title, questionCount: 2 })

      const quiz = await getQuizBySlug(seeded.slug, tx)

      expect(quiz?.title).toBe(title)
      expect(quiz?.questionCount).toBe(2)
      expect(quiz?.authorName).toBe('Author')
    })
  })

  it('returns a quiz whose author was deleted', async () => {
    await withTestDb(async (tx) => {
      const authorId = await insertUser(tx)
      const seeded = await seedQuiz(tx, { authorId })

      await tx.delete(user).where(eq(user.id, authorId))

      const quiz = await getQuizBySlug(seeded.slug, tx)

      expect(quiz?.slug).toBe(seeded.slug)
      expect(quiz?.authorName).toBeNull()
    })
  })

  it('returns null for an unknown slug', async () => {
    await withTestDb(async (tx) => {
      expect(await getQuizBySlug(`quiz-${crypto.randomUUID()}`, tx)).toBeNull()
    })
  })

  it('returns null for a hidden quiz', async () => {
    await withTestDb(async (tx) => {
      const seeded = await seedQuiz(tx, { isHidden: true })

      expect(await getQuizBySlug(seeded.slug, tx)).toBeNull()
    })
  })
})

describe('listPopularTags', () => {
  it('returns tags ordered by frequency', async () => {
    await withTestDb(async (tx) => {
      const common = uniqueWord()
      const rare = uniqueWord()
      const authorId = await insertUser(tx)
      await seedQuiz(tx, { tags: [common, rare], authorId })
      await seedQuiz(tx, { tags: [common], authorId })
      await seedQuiz(tx, { tags: [common], authorId })

      const tags = await listPopularTags(undefined, tx)

      expect(tags).toEqual([common, rare])
    })
  })

  it('ignores tags that only appear on hidden quizzes', async () => {
    await withTestDb(async (tx) => {
      const visible = uniqueWord()
      const hidden = uniqueWord()
      await seedQuiz(tx, { tags: [visible] })
      await seedQuiz(tx, { tags: [hidden], isHidden: true })

      const tags = await listPopularTags(undefined, tx)

      expect(tags).toEqual([visible])
    })
  })
})
