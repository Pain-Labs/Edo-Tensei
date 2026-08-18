import { afterEach, describe, expect, it } from 'vitest'
import { I18n } from '../i18n'

function setMessages(messages: Record<string, string>): void {
  ;(I18n as unknown as { messages: Record<string, string> }).messages = messages
}

afterEach(() => {
  setMessages({})
})

describe('I18n.getMessage', () => {
  it('substitutes positional placeholders', () => {
    setMessages({ greeting: 'Hello {0}, you have {1} items' })
    expect(I18n.getMessage('greeting', 'Alice', '3')).toBe('Hello Alice, you have 3 items')
  })

  it('inserts a literal $ in a substitution without mangling the message', () => {
    setMessages({ 'gitignore.addFailed': 'Failed to update .gitignore: {0}' })
    expect(I18n.getMessage('gitignore.addFailed', 'ENOENT: $HOME not found')).toBe(
      'Failed to update .gitignore: ENOENT: $HOME not found'
    )
  })

  it('inserts a substitution containing $& without triggering String.replace special patterns', () => {
    setMessages({ label: '{0}' })
    expect(I18n.getMessage('label', 'price: $& total')).toBe('price: $& total')
  })

  it('falls back to the key when no message is loaded', () => {
    setMessages({})
    expect(I18n.getMessage('missing.key')).toBe('missing.key')
  })
})
