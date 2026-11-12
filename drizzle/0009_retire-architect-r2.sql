-- R2 of specs/architect-roadmap-v2.md: hard-deletes the seed quizzes R2 changed (07-13 and 15; 14 is
-- unchanged and keeps its attempts) and the path, so `pnpm db:seed`, which runs right after
-- migrations in `pnpm release`, re-imports them under the same titles. Cascades remove questions,
-- options, attempts, answers and path steps.
DELETE FROM "paths" WHERE "author_id" = 'kataquiz-seed-author' AND "title" = 'Road to Software Architect';
--> statement-breakpoint
DELETE FROM "quizzes" WHERE "author_id" = 'kataquiz-seed-author' AND "title" IN (
  'Architect Roadmap 07: App Router and routing',
  'Architect Roadmap 08: Server and Client Components',
  'Architect Roadmap 09: Data fetching, caching and Server Actions',
  'Architect Roadmap 10: Next.js in production',
  'Architect Roadmap 11: Design patterns in React',
  'Architect Roadmap 12: State architecture',
  'Architect Roadmap 13: Next.js as a backend [SCENARIO]',
  'Architect Roadmap 15: System design of a production Next.js app [SCENARIO]'
);
