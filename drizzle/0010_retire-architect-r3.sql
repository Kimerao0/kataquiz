-- R3 of specs/architect-roadmap-v2.md: hard-deletes the seed quizzes R3 changed (all of 16-23) and the
-- path, so `pnpm db:seed`, which runs right after migrations in `pnpm release`, re-imports them under
-- the same titles. Cascades remove questions, options, attempts, answers and path steps.
DELETE FROM "paths" WHERE "author_id" = 'kataquiz-seed-author' AND "title" = 'Road to Software Architect';
--> statement-breakpoint
DELETE FROM "quizzes" WHERE "author_id" = 'kataquiz-seed-author' AND "title" IN (
  'Architect Roadmap 16: Node.js core concepts and the event loop',
  'Architect Roadmap 17: Node.js asynchronous patterns',
  'Architect Roadmap 18: Node.js streams',
  'Architect Roadmap 19: GoF design patterns in Node.js',
  'Architect Roadmap 20: Scalability and messaging in Node.js',
  'Architect Roadmap 21: Node.js performance and debugging',
  'Architect Roadmap 22: APIs and data in Node.js services',
  'Architect Roadmap 23: Reliability and security in Node.js'
);
