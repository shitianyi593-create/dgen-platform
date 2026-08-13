import { describe, it, expect } from 'vitest'
import { parseEnv, mapToCreds, type EnvCredsPartial } from '../components/credentials/envImport'

describe('parseEnv', () => {
  it('parses KEY=value', () => {
    expect(parseEnv('FOO=bar')).toEqual({ FOO: 'bar' })
  })

  it('strips `export ` prefix', () => {
    expect(parseEnv('export FOO=bar')).toEqual({ FOO: 'bar' })
  })

  it('ignores blank lines and # comments', () => {
    expect(parseEnv('\n# a comment\nFOO=bar\n')).toEqual({ FOO: 'bar' })
  })

  it('strips trailing comment after `space + #`', () => {
    expect(parseEnv('FOO=bar # comment')).toEqual({ FOO: 'bar' })
  })

  it('keeps `#` when it has no preceding space', () => {
    expect(parseEnv('FOO=ba#r')).toEqual({ FOO: 'ba#r' })
  })

  it('unwraps double quotes (and preserves `#` inside)', () => {
    expect(parseEnv('FOO="ba # r"')).toEqual({ FOO: 'ba # r' })
  })

  it('unwraps single quotes literally', () => {
    expect(parseEnv("FOO='bar'")).toEqual({ FOO: 'bar' })
  })

  it('trims surrounding whitespace on unquoted values', () => {
    expect(parseEnv('FOO=   bar   ')).toEqual({ FOO: 'bar' })
  })

  it('last write wins when the same key appears twice', () => {
    expect(parseEnv('FOO=a\nFOO=b')).toEqual({ FOO: 'b' })
  })

  it('skips malformed lines without throwing', () => {
    expect(parseEnv('not-a-kv-line\n=novalue\n123=invalid-key\nFOO=bar')).toEqual({ FOO: 'bar' })
  })

  it('returns empty string for KEY= (caller decides what to do)', () => {
    expect(parseEnv('FOO=')).toEqual({ FOO: '' })
  })
})

describe('mapToCreds', () => {
  it('maps a full three-group .env to all three credential groups', () => {
    const out = mapToCreds({
      ARK_API_KEY: 'ak',
      ARK_ENDPOINT_ID: 'ep-20240101000000-aaaaa',
      BYTEPLUS_AK: 'asset-ak',
      BYTEPLUS_SK: 'asset-sk',
      BYTEPLUS_PROJECT_NAME: 'proj-x',
      TOS_ACCESS_KEY: 'tos-ak',
      TOS_SECRET_KEY: 'tos-sk',
      TOS_REGION: 'ap-southeast-1',
      TOS_BUCKET: 'mybucket',
    })
    expect(out).toEqual({
      inference: { apiKey: 'ak', endpoint: 'ep-20240101000000-aaaaa' },
      asset: { accessKeyId: 'asset-ak', accessKeySecret: 'asset-sk', projectName: 'proj-x' },
      tos: { accessKeyId: 'tos-ak', accessKeySecret: 'tos-sk', region: 'ap-southeast-1', bucket: 'mybucket' },
    })
  })

  it('returns only the groups that have any value', () => {
    const out: EnvCredsPartial = mapToCreds({ TOS_BUCKET: 'mybucket' })
    expect(out.inference).toBeUndefined()
    expect(out.asset).toBeUndefined()
    expect(out.tos).toEqual({ bucket: 'mybucket' })
  })

  it('honors alias priority (first-listed wins)', () => {
    const out = mapToCreds({
      TOS_ACCESS_KEY: 'primary',
      TOS_AK: 'fallback',
    })
    expect(out.tos?.accessKeyId).toBe('primary')
  })

  it('falls back to a later alias when the primary is missing', () => {
    expect(mapToCreds({ TOS_AK: 'fallback' }).tos?.accessKeyId).toBe('fallback')
  })

  it('strips VITE_ prefix during normalization', () => {
    expect(mapToCreds({ VITE_TOS_BUCKET: 'mybucket' }).tos?.bucket).toBe('mybucket')
  })

  it('accepts bare ENDPOINT as inference.endpoint (common .env.local habit)', () => {
    expect(mapToCreds({ ENDPOINT: 'ep-20260506174017-99t8f' }).inference?.endpoint)
      .toBe('ep-20260506174017-99t8f')
  })

  it('does not confuse TOS_ENDPOINT with inference.endpoint', () => {
    const out = mapToCreds({ TOS_ENDPOINT: 'tos-ap-southeast-1.bytepluses.com' })
    expect(out.inference).toBeUndefined()
  })

  it('treats empty-string values as not-filled', () => {
    expect(mapToCreds({ TOS_BUCKET: '' }).tos).toBeUndefined()
  })

  it('merges TOS_KEY_PREFIX into bucket when prefix is non-default', () => {
    expect(
      mapToCreds({ TOS_BUCKET: 'mybucket', TOS_KEY_PREFIX: 'team-a/' }).tos?.bucket,
    ).toBe('mybucket/team-a')
  })

  it('does not merge when TOS_KEY_PREFIX equals the system default', () => {
    expect(
      mapToCreds({ TOS_BUCKET: 'mybucket', TOS_KEY_PREFIX: 'seedance-2-0/' }).tos?.bucket,
    ).toBe('mybucket')
  })

  it('does not merge when TOS_KEY_PREFIX is present but bucket is missing', () => {
    expect(mapToCreds({ TOS_KEY_PREFIX: 'team-a/' }).tos).toBeUndefined()
  })
})

