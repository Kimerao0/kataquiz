import { useTranslations } from 'next-intl'

// The file format is defined by src/lib/quiz-schema and written up in
// README.md, neither of which is where someone writing their first quiz is
// standing. This is the worked example, not the reference: one question of
// each type, the optional explanation, and the three rules that reject most
// first attempts. A native <details> keeps it collapsed, keyboard-operable and
// free of client JavaScript.
export function FormatHelp() {
  const t = useTranslations('upload')

  return (
    <details className="border-rule border-y py-3">
      <summary className="cursor-pointer text-meta">{t('formatSummary')}</summary>
      <div className="flex flex-col gap-3 pt-3">
        <p className="text-muted-foreground text-sm">{t('formatIntro')}</p>
        {/* Scrolls sideways on a narrow screen instead of widening the page. */}
        <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
          <code>{t('formatExample')}</code>
        </pre>
        <div className="flex flex-col gap-1">
          <h2 className="font-medium text-sm">{t('formatRulesTitle')}</h2>
          <ul className="flex list-disc flex-col gap-1 ps-5 text-muted-foreground text-sm">
            <li>{t('formatRuleOptions')}</li>
            <li>{t('formatRuleSingle')}</li>
            <li>{t('formatRuleBoolean')}</li>
            <li>{t('formatRulePerRun')}</li>
          </ul>
        </div>
      </div>
    </details>
  )
}
