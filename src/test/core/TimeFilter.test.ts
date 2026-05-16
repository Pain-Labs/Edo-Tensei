import { describe, expect, it } from 'vitest'
import { TimeFilter } from '../../core/TimeFilter'

const NOW = new Date('2026-05-16T13:30:00')

describe('TimeFilter', () => {
  it('returns undefined for empty or unsupported input', () => {
    expect(TimeFilter.parse()).toBeUndefined()
    expect(TimeFilter.parse('   ')).toBeUndefined()
    expect(TimeFilter.parse('not a date')).toBeUndefined()
  })

  it('parses today, yesterday, and this week labels', () => {
    expect(TimeFilter.parse('today', NOW)).toEqual({
      from: new Date('2026-05-16T00:00:00'),
      to: NOW,
      label: 'today',
    })

    expect(TimeFilter.parse('昨天', NOW)).toEqual({
      from: new Date('2026-05-15T00:00:00'),
      to: new Date('2026-05-15T23:59:59.999'),
      label: '昨天',
    })

    expect(TimeFilter.parse('本週', NOW)).toEqual({
      from: new Date('2026-05-10T00:00:00'),
      to: NOW,
      label: '本週',
    })
  })

  it('parses recent day windows, single dates, and explicit ranges', () => {
    expect(TimeFilter.parse('recent 3 days', NOW)).toEqual({
      from: new Date('2026-05-13T13:30:00'),
      to: NOW,
      label: 'recent 3 days',
    })

    expect(TimeFilter.parse('最近 2 天', NOW)).toEqual({
      from: new Date('2026-05-14T13:30:00'),
      to: NOW,
      label: '最近 2 天',
    })

    expect(TimeFilter.parse('2026/05/01')).toEqual({
      from: new Date('2026-05-01T00:00:00'),
      to: new Date('2026-05-01T23:59:59.999'),
      label: '2026/05/01',
    })

    expect(TimeFilter.parse('2026-05-01 到 2026-05-03')).toEqual({
      from: new Date('2026-05-01T00:00:00'),
      to: new Date('2026-05-03T23:59:59.999'),
      label: '2026-05-01 到 2026-05-03',
    })

    expect(TimeFilter.parse('2026-99-01 to 2026-05-03')).toBeUndefined()
  })

  it('checks whether ISO timestamps are inside parsed ranges', () => {
    const range = TimeFilter.parse('2026-05-01 to 2026-05-03')

    expect(TimeFilter.contains(undefined, 'bad-date')).toBe(true)
    expect(TimeFilter.contains(range, 'bad-date')).toBe(false)
    expect(TimeFilter.contains(range, '2026-04-30T23:59:59')).toBe(false)
    expect(TimeFilter.contains(range, '2026-05-02T12:00:00')).toBe(true)
    expect(TimeFilter.contains(range, '2026-05-04T00:00:00')).toBe(false)
  })
})
