const zhCN = {
  'brand.name': 'DGen',
  'brand.title': 'DGen — AI 创意工作台',
  'brand.description': 'AI 创意工作台',
  'nav.video': '视频生成',
  'nav.video25': '视频生成 2.5',
  'nav.image': '图片生成',
  'nav.chat': '文字生成',
  'nav.assets': '私有素材库管理',
  'locale.label': '语言',
  'locale.zhCN': '简体中文',
  'locale.enUS': 'English',
  'locale.switchToZhCN': '切换到简体中文',
  'locale.switchToEnUS': 'Switch to English',
  'common.loading': '加载中',
  'common.error': '出错了',
  'common.namedError': '出错了：{name}',
  'common.retry': '重试',
  'common.cancel': '取消',
  'common.confirm': '确认',
  'credentials.openSettings': '打开凭证设置',
  'credentials.title': '凭证设置',
} as const

type MessageKey = keyof typeof zhCN

const enUS = {
  'brand.name': 'DGen',
  'brand.title': 'DGen — AI Creative Studio',
  'brand.description': 'AI Creative Studio',
  'nav.video': 'Video',
  'nav.video25': 'Video 2.5',
  'nav.image': 'Image',
  'nav.chat': 'Text',
  'nav.assets': 'Private Assets',
  'locale.label': 'Language',
  'locale.zhCN': '简体中文',
  'locale.enUS': 'English',
  'locale.switchToZhCN': 'Switch to Simplified Chinese',
  'locale.switchToEnUS': 'Switch to English',
  'common.loading': 'Loading',
  'common.error': 'Something went wrong',
  'common.namedError': 'Something went wrong: {name}',
  'common.retry': 'Retry',
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
  'credentials.openSettings': 'Open credential settings',
  'credentials.title': 'Credential Settings',
} satisfies Record<MessageKey, string>

export const DEFAULT_LOCALE = 'zh-CN'
export const I18N_STORAGE_KEY = 'dgen.locale'

export const LOCALES = ['zh-CN', 'en-US'] as const
export type Locale = (typeof LOCALES)[number]

export const messages = {
  'zh-CN': zhCN,
  'en-US': enUS,
} satisfies Record<Locale, Record<MessageKey, string>>

export type { MessageKey }

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && LOCALES.includes(value as Locale)
}

export function resolveLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE
}
