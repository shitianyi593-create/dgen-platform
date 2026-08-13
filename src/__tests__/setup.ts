import '@testing-library/jest-dom/vitest'

// Some Node/jsdom combinations (notably Node ≥ 25 with jsdom 29) don't expose
// a working Storage instance on `globalThis.localStorage`. Zustand's `persist`
// middleware then crashes with "storage.setItem is not a function" the first
// time a persisted store is written to in a test.
//
// Always install a minimal in-memory Storage so tests behave the same across
// Node versions and never touch any real browser storage.
;(function installMemoryStorage() {
  const needsShim = (s: unknown): boolean => {
    if (typeof s === 'undefined' || s === null) return true
    const candidate = s as Partial<Storage>
    return (
      typeof candidate.setItem !== 'function' ||
      typeof candidate.getItem !== 'function' ||
      typeof candidate.removeItem !== 'function'
    )
  }

  const makeStorage = (): Storage => {
    const map = new Map<string, string>()
    return {
      get length() {
        return map.size
      },
      clear: () => map.clear(),
      getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
      setItem: (key: string, value: string) => {
        map.set(key, String(value))
      },
      removeItem: (key: string) => {
        map.delete(key)
      },
      key: (i: number) => Array.from(map.keys())[i] ?? null,
    }
  }

  const g = globalThis as typeof globalThis & {
    localStorage?: Storage
    sessionStorage?: Storage
  }

  if (needsShim(g.localStorage)) {
    Object.defineProperty(g, 'localStorage', {
      value: makeStorage(),
      writable: true,
      configurable: true,
    })
  }
  if (needsShim(g.sessionStorage)) {
    Object.defineProperty(g, 'sessionStorage', {
      value: makeStorage(),
      writable: true,
      configurable: true,
    })
  }
})()
