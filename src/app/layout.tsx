import type { Metadata } from 'next'
import { IBM_Plex_Mono, Literata } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { SiteHeader } from '@/components/site-header'
import { themeInitScript } from '@/lib/theme'
import './globals.css'

const literata = Literata({
  variable: '--font-literata',
  // The opsz axis is what gives large Literata its higher stroke contrast.
  axes: ['opsz'],
  subsets: ['latin'],
})

const plexMono = IBM_Plex_Mono({
  variable: '--font-plex-mono',
  weight: ['400', '500', '600'],
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'Kataquiz',
  description: 'Upload a question bank, drill it, challenge people with a link.',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const messages = await getMessages()

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${literata.variable} ${plexMono.variable} h-full antialiased`}
    >
      <head>
        <script>{themeInitScript}</script>
      </head>
      <body className="flex min-h-full flex-col">
        <NextIntlClientProvider messages={messages}>
          <SiteHeader />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
