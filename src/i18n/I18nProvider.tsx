import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { I18nContext, type I18nContextValue } from './I18nContext'
import {
  DEFAULT_LOCALE,
  I18N_STORAGE_KEY,
  type Locale,
  type MessageKey,
  messages,
  resolveLocale,
} from './locales'

function resolveBrowserLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE
  const languages = window.navigator.languages?.length
    ? window.navigator.languages
    : [window.navigator.language]
  const primary = languages.find(Boolean)?.toLowerCase()
  if (!primary) return DEFAULT_LOCALE
  return primary.startsWith('zh') ? 'zh-CN' : 'en-US'
}

function readStoredLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(I18N_STORAGE_KEY)
    return stored ? resolveLocale(stored) : resolveBrowserLocale()
  } catch {
    return DEFAULT_LOCALE
  }
}

function writeStoredLocale(locale: Locale) {
  try {
    window.localStorage.setItem(I18N_STORAGE_KEY, locale)
  } catch {
    // Best effort only; the UI still updates even when browser storage is blocked.
  }
}

function interpolate(message: string, params?: Record<string, string | number>) {
  if (!params) return message
  return message.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) => (
    params[name] === undefined ? match : String(params[name])
  ))
}

interface I18nProviderProps {
  children: ReactNode
  initialLocale?: Locale
}

export function I18nProvider({ children, initialLocale }: I18nProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale ?? readStoredLocale())

  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale)
    writeStoredLocale(nextLocale)
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale,
    t: (key: MessageKey, params?: Record<string, string | number>) => interpolate(messages[locale][key] ?? key, params),
  }), [locale, setLocale])

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  )
}
