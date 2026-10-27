import { useTranslations } from 'next-intl'

export default function HomePage() {
  const t = useTranslations('app')

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 p-8">
      <h1 className="font-bold text-4xl">{t('name')}</h1>
      <p className="text-lg opacity-70">{t('tagline')}</p>
    </main>
  )
}