describe('mapToCreds — dual endpoint routing (Seedream/Seedance)', () => {
  it('routes SEEDREAM_5_0_ENDPOINT to inference.imageEndpoint', () => {
    const out = mapToCreds({ SEEDREAM_5_0_ENDPOINT: 'ep-20260202000000-bbbbb' })
    expect(out.inference?.imageEndpoint).toBe('ep-20260202000000-bbbbb')
    expect(out.inference?.endpoint).toBeUndefined()
  })

  it('routes SEEDANCE_2_0_ENDPOINT to inference.endpoint (video)', () => {
    const out = mapToCreds({ SEEDANCE_2_0_ENDPOINT: 'ep-20260101000000-aaaaa' })
    expect(out.inference?.endpoint).toBe('ep-20260101000000-aaaaa')
    expect(out.inference?.imageEndpoint).toBeUndefined()
  })

  it('imports both endpoints + shared API_KEY from one file', () => {
    const out = mapToCreds({
      API_KEY: '12345678-1234-1234-1234-123456789012',
      SEEDANCE_2_0_ENDPOINT: 'ep-20260101000000-aaaaa',
      SEEDREAM_5_0_ENDPOINT: 'ep-20260202000000-bbbbb',
    })
    expect(out.inference).toEqual({
      apiKey: '12345678-1234-1234-1234-123456789012',
      endpoint: 'ep-20260101000000-aaaaa',
      imageEndpoint: 'ep-20260202000000-bbbbb',
    })
  })

  it('legacy generic ENDPOINT still maps to video endpoint', () => {
    const out = mapToCreds({ ENDPOINT: 'ep-20260101000000-aaaaa' })
    expect(out.inference?.endpoint).toBe('ep-20260101000000-aaaaa')
    expect(out.inference?.imageEndpoint).toBeUndefined()
  })

  it('fallback: any *SEEDREAM*ENDPOINT* var fills imageEndpoint when aliases miss', () => {
    const out = mapToCreds({ MY_SEEDREAM_PRO_ENDPOINT: 'ep-20260303000000-ccccc' })
    expect(out.inference?.imageEndpoint).toBe('ep-20260303000000-ccccc')
  })

  it('fallback: any *SEEDANCE*ENDPOINT* var fills video endpoint when aliases miss', () => {
    const out = mapToCreds({ SEEDANCE_3_0_ENDPOINT: 'ep-20260404000000-ddddd' })
    expect(out.inference?.endpoint).toBe('ep-20260404000000-ddddd')
  })

  it('exact aliases win over fallback scan', () => {
    const out = mapToCreds({
      SEEDREAM_5_0_ENDPOINT: 'ep-20260202000000-bbbbb',
      OTHER_SEEDREAM_ENDPOINT: 'ep-20260909000000-zzzzz',
    })
    expect(out.inference?.imageEndpoint).toBe('ep-20260202000000-bbbbb')
  })
})
