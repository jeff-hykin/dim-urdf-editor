// urdf_view — backend half (runs in the Deno dashboard process).
//
// The editor is otherwise self-contained in the browser, but the browser can't
// write to disk on its own. This backend gives it two things over the app-bus:
//
//   • save     — persist the edited URDF text to a saves directory on disk
//   • load     — read one saved URDF back
//   • list     — enumerate recently-saved URDFs (most-recent first)
//
// Saves live under ~/.local/share/dim/urdf_saves, one file per robot name, so
// re-saving the same robot updates it in place and floats it to the top of the
// recent list (sorted by modification time).

import { DimAppBackend } from "https://esm.sh/gh/jeff-hykin/dim-app@v0.3.0/backend.js"

const HOME = Deno.env.get("HOME") || "."
const SAVES_DIR = `${HOME}/.local/share/dim/urdf_saves`

// Only basenames matching this are accepted from the frontend, so a crafted
// "file" can never escape SAVES_DIR via "../" or an absolute path.
const SAFE_FILE = /^[A-Za-z0-9._-]+\.urdf$/

const dimApp = new DimAppBackend()

/** Turn a robot name into a safe "<name>.urdf" basename. */
function fileNameFor(rawName) {
    let base = String(rawName || "robot").replace(/\.urdf$/i, "")
    base = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+/, "")
    if (!base) {
        base = "robot"
    }
    return `${base}.urdf`
}

/** List saved URDFs, most-recently-modified first. */
async function listRecent() {
    const files = []
    try {
        for await (const entry of Deno.readDir(SAVES_DIR)) {
            if (!entry.isFile || !entry.name.endsWith(".urdf")) {
                continue
            }
            let savedAt = 0
            try {
                const info = await Deno.stat(`${SAVES_DIR}/${entry.name}`)
                savedAt = info.mtime ? info.mtime.getTime() : 0
            } catch {
                /* vanished between readDir and stat — skip */
            }
            files.push({ file: entry.name, name: entry.name.replace(/\.urdf$/i, ""), savedAt })
        }
    } catch {
        /* dir doesn't exist yet — no saves */
    }
    files.sort((a, b) => b.savedAt - a.savedAt)
    return files
}

function sendRecent() {
    listRecent().then((files) => dimApp.send("recent", { files }))
}

async function save(payload) {
    const text = payload && payload.text
    if (typeof text !== "string" || !text.trim()) {
        dimApp.send("saved", { ok: false, error: "nothing to save" })
        return
    }
    const file = fileNameFor(payload.name)
    try {
        await Deno.mkdir(SAVES_DIR, { recursive: true })
        await Deno.writeTextFile(`${SAVES_DIR}/${file}`, text)
    } catch (err) {
        dimApp.send("saved", { ok: false, error: err.message })
        return
    }
    dimApp.send("saved", { ok: true, file, name: file.replace(/\.urdf$/i, ""), path: `${SAVES_DIR}/${file}` })
    sendRecent()
}

async function load(payload) {
    const file = payload && payload.file
    if (typeof file !== "string" || !SAFE_FILE.test(file)) {
        dimApp.send("loaded", { ok: false, error: "invalid file name" })
        return
    }
    try {
        const text = await Deno.readTextFile(`${SAVES_DIR}/${file}`)
        dimApp.send("loaded", { ok: true, file, name: file.replace(/\.urdf$/i, ""), text })
    } catch (err) {
        dimApp.send("loaded", { ok: false, file, error: err.message })
    }
}

dimApp.onReceive((kind, payload) => {
    if (kind === "save") {
        save(payload)
    } else if (kind === "load") {
        load(payload)
    } else if (kind === "list" || kind === "hello") {
        // "hello" is the frontend announcing it (re)opened — refresh its list.
        sendRecent()
    }
})

// Push the current list once at startup so an already-open panel fills in.
sendRecent()
