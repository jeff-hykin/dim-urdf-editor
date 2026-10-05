// Every action the URDF Editor has, as an endpoint (http.ts). The open URDF lives here, so the page and Desktop's agent
// edit the same robot: the page draws GET api/model and re-reads it on each `stateChanged("model")` (frontend topic
// state/model, through Desktop's relay); view captures are asked for on the frontend topic `events`.
import { HttpError, publishEvent, type Route, stateChanged } from "./http.ts"
import { SAMPLE_URDF } from "./sample.ts"
import { MOVABLE, Urdf, type Vec3 } from "./urdf.ts"

export const DESCRIPTION =
    "URDF Editor: view and edit a robot's URDF frame tree (links, joints, origins, axes, limits), pose its joints, and save it"

export const SAVES_DIR = Deno.env.get("URDF_SAVES_DIR") ?? `${Deno.env.get("HOME") ?? "."}/.local/share/dim/urdf_saves`
const SAFE_FILE = /^[A-Za-z0-9._-]+\.urdf$/
const UNDO_LIMIT = 100

const editor = {
    urdf: new Urdf(SAMPLE_URDF),
    label: "spot (sample)",
    /** where it was opened from or last saved to */
    path: null as string | null,
    dirty: false,
    /** bumps when links/joints are added, removed or renamed (the page rebuilds its scene) */
    structure: 0,
    revision: 0,
    /** joint positions (radians, meters for prismatic): a pose, not part of the URDF */
    values: new Map<string, number>(),
    selected: null as string | null,
    arrowScale: 0.5,
    undo: [] as string[],
}

function changed({ structural = false, edit = false } = {}) {
    if (structural) {
        editor.structure++
    }
    if (edit) {
        editor.dirty = true
    }
    editor.revision++
    stateChanged("model")
}

/** Runs an edit to the URDF with an undo snapshot; a failed edit leaves the URDF as it was. */
function edit<T>(change: () => T, structural = false): T {
    const before = editor.urdf.toString()
    try {
        const result = change()
        editor.undo.push(before)
        editor.undo.splice(0, editor.undo.length - UNDO_LIMIT)
        changed({ structural, edit: true })
        return result
    } catch (error) {
        editor.urdf = new Urdf(before)
        throw new HttpError(400, error instanceof Error ? error.message : String(error))
    }
}

function open(text: string, label: string, path: string | null) {
    try {
        editor.urdf = new Urdf(text)
    } catch (error) {
        throw new HttpError(400, `${label} isn't a URDF this editor can read: ${(error as Error).message}`)
    }
    Object.assign(editor, { label, path, dirty: false, selected: null, undo: [] })
    editor.values.clear()
    changed({ structural: true })
    return state()
}

function state() {
    const joints = editor.urdf.joints()
    return {
        robot: editor.urdf.robotName,
        label: editor.label,
        path: editor.path,
        unsavedChanges: editor.dirty,
        root: editor.urdf.root(),
        links: editor.urdf.links().length,
        joints: joints.length,
        movableJoints: joints.filter((joint) => MOVABLE.has(joint.type)).map((joint) => joint.name),
        jointValues: Object.fromEntries(editor.values),
        selected: editor.selected,
        arrowScale: editor.arrowScale,
        canUndo: editor.undo.length > 0,
        structure: editor.structure,
        revision: editor.revision,
    }
}

function vec3(value: unknown, name: string): Vec3 | undefined {
    if (value === undefined) {
        return undefined
    }
    const list = typeof value === "string" ? value.split(/[\s,]+/).map(Number) : value
    if (!Array.isArray(list) || list.length !== 3 || !list.every((n) => typeof n === "number" && Number.isFinite(n))) {
        throw new HttpError(400, `${name} must be 3 numbers, e.g. [0, 0.1, 0]`)
    }
    return list as Vec3
}

function finite(value: unknown, name: string): number {
    const number = typeof value === "string" && value.trim() ? Number(value) : value
    if (typeof number !== "number" || !Number.isFinite(number)) {
        throw new HttpError(400, `${name} must be a number`)
    }
    return number
}

