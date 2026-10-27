import { relations } from 'drizzle-orm'
import {
  type AnyPgColumn,
  boolean,
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

export const quizzes = pgTable('quizzes', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  // Plain text, no foreign key: Better Auth creates the `user` table in a later
  // task, and that task's migration adds the constraint.
  authorId: text('author_id').notNull(),
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
})

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
  // Plain text, no foreign key: Better Auth creates the `user` table in a later
  // task, and that task's migration adds the constraint.
  userId: text('user_id'),
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

export const quizzesRelations = relations(quizzes, ({ many }) => ({
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
