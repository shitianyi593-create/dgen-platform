import { useContext, useMemo } from 'react'
import { I18nContext, type I18nContextValue } from './I18nContext'
import {
  DEFAULT_LOCALE,
  messages,
  type Locale,
  type MessageKey,
} from './locales'

function interpolate(message: string, params?: Record<string, string | number>) {
  if (!params) return message
  return message.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) => (
    params[name] === undefined ? match : String(params[name])
  ))
}

export function useOptionalI18n(): I18nContextValue {
  const context = useContext(I18nContext)
  return useMemo(() => (
    context ?? {
      locale: DEFAULT_LOCALE as Locale,
      setLocale: () => {},
      t: (key: MessageKey, params?: Record<string, string | number>) =>
        interpolate(messages[DEFAULT_LOCALE][key] ?? key, params),
    }
  ), [context])
}
