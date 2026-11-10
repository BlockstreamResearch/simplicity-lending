import { env } from '@/constants/env'

declare global {
  interface Window {
    dataLayer?: unknown[]
  }
}

let initialized = false

// gtag.js runs a dataLayer entry as a command only if it is an `arguments`
// object; a plain array is silently treated as data. The annotation types the
// call sites, since the function itself must declare no parameters.
const gtag: (...args: unknown[]) => void = function () {
  // eslint-disable-next-line prefer-rest-params -- see above
  window.dataLayer?.push(arguments)
}

export function initAnalytics() {
  if (initialized || !env.VITE_GA_MEASUREMENT_ID) return
  initialized = true

  window.dataLayer = window.dataLayer ?? []
  gtag('js', new Date())
  gtag('config', env.VITE_GA_MEASUREMENT_ID, { send_page_view: false })

  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${env.VITE_GA_MEASUREMENT_ID}`
  document.head.appendChild(script)
}

export function trackPageView(path: string) {
  if (!env.VITE_GA_MEASUREMENT_ID) return
  gtag('event', 'page_view', {
    page_path: path,
    page_location: window.location.href,
  })
}
