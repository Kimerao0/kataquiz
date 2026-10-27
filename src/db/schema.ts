import { relations, sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  boolean,
  customType,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

// Mirrors QuestionType in src/lib/quiz-schema: the two lists must stay in sync.
export const questionType = pgEnum('question_type', ['single', 'multi', 'boolean'])

// The next four tables have the shape Better Auth dictates, down to the string
// ids it generates. Their export names are load-bearing: the Drizzle adapter
// looks each model up by name, so a plural or renamed export does not break the
// build, it breaks the first sign-in.
export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [index().on(table.userId)],
)

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index().on(table.userId)],
)

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index().on(table.identifier)],
)

// Drizzle ships no tsvector type, and the column is never written from the
// application, so the SQL type is all it needs.
const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector'
  },
})

export const quizzes = pgTable(
  'quizzes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    language: text('language').notNull(),
    tags: text('tags').array().notNull().default([]),
    questionsPerRun: integer('questions_per_run').notNull(),
    maxErrors: integer('max_errors').notNull(),
    timePerQuestionSec: integer('time_per_question_sec'),
    isHidden: boolean('is_hidden').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    // 'simple' and not 'english': quiz content is multilingual by design, and
    // the English stemmer would mangle every other language. Postgres keeps the
    // column in step with the two source columns on every write.
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, ''))`,
    ),
  },
  // GIN on both: one makes the text search cheap, the other the tag filter.
  (table) => [index().using('gin', table.searchVector), index().using('gin', table.tags)],
)

export const questions = pgTable(
  'questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    quizId: uuid('quiz_id')
      .notNull()
      .references(() => quizzes.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    type: questionType('type').notNull(),
    prompt: text('prompt').notNull(),
    imageUrl: text('image_url'),
    explanation: text('explanation'),
    theoryUrl: text('theory_url'),
  },
  (table) => [unique().on(table.quizId, table.position)],
)

export const options = pgTable(
  'options',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    text: text('text').notNull(),
    isCorrect: boolean('is_correct').notNull(),
  },
  (table) => [unique().on(table.questionId, table.position)],
)

export const attempts = pgTable('attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  quizId: uuid('quiz_id')
    .notNull()
    .references(() => quizzes.id, { onDelete: 'cascade' }),
  // Set null where quizzes cascade: deleting an account anonymises its past
  // attempts rather than destroying the scores other players were compared to.
  userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
  guestId: text('guest_id'),
  nickname: text('nickname'),
  questionIds: uuid('question_ids').array().notNull(),
  // The explicit return type breaks the circular inference of the self-reference.
  challengeOfAttemptId: uuid('challenge_of_attempt_id').references((): AnyPgColumn => attempts.id),
  score: integer('score').notNull().default(0),
  errors: integer('errors').notNull().default(0),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
})

export const attemptAnswers = pgTable(
  'attempt_answers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => attempts.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    selectedOptionIds: uuid('selected_option_ids').array().notNull(),
    isCorrect: boolean('is_correct').notNull(),
    elapsedMs: integer('elapsed_ms').notNull(),
    timedOut: boolean('timed_out').notNull().default(false),
    answeredAt: timestamp('answered_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // One row per question per attempt: this is what makes a double-submitted
  // answer impossible, whatever the application layer does.
  (table) => [unique().on(table.attemptId, table.questionId)],
)

export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  count: integer('count').notNull(),
})

export const userRelations = relations(user, ({ many }) => ({
  quizzes: many(quizzes),
}))

export const quizzesRelations = relations(quizzes, ({ one, many }) => ({
  author: one(user, { fields: [quizzes.authorId], references: [user.id] }),
  questions: many(questions),
}))

export const questionsRelations = relations(questions, ({ one, many }) => ({
  quiz: one(quizzes, { fields: [questions.quizId], references: [quizzes.id] }),
  options: many(options),
}))

export const optionsRelations = relations(options, ({ one }) => ({
  question: one(questions, { fields: [options.questionId], references: [questions.id] }),
}))

export const attemptsRelations = relations(attempts, ({ one, many }) => ({
  quiz: one(quizzes, { fields: [attempts.quizId], references: [quizzes.id] }),
  answers: many(attemptAnswers),
}))

// Drizzle derives the join keys of a many() from the matching one() on the other
// table, so without this the `answers` relation above cannot be queried at all.
export const attemptAnswersRelations = relations(attemptAnswers, ({ one }) => ({
  attempt: one(attempts, { fields: [attemptAnswers.attemptId], references: [attempts.id] }),
  question: one(questions, { fields: [attemptAnswers.questionId], references: [questions.id] }),
}))

export type User = typeof user.$inferSelect
export type NewUser = typeof user.$inferInsert
export type Quiz = typeof quizzes.$inferSelect
export type NewQuiz = typeof quizzes.$inferInsert
export type Question = typeof questions.$inferSelect
export type NewQuestion = typeof questions.$inferInsert
export type Option = typeof options.$inferSelect
export type NewOption = typeof options.$inferInsert
export type Attempt = typeof attempts.$inferSelect
export type NewAttempt = typeof attempts.$inferInsert
export type AttemptAnswer = typeof attemptAnswers.$inferSelect
export type NewAttemptAnswer = typeof attemptAnswers.$inferInsert
