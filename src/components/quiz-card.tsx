import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { QuizSummary } from '@/lib/quizzes/search'

export function QuizCard({ quiz }: { quiz: QuizSummary }) {
  const t = useTranslations('common')

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>
          <Link href={`/q/${quiz.slug}`}>{quiz.title}</Link>
        </CardTitle>
        {quiz.description && (
          <CardDescription className="line-clamp-2">{quiz.description}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        {quiz.tags.map((tag) => (
          <Badge key={tag} variant="outline">
            {tag}
          </Badge>
        ))}
        <span className="text-muted-foreground text-xs">
          {t('questionCount', { count: quiz.questionCount })}
        </span>
      </CardContent>
    </Card>
  )
}
