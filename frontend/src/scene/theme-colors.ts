// Resolve dim-app theme.css color tokens to sRGB for three.js / canvas, and re-run on Portal / Research changes.
let probe: HTMLSpanElement | null = null
let pixels: CanvasRenderingContext2D | null = null

/** "--axis-x" → "#rrggbb" (resolves var()/oklch()/color-mix() through the browser, then reads one painted pixel;
 * translucent tokens like the Portal's white hairlines are composited over --scene-bg, as they'd look on the page) */
export function cssColor(token: string): string {
    if (!probe || !pixels) {
        probe = document.createElement("span")
        probe.style.display = "none"
        document.body.appendChild(probe)
        const canvas = document.createElement("canvas")
        canvas.width = 1
        canvas.height = 1
        pixels = canvas.getContext("2d", { willReadFrequently: true })!
    }
    probe.style.color = "var(--scene-bg, var(--bg))"
    pixels.fillStyle = getComputedStyle(probe).color
    pixels.fillRect(0, 0, 1, 1)
    probe.style.color = `var(${token})`
    pixels.fillStyle = getComputedStyle(probe).color
    pixels.fillRect(0, 0, 1, 1)
    const [r, g, b] = pixels.getImageData(0, 0, 1, 1).data
    return "#" + [r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")
}

/** "#rrggbb" + alpha → "rgba(...)" for canvas fills */
export function withAlpha(hex: string, alpha: number): string {
    const value = parseInt(hex.slice(1), 16)
    return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`
}

/** Calls `callback` whenever dim-app theme.js switches Portal / Research; returns an unsubscribe. */
export function onThemeChange(callback: () => void): () => void {
    globalThis.addEventListener("dim-theme", callback)
    return () => globalThis.removeEventListener("dim-theme", callback)
}
