import { render } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactElement } from 'react'
import { locale } from '@/i18n/request'
import messages from '../../messages/en.json'

// Component tests render against the real catalogue rather than a stub, so a
// key that was never added to messages/en.json fails here instead of shipping
// as raw key text.
export function renderWithMessages(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  )
}
