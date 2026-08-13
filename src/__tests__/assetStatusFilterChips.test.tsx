import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AssetStatusFilterChips, {
  type StatusFilter,
} from '../components/assets/AssetStatusFilterChips'

describe('AssetStatusFilterChips (status <select> dropdown)', () => {
  it('renders a select labelled 狀態篩選 with 全部/Active/Processing/Failed options', () => {
    render(<AssetStatusFilterChips value="all" onChange={() => {}} />)
    const select = screen.getByRole('combobox', { name: '狀態篩選' })
    const options = within(select).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual([
      '全部',
      'Active',
      'Processing',
      'Failed',
    ])
  })

  it('reflects the current value', () => {
    render(<AssetStatusFilterChips value="Failed" onChange={() => {}} />)
    const select = screen.getByRole('combobox', {
      name: '狀態篩選',
    }) as HTMLSelectElement
    expect(select.value).toBe('Failed')
  })

  it('calls onChange with the picked status', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<AssetStatusFilterChips value="all" onChange={onChange} />)
    await user.selectOptions(
      screen.getByRole('combobox', { name: '狀態篩選' }),
      'Processing',
    )
    expect(onChange).toHaveBeenCalledWith('Processing')
  })
})

// type guard so the import is exercised
const _check: StatusFilter = 'all'
void _check
