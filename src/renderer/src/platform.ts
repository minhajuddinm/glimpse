/** True in the macOS app. The renderer has no `process`, so the user agent is used. */
export const IS_MAC = navigator.userAgent.includes('Macintosh')

/** What the system calls the place the app's icon lives. */
export const TRAY_NAME = IS_MAC ? 'menu bar' : 'tray'

export const OS_NAME = IS_MAC ? 'macOS' : 'Windows'
