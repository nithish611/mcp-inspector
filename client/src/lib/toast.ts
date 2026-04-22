let container: HTMLDivElement | null = null

function getContainer() {
  if (!container) {
    container = document.createElement('div')
    container.id = 'toast-container'
    container.style.cssText =
      'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none;'
    document.body.appendChild(container)
  }
  return container
}

export function toast(message: string, duration = 2000) {
  const el = document.createElement('div')
  el.textContent = message
  el.style.cssText =
    'padding:8px 16px;border-radius:8px;font-size:13px;font-weight:500;color:#fff;background:#18181b;box-shadow:0 4px 12px rgba(0,0,0,.15);opacity:0;transition:opacity .15s ease,transform .15s ease;transform:translateY(8px);pointer-events:auto;'

  const c = getContainer()
  c.appendChild(el)

  requestAnimationFrame(() => {
    el.style.opacity = '1'
    el.style.transform = 'translateY(0)'
  })

  setTimeout(() => {
    el.style.opacity = '0'
    el.style.transform = 'translateY(8px)'
    el.addEventListener('transitionend', () => el.remove(), { once: true })
  }, duration)
}
