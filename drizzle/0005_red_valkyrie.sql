CREATE INDEX "attempt_answers_question_id_index" ON "attempt_answers" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "attempts_quiz_id_user_id_started_at_index" ON "attempts" USING btree ("quiz_id","user_id","started_at");--> statement-breakpoint
CREATE INDEX "attempts_quiz_id_guest_id_started_at_index" ON "attempts" USING btree ("quiz_id","guest_id","started_at");