'use client'

import { redirect } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useActionState, useRef, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { type UploadResult, uploadQuizAction } from './actions'

// React resets the uncontrolled fields of a <form action> once the action
// returns, which on a rejected upload wipes the quiz the author had just
// pasted — exactly when they need it back. The textarea is controlled for that
// reason. A file input cannot be: nothing but the user may put a file there,
// so the form says the file is gone instead of pretending it is still attached.
type SubmitState = { result: UploadResult; hadFile: boolean }

// Zod paths are zero-indexed, so `questions.3` is the fourth question and a
// reader counting from one looks in the wrong place. The schema deliberately
// imports nothing from the app, so the position is translated here, on the way
// to the screen, and the message it carries is left alone.
const QUESTION_PATH = /^questions\.(\d+)(?:\.(.+))?: ([\s\S]+)$/

export function UploadForm() {
  const t = useTranslations('upload')
  const fileRef = useRef<HTMLInputElement>(null)
  const [state, formAction, pending] = useActionState(submitUpload, null)
  const [text, setText] = useState('')

  // useActionState hands the previous state to the action; the action itself
  // only ever needs the form.
  async function submitUpload(
    _previous: SubmitState | null,
    formData: FormData,
  ): Promise<SubmitState> {
    // Read on the way past rather than from the result: React empties the
    // input the moment the action returns, so this is the last point at which
    // anything can tell whether a file was attached.
    const hadFile = (fileRef.current?.files?.length ?? 0) > 0
    return { result: await uploadQuizAction(formData), hadFile }
  }

  if (state?.result.ok) redirect(`/q/${state.result.slug}`)

  const failure =
    state !== null && !state.result.ok
      ? { errors: state.result.errors, hadFile: state.hadFile }
      : null

  function humanize(error: string) {
    const match = QUESTION_PATH.exec(error)
    if (match === null) return error

    const [, index = '', field = '', message = ''] = match
    const position = Number(index) + 1
    const location =
      field === '' ? t('errorQuestion', { position }) : t('errorQuestionField', { position, field })
    return t('errorEntry', { location, message })
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="file">{t('fileLabel')}</Label>
        <Input
          ref={fileRef}
          id="file"
          name="file"
          type="file"
          accept=".yaml,.yml,.json"
          aria-describedby={failure?.hadFile ? 'file-cleared' : undefined}
        />
        {failure?.hadFile && (
          <p id="file-cleared" className="text-muted-foreground text-sm">
            {t('fileCleared')}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="text">{t('textLabel')}</Label>
        <Textarea
          id="text"
          name="text"
          rows={12}
          placeholder={t('textPlaceholder')}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      {failure !== null && (
        <Alert variant="destructive">
          <AlertTitle>{t('errorsTitle')}</AlertTitle>
          <AlertDescription>
            <ul className="flex list-disc flex-col gap-1 ps-5">
              {failure.errors.map((error, index) => (
                // Two questions can break the same rule, so the message alone
                // is not an identity. Its place in the list is: the list is
                // replaced wholesale by the next submission and is never
                // reordered, filtered or appended to in place.
                // biome-ignore lint/suspicious/noArrayIndexKey: the list is rebuilt, never reordered
                <li key={`${index}-${error}`}>{humanize(error)}</li>
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
