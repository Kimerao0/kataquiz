'use server'

import { getTranslations } from 'next-intl/server'
import { parseQuizText } from '@/lib/quiz-schema'
import { importQuiz, MAX_UPLOAD_BYTES } from '@/lib/quizzes/import'
import { checkRateLimit, UPLOAD_LIMIT, UPLOAD_WINDOW_SEC } from '@/lib/rate-limit'
import { requireUser, type SessionUser, UnauthorizedError } from '@/lib/session'

export type UploadResult = { ok: true; slug: string } | { ok: false; errors: string[] }

export async function uploadQuizAction(formData: FormData): Promise<UploadResult> {
  const t = await getTranslations('upload.errors')

  let author: SessionUser
  try {
    author = await requireUser()
  } catch (error) {
    // A Server Action that throws reaches the browser as an opaque 500, so the
    // one error we expect here is returned like any other.
    if (!(error instanceof UnauthorizedError)) throw error
    return { ok: false, errors: [t('unauthorized')] }
  }

  // A Server Action is invocable directly, whatever the page renders, so the
  // limit is keyed on the authenticated user and not on anything the caller
  // supplies. The prefix keeps it out of the way of the IP-keyed run limit,
  // which shares this table's primary key.
  const allowed = await checkRateLimit(`upload:${author.id}`, UPLOAD_LIMIT, UPLOAD_WINDOW_SEC)
  if (!allowed) return { ok: false, errors: [t('rateLimited')] }

  const text = await readUploadText(formData)
  if (text.trim() === '') return { ok: false, errors: [t('empty')] }

  // Bytes, not characters: a payload of multi-byte characters is twice the
  // size its length suggests.
  if (Buffer.byteLength(text, 'utf8') > MAX_UPLOAD_BYTES) {
    return { ok: false, errors: [t('tooLarge')] }
  }

  const parsed = parseQuizText(text)
  if (!parsed.ok) return { ok: false, errors: parsed.errors }

  const { slug } = await importQuiz({ file: parsed.data, authorId: author.id })
  return { ok: true, slug }
}

async function readUploadText(formData: FormData): Promise<string> {
  // An untouched file input still submits an empty File, hence the size check.
  const file = formData.get('file')
  if (file instanceof File && file.size > 0) return file.text()

  const pasted = formData.get('text')
  return typeof pasted === 'string' ? pasted : ''
}
