CREATE TABLE "path_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"path_id" uuid NOT NULL,
	"quiz_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "path_steps_path_id_position_unique" UNIQUE("path_id","position"),
	CONSTRAINT "path_steps_path_id_quiz_id_unique" UNIQUE("path_id","quiz_id")
);
--> statement-breakpoint
CREATE TABLE "paths" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"author_id" text,
	"title" text NOT NULL,
	"description" text,
	"language" text NOT NULL,
	"is_hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "paths_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "path_steps" ADD CONSTRAINT "path_steps_path_id_paths_id_fk" FOREIGN KEY ("path_id") REFERENCES "public"."paths"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "path_steps" ADD CONSTRAINT "path_steps_quiz_id_quizzes_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quizzes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paths" ADD CONSTRAINT "paths_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "path_steps_quiz_id_index" ON "path_steps" USING btree ("quiz_id");