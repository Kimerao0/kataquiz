-- R4 of specs/architect-roadmap-v2.md: hard-deletes the seed quizzes R4 changed (24-39 and 41; 26 and 40
-- are unchanged) and the path, so `pnpm db:seed`, which runs right after migrations in `pnpm release`,
-- re-imports them under the same titles. Cascades remove questions, options, attempts, answers and path steps.
DELETE FROM "paths" WHERE "author_id" = 'kataquiz-seed-author' AND "title" = 'Road to Software Architect';
--> statement-breakpoint
DELETE FROM "quizzes" WHERE "author_id" = 'kataquiz-seed-author' AND "title" IN (
  'Architect Roadmap 24: Event-driven architecture fundamentals',
  'Architect Roadmap 25: Event sourcing and CQRS',
  'Architect Roadmap 27: Messaging platforms',
  'Architect Roadmap 28: Architectural styles and DDD',
  'Architect Roadmap 29: Distributed systems fundamentals',
  'Architect Roadmap 30: Relational databases in depth',
  'Architect Roadmap 31: NoSQL and data modeling',
  'Architect Roadmap 32: Caching at scale',
  'Architect Roadmap 33: Infrastructure as Code and CI/CD',
  'Architect Roadmap 34: Containers and Kubernetes',
  'Architect Roadmap 35: SRE and observability',
  'Architect Roadmap 36: Security architecture',
  'Architect Roadmap 37: Costs and FinOps',
  'Architect Roadmap 38: Quality attributes',
  'Architect Roadmap 39: Documenting the architecture',
  'Architect Roadmap 41: System design case studies'
);
