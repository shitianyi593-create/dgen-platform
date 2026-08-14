import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  DEFAULT_LOCALE,
  I18N_STORAGE_KEY,
  type Locale,
  messages,
} from '../i18n/locales'
import { I18nProvider } from '../i18n/I18nProvider'
import { useI18n } from '../i18n/useI18n'

function Probe() {
  const { locale, setLocale, t } = useI18n()

  return (
    <div>
      <p data-testid="locale">{locale}</p>
      <p data-testid="nav-video">{t('nav.video')}</p>
      <p data-testid="brand-description">{t('brand.description')}</p>
      <button type="button" onClick={() => setLocale('en-US')}>
        English
      </button>
      <button type="button" onClick={() => setLocale('zh-CN')}>
        Chinese
      </button>
    </div>
  )
}

describe('i18n infrastructure', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.lang = ''
  })

  it('ships zh-CN and en-US dictionaries with identical keys', () => {
    const zhKeys = Object.keys(messages['zh-CN']).sort()
    const enKeys = Object.keys(messages['en-US']).sort()

    expect(Object.keys(messages).sort()).toEqual(['en-US', 'zh-CN'])
    expect(zhKeys).toEqual(enKeys)
    expect(zhKeys.length).toBeGreaterThan(10)
  })

  it('defaults to zh-CN and exposes typed translation lookup', () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    )

    expect(screen.getByTestId('locale')).toHaveTextContent(DEFAULT_LOCALE)
    expect(screen.getByTestId('nav-video')).toHaveTextContent('视频生成')
    expect(screen.getByTestId('brand-description')).toHaveTextContent('AI 创意工作台')
    expect(document.documentElement.lang).toBe('zh-CN')
  })

  it('persists locale changes to localStorage and updates document lang', () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'English' }))

    expect(screen.getByTestId('locale')).toHaveTextContent('en-US')
    expect(screen.getByTestId('nav-video')).toHaveTextContent('Video')
    expect(localStorage.getItem(I18N_STORAGE_KEY)).toBe('en-US')
    expect(document.documentElement.lang).toBe('en-US')
  })

  it('hydrates from a valid stored locale and ignores invalid values', () => {
    localStorage.setItem(I18N_STORAGE_KEY, 'en-US' satisfies Locale)

    const { unmount } = render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    )
    expect(screen.getByTestId('locale')).toHaveTextContent('en-US')
    unmount()

    localStorage.setItem(I18N_STORAGE_KEY, 'fr-FR')
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    )
    expect(screen.getByTestId('locale')).toHaveTextContent(DEFAULT_LOCALE)
  })
})
