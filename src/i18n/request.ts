import { getRequestConfig } from 'next-intl/server'

// One locale today. Every user-visible string still goes through next-intl so
// that adding a second locale is a new messages file, not a refactor of the UI.
export const locale = 'en'

export default getRequestConfig(async () => ({
  locale,
  messages: (await import('../../messages/en.json')).default,
}))
