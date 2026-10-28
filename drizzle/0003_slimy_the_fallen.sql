ALTER TABLE "quizzes" DROP CONSTRAINT "quizzes_author_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "quizzes" ALTER COLUMN "author_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;