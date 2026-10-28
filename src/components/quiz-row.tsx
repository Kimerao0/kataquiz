import Link from 'next/link'
import { useTranslations } from 'next-intl'
import type { QuizSummary } from '@/lib/quizzes/search'

// One quiz in the catalog. The title carries the weight and is the only
// link: its ::after stretches over the row, so the whole row is the target
// without nesting anything interactive inside it. The description reads;
// tags and the count are metadata and recede into the UI face.
export function QuizRow({ quiz, activeTag }: { quiz: QuizSummary; activeTag?: string }) {
  const t = useTranslations('common')

  return (
    <article className="quiz-row group relative grid gap-x-8 gap-y-2 py-7 sm:grid-cols-[minmax(0,1fr)_auto]">
      <h2 className="font-bold font-reading text-2xl leading-snug tracking-tight">
        <Link
          href={`/q/${quiz.slug}`}
          className="row-link underline-offset-4 decoration-2 group-hover:text-ai group-hover:underline after:absolute after:inset-0"
        >
          {quiz.title}
        </Link>
      </h2>
      {quiz.description && (
        <p className="line-clamp-2 max-w-measure font-reading text-ink-quiet sm:col-start-1">
          {quiz.description}
        </p>
      )}
      {quiz.tags.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 text-meta text-ink-quiet sm:col-start-1">
          {quiz.tags.map((tag) => (
            <li key={tag} className={tag === activeTag ? 'font-semibold text-ai' : undefined}>
              {tag}
            </li>
          ))}
        </ul>
      )}
      <p className="text-ink-quiet text-meta sm:col-start-2 sm:row-start-1 sm:self-center">
        {t('questionCount', { count: quiz.questionCount })}
      </p>
    </article>
  )
}
