import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CredentialForm } from '../components/credentials/CredentialForm'
import { CREDENTIALS } from '../components/credentials/schema'
import { useAuthStore } from '../stores/authStore'
import { I18nProvider } from '../i18n/I18nProvider'
import { messages } from '../i18n/locales'

function renderForm(credKey: Parameters<typeof CredentialForm>[0]['credKey'], autoFocus = false) {
  return render(
    <I18nProvider initialLocale="zh-CN">
      <CredentialForm credKey={credKey} autoFocus={autoFocus} />
    </I18nProvider>,
  )
}

describe('CredentialForm', () => {
  beforeEach(() => {
    sessionStorage.clear()
    useAuthStore.setState({
      apiKey: '', endpoint: '',
      assetCreds: { accessKeyId: '', accessKeySecret: '', projectName: '' },
      tosCreds: {
        accessKeyId: '', accessKeySecret: '',
        region: 'ap-southeast-1',
        bucket: '',
      },
      verifyState: {
        inference: { status: 'pend', message: '尚未驗證' },
        asset: { status: 'pend', message: '尚未驗證' },
        tos: { status: 'pend', message: '尚未驗證' },
      },
    })
  })

  it('renders one input per field in the schema (inference)', () => {
    renderForm('inference')
    expect(screen.getByLabelText('API Key')).toBeInTheDocument()
    expect(screen.getByLabelText('视频生成接入点')).toBeInTheDocument()
    expect(screen.getByLabelText('图片生成接入点')).toBeInTheDocument()
  })

  it('renders secret fields with type=password', () => {
    renderForm('inference')
    const apiKey = screen.getByLabelText('API Key') as HTMLInputElement
    const endpoint = screen.getByLabelText('视频生成接入点') as HTMLInputElement
    expect(apiKey.type).toBe('password')
    expect(endpoint.type).toBe('text')
  })

  it('typing into an input updates the store via setField', () => {
    renderForm('asset')
    fireEvent.change(screen.getByLabelText('Project Name'), {
      target: { value: 'my-team' },
    })
    expect(useAuthStore.getState().assetCreds.projectName).toBe('my-team')
  })

  it('shows the error banner when verifyState[credKey].status === warn', () => {
    useAuthStore.setState({
      verifyState: {
        ...useAuthStore.getState().verifyState,
        tos: { status: 'warn', message: 'bucket not found' },
      },
    })
    renderForm('tos')
    expect(screen.getByText('bucket not found')).toBeInTheDocument()
  })

  it('does NOT show the error banner when status is pend', () => {
    renderForm('inference')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does NOT show the error banner when status is ok', () => {
    useAuthStore.setState({
      verifyState: {
        ...useAuthStore.getState().verifyState,
        inference: { status: 'ok', message: '格式檢查通過' },
      },
    })
    renderForm('inference')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('respects autoFocus prop on the first field', () => {
    renderForm('inference', true)
    expect(screen.getByLabelText('API Key')).toHaveFocus()
  })

  it('shows a toggle button next to each secret field', () => {
    renderForm('tos')
    // tos has 2 secret fields (accessKeyId, accessKeySecret) and 2 non-secret
    // (region as select, bucket as text). Two toggle buttons expected.
    const toggles = screen.getAllByRole('button', { name: /显示|隐藏/ })
    expect(toggles).toHaveLength(2)
  })

  it('clicking the toggle reveals the secret value (type=text)', () => {
    renderForm('inference')
    const apiKey = screen.getByLabelText('API Key') as HTMLInputElement
    expect(apiKey.type).toBe('password')
    const toggle = screen.getByRole('button', { name: /显示/ })
    fireEvent.click(toggle)
    expect(apiKey.type).toBe('text')
  })

  it('clicking the toggle a second time hides the secret again', () => {
    renderForm('inference')
    const apiKey = screen.getByLabelText('API Key') as HTMLInputElement
    const toggle = screen.getByRole('button', { name: /显示/ })
    fireEvent.click(toggle) // reveal
    expect(apiKey.type).toBe('text')
    fireEvent.click(screen.getByRole('button', { name: /隐藏/ })) // hide again
    expect(apiKey.type).toBe('password')
  })

  it('toggling one secret field does NOT affect another', () => {
    renderForm('tos')
    const ak = screen.getByLabelText('Access Key ID') as HTMLInputElement
    const sk = screen.getByLabelText('Secret Access Key') as HTMLInputElement
    expect(ak.type).toBe('password')
    expect(sk.type).toBe('password')

    // Reveal ak only — find the toggle adjacent to ak via its accessible
    // name pattern. Since two toggles are siblings of identical name pattern,
    // pick the FIRST one (which corresponds to the FIRST secret field).
    const toggles = screen.getAllByRole('button', { name: /显示/ })
    fireEvent.click(toggles[0])

    expect(ak.type).toBe('text')
    expect(sk.type).toBe('password') // unchanged
  })

  it('inference fields show schema-driven placeholders (ark- and ep- prefixes)', () => {
    renderForm('inference')
    const apiKey = screen.getByLabelText('API Key') as HTMLInputElement
    const endpoint = screen.getByLabelText('视频生成接入点') as HTMLInputElement
    expect(apiKey.placeholder).toMatch(/^ark-/)
    expect(endpoint.placeholder).toMatch(/^ep-/)
  })

  it('fields without a schema placeholder render no placeholder attribute', () => {
    renderForm('asset')
    const ak = screen.getByLabelText('Access Key ID') as HTMLInputElement
    expect(ak.placeholder).toBe('')
  })
})

describe('CredentialForm — tos region select', () => {
  it('renders a native select with the canonical TOS regions', () => {
    renderForm('tos')
    const region = screen.getByLabelText('区域') as HTMLSelectElement
    expect(region.tagName).toBe('SELECT')
    const optionValues = Array.from(region.options).map((o) => o.value)
    expect(optionValues).toContain('ap-southeast-1')
    expect(optionValues).toContain('ap-southeast-3')
    expect(optionValues).not.toContain('us-east-1')
    // 6 regions + possibly the disabled "請選擇…" placeholder when value is ''
    expect(optionValues.length).toBeGreaterThanOrEqual(6)
  })

  it('selecting a different region updates the store', () => {
    useAuthStore.setState({
      tosCreds: {
        accessKeyId: '',
        accessKeySecret: '',
        region: 'ap-southeast-1',
        bucket: '',
      },
    })
    renderForm('tos')
    const region = screen.getByLabelText('区域') as HTMLSelectElement
    fireEvent.change(region, { target: { value: 'cn-beijing' } })
    expect(useAuthStore.getState().tosCreds.region).toBe('cn-beijing')
  })

  it('does NOT render an Endpoint field for TOS', () => {
    renderForm('tos')
    expect(screen.queryByLabelText('Endpoint')).toBeNull()
  })

  it('TOS bucket field renders a per-field hint covering both syntaxes', () => {
    renderForm('tos')
    // Hint mentions the default seedance-2-0/ behavior + the bucket/prefix override
    expect(screen.getByText(/seedance-2-0\//)).toBeInTheDocument()
    expect(screen.getByText(/mybucket\/team-a/)).toBeInTheDocument()
  })
})

/**
 * Regression guard for a bug that shipped twice: the value selector used to
 * hand-list the inference field keys, so a field added to schema.ts but not to
 * that list rendered as a permanently-empty controlled input — every keystroke
 * was overwritten on the next render, i.e. "the field won't let me type".
 * `textEndpoint` shipped broken this way, and `videoEndpoint25` inherited it.
 *
 * Driven off CREDENTIALS so any future field is covered automatically. It also
 * guards the other half of the round-trip (setField's per-key dispatch): if the
 * store never receives the value, the rendered value stays empty too.
 */
describe('CredentialForm — 每個 schema 欄位都真的能輸入', () => {
  const typableFields = CREDENTIALS.flatMap((def) =>
    def.fields
      .filter((f) => !('kind' in f && f.kind === 'select'))
      .map((f) => ({ credKey: def.key, label: messages['zh-CN'][f.labelKey] })),
  )

  it.each(typableFields)('$credKey / $label 打進去的字留得住', ({ credKey, label }) => {
    renderForm(credKey)
    const input = screen.getByLabelText(label) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'ep-20260101000000-abcde' } })
    expect(input.value).toBe('ep-20260101000000-abcde')
  })
})
