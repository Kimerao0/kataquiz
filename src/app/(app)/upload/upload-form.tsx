'use client'

import { redirect } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useActionState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { type UploadResult, uploadQuizAction } from './actions'

// useActionState hands the previous state to the action; the action itself only
// ever needs the form.
function submitUpload(_previous: UploadResult | null, formData: FormData) {
  return uploadQuizAction(formData)
}

export function UploadForm() {
  const t = useTranslations('upload')
  const [result, formAction, pending] = useActionState(submitUpload, null)

  if (result?.ok) redirect(`/q/${result.slug}`)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="file">{t('fileLabel')}</Label>
        <Input id="file" name="file" type="file" accept=".yaml,.yml,.json" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="text">{t('textLabel')}</Label>
        <Textarea id="text" name="text" rows={12} placeholder={t('textPlaceholder')} />
      </div>
      {result && !result.ok && (
        <Alert variant="destructive">
          <AlertTitle>{t('errorsTitle')}</AlertTitle>
          <AlertDescription>
            <ul>
              {result.errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? t('submitting') : t('submit')}
      </Button>
    </form>
  )
}
