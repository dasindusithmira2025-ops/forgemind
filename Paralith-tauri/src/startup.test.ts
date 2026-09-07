import { afterEach, expect, it } from 'vitest'
import indexHtml from '../index.html?raw'

afterEach(() => {
  document.head.querySelector('[data-startup-test]')?.remove()
  document.body.innerHTML = ''
  document.documentElement.style.removeProperty('--bg')
})

it('paints a readable launch status before application modules or styles load', () => {
  const page = new DOMParser().parseFromString(indexHtml, 'text/html')
  const style = page.querySelector('style')!.cloneNode(true) as HTMLStyleElement
  style.dataset.startupTest = ''
  document.head.append(style)
  document.body.append(page.querySelector('#root')!.cloneNode(true))
  expect(document.querySelector('[role="status"]')?.textContent).toBe('Starting PARALITH…')
  expect(getComputedStyle(document.body).margin).toBe('0px')
  expect(getComputedStyle(document.querySelector('#boot-status')!).display).toBe('grid')
  expect(style.textContent).toContain('var(--bg, #0b0f15)')
})
