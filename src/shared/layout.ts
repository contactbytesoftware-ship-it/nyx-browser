/**
 * Layout constants shared across the process boundary.
 *
 * The main process positions each tab's `WebContentsView` below the chrome, and
 * the chrome renderer sizes `.browser-chrome` to match. If these two ever
 * disagree the tab view and the chrome stop lining up, so the number lives here
 * once and both sides read it.
 */

/** Height in CSS pixels of the browser chrome (tab strip + address bar). */
export const CHROME_HEIGHT = 88
