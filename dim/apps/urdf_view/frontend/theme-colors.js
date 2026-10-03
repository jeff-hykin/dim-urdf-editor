// theme-colors.js — resolve theme.css color tokens to sRGB for three.js / canvas, and re-run on light/dark changes.

let probe = null
let pixelContext = null

// "--axis-x" -> "#rrggbb" (resolves var()/oklch()/color-mix() through the browser, then reads one painted pixel)
export function cssColor(token) {
    if (!probe) {
        probe = document.createElement("span")
        probe.style.display = "none"
        document.body.appendChild(probe)
        pixelContext = document.createElement("canvas").getContext("2d", { willReadFrequently: true })
        pixelContext.canvas.width = 1
        pixelContext.canvas.height = 1
    }
    probe.style.color = `var(${token})`
    pixelContext.clearRect(0, 0, 1, 1)
    pixelContext.fillStyle = getComputedStyle(probe).color
    pixelContext.fillRect(0, 0, 1, 1)
    const [r, g, b] = pixelContext.getImageData(0, 0, 1, 1).data
    return "#" + [r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")
}

// "#rrggbb" + alpha -> "rgba(...)" for canvas fills
export function withAlpha(hex, alpha) {
    const value = parseInt(hex.slice(1), 16)
    return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`
}

// call `callback` whenever dim-theme.js flips light/dark; returns an unsubscribe function
export function onThemeChange(callback) {
    window.addEventListener("dim-theme", callback)
    return () => window.removeEventListener("dim-theme", callback)
}
