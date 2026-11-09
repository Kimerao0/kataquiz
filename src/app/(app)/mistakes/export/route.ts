import type { NextRequest } from 'next/server'
import { mistakesExportFilename } from '@/lib/mistakes/filename'
import { getMistakes, parseMistakesTag, toMistakesExport } from '@/lib/mistakes/mistakes'
import { getCurrentUser } from '@/lib/session'

// Reading the session reads request headers, which is what keeps this handler
// out of the prerender: with Cache Components there is no `dynamic` export.
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })

  // A repeated ?tag is no filter, as on the page, which reads it as an array.
  const tags = request.nextUrl.searchParams.getAll('tag')
  const tag = parseMistakesTag(tags.length === 1 ? tags[0] : tags)
  const mistakes = await getMistakes(user.id, { tag })
  const now = new Date()

  return Response.json(toMistakesExport(mistakes, tag, now), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${mistakesExportFilename(tag, now)}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
