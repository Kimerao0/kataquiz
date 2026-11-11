-- R1 of specs/architect-roadmap-v2.md: hard-deletes the replaced seed quizzes and their path so
-- `pnpm db:seed`, which runs right after migrations in `pnpm release`, re-imports the rewritten
-- seeds under the same titles. Cascades remove questions, options, attempts, answers and path steps.
DELETE FROM "paths" WHERE "author_id" = 'kataquiz-seed-author' AND "title" = 'Road to Software Architect';
--> statement-breakpoint
DELETE FROM "quizzes" WHERE "author_id" = 'kataquiz-seed-author' AND "title" IN (
  'Architect Roadmap 01: React fundamentals',
  'Architect Roadmap 02: React state and events',
  'Architect Roadmap 03: React effects and lifecycle',
  'Architect Roadmap 04: Advanced hooks and custom hooks',
  'Architect Roadmap 05: React performance and rendering',
  'Architect Roadmap 06: What''s new in React 19'
);
