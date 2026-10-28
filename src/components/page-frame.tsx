import type { ReactNode } from 'react'

// The one composition every page shares (see .page in globals.css): a head
// column carrying the title, a body column carrying the work, and the spine
// between them. The title is the only loud thing; `user` sizes it for text
// somebody else wrote.
export function PageFrame({
  title,
  userTitle = false,
  lead,
  seal,
  tools,
  children,
}: {
  title?: ReactNode
  userTitle?: boolean
  lead?: ReactNode
  seal?: ReactNode
  tools?: ReactNode
  children: ReactNode
}) {
  return (
    <main className="page">
      <header className="page-head">
        {seal}
        {title && <h1 className={userTitle ? 'display display-user' : 'display'}>{title}</h1>}
        {lead && <p className="font-reading text-ink-quiet text-prose">{lead}</p>}
        {tools}
      </header>
      <div className="page-body">{children}</div>
    </main>
  )
}