function setValue(jointName: string, raw: unknown) {
    const joint = editor.urdf.joints().find((joint) => joint.name === jointName)
    if (!joint) {
        throw new HttpError(404, `no joint named ${jointName}`)
    }
    if (!MOVABLE.has(joint.type)) {
        throw new HttpError(
            400,
            `${jointName} is a ${joint.type} joint; only revolute, continuous and prismatic joints move`,
        )
    }
    const value = finite(raw, `${jointName}'s value`)
    const limited = joint.type !== "continuous" && joint.lower !== null && joint.upper !== null
    if (limited && (value < joint.lower! - 1e-9 || value > joint.upper! + 1e-9)) {
        throw new HttpError(400, `${value} is outside ${jointName}'s limits [${joint.lower}, ${joint.upper}]`)
    }
    return () => editor.values.set(jointName, value)
}

function saveName(raw: unknown): string {
    let base = String(raw || editor.urdf.robotName).replace(/\.urdf$/i, "")
    base = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+/, "")
    return `${base || "robot"}.urdf`
}

async function savedFiles() {
    const files: { file: string; name: string; path: string; savedAt: string }[] = []
    try {
        for await (const entry of Deno.readDir(SAVES_DIR)) {
            if (entry.isFile && entry.name.endsWith(".urdf")) {
                const info = await Deno.stat(`${SAVES_DIR}/${entry.name}`).catch(() => null)
                files.push({
                    file: entry.name,
                    name: entry.name.replace(/\.urdf$/i, ""),
                    path: `${SAVES_DIR}/${entry.name}`,
                    savedAt: new Date(info?.mtime?.getTime() ?? 0).toISOString(),
                })
            }
        }
    } catch {
        // no saves yet
    }
    return files.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}

async function urdfFilesUnder(dir: string, depth = 6, found: string[] = []): Promise<string[]> {
    if (depth < 0 || found.length >= 500) {
        return found
    }
    let entries: Deno.DirEntry[]
    try {
        entries = await Array.fromAsync(Deno.readDir(dir))
    } catch (error) {
        if (depth === 6) {
            throw new HttpError(404, `can't read ${dir}: ${(error as Error).message}`)
        }
        return found
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") {
            continue
        }
        if (entry.isDirectory) {
            await urdfFilesUnder(`${dir}/${entry.name}`, depth - 1, found)
        } else if (entry.isFile && /\.urdf$/i.test(entry.name)) {
            found.push(`${dir}/${entry.name}`)
        }
    }
    return found
}

async function writeSave(name: unknown) {
    const file = saveName(name)
    await Deno.mkdir(SAVES_DIR, { recursive: true })
    await Deno.writeTextFile(`${SAVES_DIR}/${file}`, editor.urdf.toString())
    return { file, path: `${SAVES_DIR}/${file}` }
}

// GET api/view: the page renders its 3D view and answers (POST api/captures/{request}, main.ts).
const captures = new Map<string, (answer: unknown) => void>()
let captureCount = 0

export function answerCapture(request: string, answer: unknown): boolean {
    const resolve = captures.get(request)
    captures.delete(request)
    resolve?.(answer)
    return Boolean(resolve)
}

async function captureView(timeoutMs = 5000) {
    const request = `c${++captureCount}`
    const answer = new Promise<unknown>((resolve) => captures.set(request, resolve))
    publishEvent({ type: "capture", request })
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), timeoutMs)))
    const result = await Promise.race([answer, timeout])
    clearTimeout(timer)
    captures.delete(request)
    if (!result) {
        throw new HttpError(503, "no URDF Editor page is open to draw the view; open the app (open_app) and retry")
    }
    return { ...(result as object), robot: editor.urdf.robotName, selected: editor.selected }
}

