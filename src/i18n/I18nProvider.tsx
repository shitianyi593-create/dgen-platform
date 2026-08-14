import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { I18nContext, type I18nContextValue } from './I18nContext'
import {
  DEFAULT_LOCALE,
  I18N_STORAGE_KEY,
  type Locale,
  messages,
  resolveLocale,
} from './locales'

function readStoredLocale(): Locale {
  try {
    return resolveLocale(window.localStorage.getItem(I18N_STORAGE_KEY))
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
    t: (key) => messages[locale][key],
  }), [locale, setLocale])

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  )
}
