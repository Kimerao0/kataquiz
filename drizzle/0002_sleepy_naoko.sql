ALTER TABLE "quizzes" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, ''))) STORED;--> statement-breakpoint
CREATE INDEX "quizzes_search_vector_index" ON "quizzes" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "quizzes_tags_index" ON "quizzes" USING gin ("tags");