export const routes: Route[] = [
    {
        method: "GET",
        path: "api/state",
        description:
            "The open URDF: robot name, file, unsaved changes, root, link/joint counts, movable joints, the posed joint values, the selected link",
        role: "context",
        handler: state,
    },
    {
        method: "GET",
        path: "api/model",
        description:
            "The whole frame tree: every link (with its primitive/mesh visuals) and every joint (type, parent, child, origin xyz/rpy in radians, axis, limits, current value)",
        handler: () => ({
            ...state(),
            linkList: editor.urdf.links(),
            jointList: editor.urdf.joints().map((joint) => ({ ...joint, value: editor.values.get(joint.name) ?? 0 })),
        }),
    },
    {
        method: "GET",
        path: "api/view",
        description:
            "What the user sees: the 3D view as an image (needs the app open in Desktop), plus the selected link",
        role: "view",
        handler: () => captureView(),
    },
    {
        method: "GET",
        path: "api/files",
        description:
            "URDF files: the saved ones (most recent first, open with `file`), or with `dir` every .urdf under that directory (open with `path`)",
        params: { dir: { type: "string", description: "absolute directory to search (optional)" } },
        handler: async ({ dir }) =>
            dir
                ? { dir, paths: await urdfFilesUnder(String(dir).replace(/\/+$/, "")) }
                : { dir: SAVES_DIR, files: await savedFiles() },
    },
    {
        method: "POST",
        path: "api/open",
        description: "Open a URDF: a saved one by `file` (from GET api/files), or any .urdf on disk by absolute `path`",
        params: {
            file: { type: "string", description: "a saved file's name, e.g. spot.urdf" },
            path: { type: "string", description: "absolute path to a .urdf / .xml file" },
        },
        handler: async ({ file, path }) => {
            if (file !== undefined) {
                if (typeof file !== "string" || !SAFE_FILE.test(file)) {
                    throw new HttpError(400, "file must be a saved file's name, like spot.urdf")
                }
                const full = `${SAVES_DIR}/${file}`
                const text = await Deno.readTextFile(full).catch(() => {
                    throw new HttpError(404, `no saved URDF named ${file}`)
                })
                return open(text, file.replace(/\.urdf$/i, ""), full)
            }
            if (typeof path !== "string" || !path.startsWith("/") || !/\.(urdf|xml)$/i.test(path)) {
                throw new HttpError(400, "give `file` (a saved name) or `path` (absolute, ending in .urdf or .xml)")
            }
            const text = await Deno.readTextFile(path).catch((error) => {
                throw new HttpError(404, `can't read ${path}: ${error.message}`)
            })
            return open(text, path.split("/").pop()!, path)
        },
    },
    {
        method: "POST",
        path: "api/open-sample",
        description: "Open the built-in sample robot (a Spot-like quadruped)",
        handler: () => open(SAMPLE_URDF, "spot (sample)", null),
    },
    {
        method: "POST",
        path: "api/load",
        description:
            "Open URDF text (what the page's Load button and drag-and-drop send); a copy goes into the saved files",
        params: {
            text: { type: "string", required: true, description: "the URDF XML" },
            name: { type: "string", description: "a name for it, e.g. the file name" },
        },
        handler: async ({ text, name }) => {
            if (typeof text !== "string" || !text.trim()) {
                throw new HttpError(400, "text must be the URDF's XML")
            }
            const label = String(name || "robot.urdf")
            const result = open(text, label, null)
            const saved = await writeSave(label)
            editor.path = saved.path
            return { ...result, path: saved.path }
        },
    },
    {
        method: "POST",
        path: "api/save",
        description:
            "Save the edited URDF: into the saved files (by robot name, or `name`), or to an absolute `path` ending in .urdf",
        params: {
            name: { type: "string", description: "saved-file name (default: the robot's name)" },
            path: { type: "string", description: "absolute path to write instead (must end in .urdf)" },
        },
        handler: async ({ name, path }) => {
            let saved
            if (path !== undefined) {
                if (typeof path !== "string" || !path.startsWith("/") || !/\.urdf$/i.test(path)) {
                    throw new HttpError(400, "path must be absolute and end in .urdf")
                }
                await Deno.writeTextFile(path, editor.urdf.toString()).catch((error) => {
                    throw new HttpError(400, `can't write ${path}: ${error.message}`)
                })
                saved = { file: path.split("/").pop()!, path }
            } else {
                saved = await writeSave(name)
            }
            editor.path = saved.path
            editor.dirty = false
            changed()
            return saved
        },
    },
    {
        method: "GET",
        path: "api/export",
        description: "The edited URDF's XML (the page's Download button)",
        handler: () =>
            new Response(editor.urdf.toString(), {
                headers: {
                    "content-type": "application/xml",
                    "content-disposition": `attachment; filename="${
                        saveName(editor.urdf.robotName).replace(/\.urdf$/, ".modified.urdf")
                    }"`,
                },
            }),
    },
    {
        method: "POST",
        path: "api/select",
        description:
            "Select a link (highlights it and its neighbors in the view, opens it in the panel); omit link to clear",
        params: { link: { type: "string", description: "link name" } },
        handler: ({ link }) => {
            if (link !== undefined && link !== null && link !== "" && !editor.urdf.hasLink(String(link))) {
                throw new HttpError(404, `no link named ${link}`)
            }
            editor.selected = link ? String(link) : null
            changed()
            return { selected: editor.selected }
        },
    },
    {
        method: "POST",
        path: "api/joints/{joint}/value",
        description:
            "Pose one joint: its position (radians for revolute/continuous, meters for prismatic), within its limits. Posing doesn't change the URDF",
        params: {
            joint: { type: "string", required: true, description: "joint name" },
            value: { type: "number", required: true },
        },
        handler: ({ joint, value }) => {
            setValue(String(joint), value)()
            changed()
            return { joint, value: editor.values.get(String(joint)) }
        },
    },
    {
        method: "POST",
        path: "api/joint-values",
        description: "Pose several joints at once: { values: { jointName: position, ... } } (all or none are applied)",
        params: { values: { type: "object", required: true, description: "joint name → position" } },
        handler: ({ values }) => {
            if (!values || typeof values !== "object" || Array.isArray(values)) {
                throw new HttpError(400, "values must be an object of joint name → position")
            }
            const apply = Object.entries(values).map(([name, value]) => setValue(name, value))
            apply.forEach((set) => set())
            changed()
            return { jointValues: Object.fromEntries(editor.values) }
        },
    },
    {
        method: "POST",
        path: "api/joint-values/reset",
        description: "Put every joint back at zero (the URDF's zero pose)",
        handler: () => {
            editor.values.clear()
            changed()
            return { jointValues: {} }
        },
    },
    {
        method: "POST",
        path: "api/joints/{joint}/origin",
        description:
            "Move a joint's origin (where its child frame sits in the parent frame): xyz in meters, rpy in radians",
        params: {
            joint: { type: "string", required: true, description: "joint name" },
            xyz: { type: "array", items: { type: "number" }, description: "[x, y, z] meters" },
            rpy: { type: "array", items: { type: "number" }, description: "[roll, pitch, yaw] radians" },
        },
        handler: ({ joint, xyz, rpy }) => {
            const change = { xyz: vec3(xyz, "xyz"), rpy: vec3(rpy, "rpy") }
            if (!change.xyz && !change.rpy) {
                throw new HttpError(400, "give xyz and/or rpy")
            }
            if (!editor.urdf.hasJoint(String(joint))) {
                throw new HttpError(404, `no joint named ${joint}`)
            }
            edit(() => editor.urdf.setOrigin(String(joint), change))
            return editor.urdf.joints().find((j) => j.name === joint)
        },
    },
    {
        method: "POST",
        path: "api/joints/{joint}/properties",
        description:
            "Edit a joint: rename it, change its type (fixed, revolute, continuous, prismatic, floating, planar), its axis, or its lower/upper limits (null removes one)",
        params: {
            joint: { type: "string", required: true, description: "joint name" },
            name: { type: "string", description: "new name" },
            type: { type: "string" },
            axis: { type: "array", items: { type: "number" }, description: "[x, y, z]" },
            lower: { type: "number" },
            upper: { type: "number" },
        },
        handler: ({ joint, name, type, axis, lower, upper }) => {
            const jointName = String(joint)
            if (!editor.urdf.hasJoint(jointName)) {
                throw new HttpError(404, `no joint named ${jointName}`)
            }
            const limit = (value: unknown, key: string) =>
                value === undefined || value === null ? value : finite(value, key)
            const props = {
                name: name === undefined ? undefined : String(name),
                type: type === undefined ? undefined : String(type),
                axis: vec3(axis, "axis"),
                lower: limit(lower, "lower") as number | null | undefined,
                upper: limit(upper, "upper") as number | null | undefined,
            }
            if (props.name !== undefined && !/^[\w.-]+$/.test(props.name)) {
                throw new HttpError(400, "a joint name may only have letters, digits, _ . -")
            }
            edit(
                () => editor.urdf.setJointProperties(jointName, props),
                props.name !== undefined || props.type !== undefined,
            )
            const finalName = props.name ?? jointName
            const value = editor.values.get(jointName)
            editor.values.delete(jointName)
            const updated = editor.urdf.joints().find((j) => j.name === finalName)!
            if (value !== undefined && MOVABLE.has(updated.type)) {
                editor.values.set(finalName, value)
            }
            return updated
        },
    },
    {
        method: "POST",
        path: "api/links/{link}/properties",
        description: "Edit a link: rename it (the joints that use it follow)",
        params: {
            link: { type: "string", required: true, description: "link name" },
            name: { type: "string", required: true, description: "new name" },
        },
        handler: ({ link, name }) => {
            if (!editor.urdf.hasLink(String(link))) {
                throw new HttpError(404, `no link named ${link}`)
            }
            edit(() => editor.urdf.renameLink(String(link), String(name)), true)
            if (editor.selected === link) {
                editor.selected = String(name)
            }
            return { link: name }
        },
    },
    {
        method: "POST",
        path: "api/links/{link}/children",
        description: "Add a child frame (a new link on a fixed joint) under a link; returns its name and selects it",
        params: {
            link: { type: "string", required: true, description: "parent link" },
            name: { type: "string", description: "new link's name (default frame_N)" },
            xyz: {
                type: "array",
                items: { type: "number" },
                description: "origin in the parent, meters (default 0 0 0)",
            },
        },
        handler: ({ link, name, xyz }) => {
            if (!editor.urdf.hasLink(String(link))) {
                throw new HttpError(404, `no link named ${link}`)
            }
            if (name !== undefined && !/^[\w.-]+$/.test(String(name))) {
                throw new HttpError(400, "a link name may only have letters, digits, _ . -")
            }
            const position = vec3(xyz, "xyz")
            const added = edit(
                () => editor.urdf.addChild(String(link), name ? String(name) : undefined, position),
                true,
            )
            editor.selected = added
            changed()
            return { link: added, parent: link }
        },
    },
    {
        method: "DELETE",
        path: "api/links/{link}",
        description: "Remove a link and its joint; its children move up to its parent (the root can't be removed)",
        params: { link: { type: "string", required: true, description: "link name" } },
        handler: ({ link }) => {
            if (!editor.urdf.hasLink(String(link))) {
                throw new HttpError(404, `no link named ${link}`)
            }
            const incoming = editor.urdf.joints().find((joint) => joint.child === link)
            edit(() => editor.urdf.removeLink(String(link)), true)
            if (incoming) {
                editor.values.delete(incoming.name)
            }
            if (editor.selected === link) {
                editor.selected = null
            }
            return { removed: link }
        },
    },
    {
        method: "POST",
        path: "api/undo",
        description: "Undo the last edit to the URDF (origins, properties, added/removed frames)",
        handler: () => {
            const previous = editor.undo.pop()
            if (previous === undefined) {
                throw new HttpError(409, "nothing to undo")
            }
            editor.urdf = new Urdf(previous)
            const joints = new Set(editor.urdf.joints().map((joint) => joint.name))
            for (const name of editor.values.keys()) {
                if (!joints.has(name)) {
                    editor.values.delete(name)
                }
            }
            if (editor.selected && !editor.urdf.hasLink(editor.selected)) {
                editor.selected = null
            }
            changed({ structural: true, edit: true })
            return state()
        },
    },
    {
        method: "POST",
        path: "api/arrow-scale",
        description: "Size of the axis arrows drawn at each frame (0.25 to 5; default 0.5)",
        params: { scale: { type: "number", required: true } },
        handler: ({ scale }) => {
            const value = finite(scale, "scale")
            if (value < 0.25 || value > 5) {
                throw new HttpError(400, "scale must be between 0.25 and 5")
            }
            editor.arrowScale = value
            changed()
            return { arrowScale: value }
        },
    },
]
