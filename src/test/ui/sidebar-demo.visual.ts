import { ActivityBar, VSBrowser } from 'vscode-extension-tester'
import { By, Key, WebElement } from 'selenium-webdriver'
import { expect } from 'chai'
import { UiRecording } from './recording'

const DEMO_IDE_LABEL = 'Claude'
const DEMO_SESSION_TEXT = 'checkout handoff'

async function rowTexts(): Promise<string[]> {
  const rows = await VSBrowser.instance.driver.findElements(By.css('.monaco-list-row'))
  const texts: string[] = []
  for (const row of rows) {
    try {
      const text = (await row.getText()).trim()
      if (text) {
        texts.push(text)
      }
    } catch {
      // Row may be stale during tree refresh.
    }
  }
  return texts
}

async function openEdoTenseiView(): Promise<void> {
  const driver = VSBrowser.instance.driver
  await driver.wait(async () => {
    try {
      const control = await new ActivityBar().getViewControl('Edo Tensei')
      if (!control) {
        await driver.sleep(300)
        return false
      }

      await control.openView()
      const pageText = await driver.findElement(By.css('body')).getText()
      return pageText.includes('Edo Tensei') || pageText.includes('Scan All IDEs')
    } catch {
      await driver.sleep(300)
      return false
    }
  }, 10_000, 'Could not open Edo Tensei from the Activity Bar')
}

async function findRowContaining(label: string): Promise<WebElement> {
  const driver = VSBrowser.instance.driver
  return driver.wait<WebElement>(async () => {
    const rows = await driver.findElements(By.css('.monaco-list-row'))
    for (const row of rows) {
      try {
        if ((await row.getText()).includes(label)) {
          return row
        }
      } catch {
        // Row may be stale during tree refresh.
      }
    }
    return false
  }, 15_000, `Could not find tree row containing "${label}"`)
}

async function findRowContainingOrNull(label: string): Promise<WebElement | null> {
  const rows = await VSBrowser.instance.driver.findElements(By.css('.monaco-list-row'))
  for (const row of rows) {
    try {
      if ((await row.getText()).includes(label)) {
        return row
      }
    } catch {
      // Row may be stale during tree refresh.
    }
  }
  return null
}

async function showClickRipple(element: WebElement): Promise<void> {
  await VSBrowser.instance.driver.executeScript(`
    const target = arguments[0];
    const rect = target.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const styleId = 'edo-tensei-ui-recording-ripple-style';

    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = \`
        @keyframes edoTenseiClickRipple {
          from {
            transform: scale(0.35);
            opacity: 0.95;
          }
          to {
            transform: scale(2.4);
            opacity: 0;
          }
        }
      \`;
      document.head.appendChild(style);
    }

    const ripple = document.createElement('div');
    ripple.style.position = 'fixed';
    ripple.style.left = (x - 18) + 'px';
    ripple.style.top = (y - 18) + 'px';
    ripple.style.width = '36px';
    ripple.style.height = '36px';
    ripple.style.border = '4px solid rgba(255, 196, 0, 1)';
    ripple.style.borderRadius = '999px';
    ripple.style.background = 'rgba(255, 196, 0, 0.2)';
    ripple.style.boxShadow = '0 0 0 7px rgba(255, 196, 0, 0.22), 0 0 22px rgba(255, 196, 0, 0.78)';
    ripple.style.zIndex = '1000000';
    ripple.style.pointerEvents = 'none';
    ripple.style.animation = 'edoTenseiClickRipple 520ms ease-out forwards';
    document.body.appendChild(ripple);
    setTimeout(() => ripple.remove(), 560);
  `, element)
}

async function clickWithRipple(element: WebElement, recording: UiRecording): Promise<void> {
  await showClickRipple(element)
  await recording.pause(500)
  await element.click()
}

async function clickWelcomeAction(label: string, recording: UiRecording): Promise<boolean> {
  const buttons = await VSBrowser.instance.driver.findElements(By.xpath(`//*[contains(normalize-space(.), "${label}")]`))
  for (const button of buttons) {
    try {
      if (await button.isDisplayed()) {
        await clickWithRipple(button, recording)
        return true
      }
    } catch {
      // Welcome action may re-render while being queried.
    }
  }
  return false
}

async function expandTreeRow(row: WebElement, recording: UiRecording): Promise<void> {
  try {
    const twistie = await row.findElement(By.css('.monaco-tl-twistie'))
    await clickWithRipple(twistie, recording)
    return
  } catch {
    await clickWithRipple(row, recording)
    await VSBrowser.instance.driver.actions().sendKeys(Key.ARROW_RIGHT).perform()
  }
}

async function clickCopyHandoffPrompt(row: WebElement, recording: UiRecording): Promise<void> {
  const driver = VSBrowser.instance.driver
  await row.click()
  await driver.actions().move({ origin: row }).perform()

  const copyAction = await driver.wait<WebElement>(async () => {
    const candidates = await driver.findElements(By.xpath(
      '//*[contains(@title, "Copy Handoff Prompt") or contains(@aria-label, "Copy Handoff Prompt")]'
    ))
    for (const candidate of candidates) {
      try {
        if (await candidate.isDisplayed()) {
          return candidate
        }
      } catch {
        // Inline action may re-render while hovering the row.
      }
    }
    return false
  }, 5_000, 'Copy Handoff Prompt inline action did not appear')

  await clickWithRipple(copyAction, recording)
}

describe('Edo Tensei sidebar visual demo', function () {
  this.timeout(90_000)

  const recording = UiRecording.productDemo('edo-tensei-product-demo')

  before(async function () {
    await VSBrowser.instance.waitForWorkbench()
    await openEdoTenseiView()
  })

  after(async function () {
    await recording.stop()
  })

  it('records the per-IDE on-demand scanning flow', async function () {
    recording.start()

    let claudeRow = await findRowContainingOrNull(DEMO_IDE_LABEL)
    if (!claudeRow) {
      await recording.step('Scan local AI sessions across tools and keep the handoff data on this machine.', 2_600)
      expect(await clickWelcomeAction('Scan All IDEs', recording)).to.be.true
      await recording.pause(1_500)
      claudeRow = await findRowContaining(DEMO_IDE_LABEL)
    }

    const initialLabels = await rowTexts()
    expect(claudeRow).to.not.equal(null)

    await recording.step(`Open ${DEMO_IDE_LABEL} to browse recovered sessions by project and time.`, 2_600)
    await expandTreeRow(claudeRow, recording)
    await recording.pause(1_500)

    const expanded = await VSBrowser.instance.driver.wait(async () => {
      const labels = await rowTexts()
      return labels.length > initialLabels.length || labels.some(label => /loading|scanning|session|load more/i.test(label))
    }, 30_000, `${DEMO_IDE_LABEL} did not expand into visible child rows`)

    const sessionRow = await findRowContaining(DEMO_SESSION_TEXT)
    await recording.step('Select a session to open its parsed Markdown transcript for review.', 2_800)
    await clickWithRipple(sessionRow, recording)
    await recording.pause(2_000)

    const reopenedSessionRow = await findRowContaining(DEMO_SESSION_TEXT)
    await recording.step('Copy a handoff prompt in one click, then continue in the next AI agent.', 2_800)
    await clickCopyHandoffPrompt(reopenedSessionRow, recording)
    await recording.pause(2_000)

    expect(expanded).to.be.true
  })
})
