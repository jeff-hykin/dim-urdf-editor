// URDF Editor page: the 3D frame view, the frame tree and the selected-frame panel. Every action is a backend endpoint
// (backend/routes.ts); the page draws GET api/model (useBackendState: re-read on each state/model event over zenoh), so an agent's edits show here.
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { call } from "./api.ts"
import { appEvents } from "./dim-app/events.js"
import { useBackendState } from "./dim-app/react.js"
import { Icon } from "./icons.tsx"
import { type Joint, JOINT_TYPES, type Model, MOVABLE, neighborsOf, type Tree, tree } from "./model.ts"
import { installKeyboardControls } from "./scene/controls.ts"
import { installEditor } from "./scene/editor.ts"
import { buildFrames, type Frames } from "./scene/frames.ts"
import { createViewer, type Viewer } from "./scene/viewer.ts"
import { ThemeToggle } from "./ThemeToggle.tsx"

const RAD_TO_DEG = 180 / Math.PI
const ARROW_STEP = 1.25
type SavedFile = { file: string; name: string }

/** A number input that shows the model's value until the user types, then sends each valid number. */
function NumberField(
    { value, digits, step, disabled, onCommit, wide }: {
        value: number | null
        digits: number
        step: number
        disabled?: boolean
        onCommit: (value: number) => void
        wide?: boolean
    },
) {
    const [draft, setDraft] = useState<string | null>(null)
    return (
        <input
            className={`numin dim-input dim-mono${wide ? " wide" : ""}`}
            type="number"
            step={step}
            disabled={disabled}
            value={draft ?? (value === null ? "" : value.toFixed(digits))}
            onChange={(event) => {
                setDraft(event.target.value)
                const number = parseFloat(event.target.value)
                if (Number.isFinite(number)) {
                    onCommit(number)
                }
            }}
            onBlur={() => setDraft(null)}
        />
    )
}

/** A text input sent on Enter or blur (renames). */
function NameField({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
    const [draft, setDraft] = useState<string | null>(null)
    const commit = () => {
        if (draft !== null && draft.trim() && draft !== value) {
            onCommit(draft.trim())
        }
        setDraft(null)
    }
    return (
        <input
            className="dim-input dim-mono numin wide"
            value={draft ?? value}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && (event.target as HTMLInputElement).blur()}
            onBlur={commit}
        />
    )
}

function JointPanel({ joint, act }: { joint: Joint; act: (method: string, path: string, body?: unknown) => void }) {
    const base = `api/joints/${encodeURIComponent(joint.name)}`
    const origin = (xyz: number[], rpy: number[]) => act("POST", `${base}/origin`, { xyz, rpy })
    const movable = MOVABLE.has(joint.type)
    const lower = joint.type === "continuous" || joint.lower === null ? -Math.PI : joint.lower
    const upper = joint.type === "continuous" || joint.upper === null ? Math.PI : joint.upper
    const rows = ["x", "y", "z"] as const
    return (
        <>
            <div className="colhead">
                <span></span>
                <span>pos (m)</span>
                <span>angle (°)</span>
            </div>
            {rows.map((axis, i) => (
                <div className="axisrow" key={axis}>
                    <span className={axis}>{axis}</span>
                    <NumberField
                        value={joint.xyz[i]}
                        digits={4}
                        step={0.01}
                        onCommit={(v) => origin(joint.xyz.map((old, j) => (j === i ? v : old)), joint.rpy)}
                    />
                    <NumberField
                        value={joint.rpy[i] * RAD_TO_DEG}
                        digits={2}
                        step={1}
                        onCommit={(v) => origin(joint.xyz, joint.rpy.map((old, j) => (j === i ? v / RAD_TO_DEG : old)))}
                    />
                </div>
            ))}
            <div className="section">
                <h2 className="dim-label">Joint</h2>
                <div className="field">
                    <span className="dim-label">name</span>
                    <NameField value={joint.name} onCommit={(name) => act("POST", `${base}/properties`, { name })} />
                </div>
                <div className="field">
                    <span className="dim-label">type</span>
                    <select
                        className="dim-select"
                        value={joint.type}
                        onChange={(event) => act("POST", `${base}/properties`, { type: event.target.value })}
                    >
                        {JOINT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                    </select>
                </div>
                {joint.type !== "fixed" && (
                    <div className="field">
                        <span className="dim-label">axis</span>
                        <div className="value-row">
                            {rows.map((axis, i) => (
                                <NumberField
                                    key={axis}
                                    value={joint.axis[i]}
                                    digits={2}
                                    step={0.1}
                                    onCommit={(v) =>
                                        act("POST", `${base}/properties`, {
                                            axis: joint.axis.map((old, j) => (j === i ? v : old)),
                                        })}
                                />
                            ))}
                        </div>
                    </div>
                )}
                {(joint.type === "revolute" || joint.type === "prismatic") && (
                    <div className="field">
                        <span className="dim-label">limits</span>
                        <div className="value-row">
                            <NumberField
                                value={joint.lower}
                                digits={3}
                                step={0.1}
                                onCommit={(v) => act("POST", `${base}/properties`, { lower: v })}
                            />
                            <NumberField
                                value={joint.upper}
                                digits={3}
                                step={0.1}
                                onCommit={(v) => act("POST", `${base}/properties`, { upper: v })}
                            />
                        </div>
                    </div>
                )}
                {movable && (
                    <div className="field">
                        <span className="dim-label">value</span>
                        <div className="value-row">
                            <input
                                className="dim-range"
                                type="range"
                                min={lower}
                                max={upper}
                                step={(upper - lower) / 200}
                                value={joint.value}
                                onChange={(event) =>
                                    act("POST", `${base}/value`, { value: Number(event.target.value) })}
                            />
                            <NumberField
                                value={joint.value}
                                digits={3}
                                step={0.05}
                                onCommit={(value) => act("POST", `${base}/value`, { value })}
                            />
                        </div>
                    </div>
                )}
            </div>
        </>
    )
}

export function App() {
    const [model, { refresh: refreshModel, error: modelError }] = useBackendState<Model>("api/model", {
        debounceMs: 16,
    })
    const [files, setFiles] = useState<SavedFile[]>([])
    const [error, setError] = useState<string | null>(null)
    const [status, setStatus] = useState("")
    const [overlapTip, setOverlapTip] = useState(false)
    const container = useRef<HTMLDivElement>(null)
    const viewer = useRef<Viewer | null>(null)
    const frames = useRef<Frames | null>(null)
    const builtStructure = useRef(-1)
    const statusTimer = useRef(0)

    const flash = (text: string) => {
        setStatus(text)
        clearTimeout(statusTimer.current)
        statusTimer.current = setTimeout(() => setStatus(""), 4000)
    }

    const refresh = useCallback(async () => {
        try {
            await refreshModel()
            setFiles((await call<{ files: SavedFile[] }>("GET", "api/files")).files)
        } catch (e) {
            setError((e as Error).message)
        }
    }, [refreshModel])
    useEffect(() => {
        if (modelError) {
            setError(modelError.message)
        }
    }, [modelError])

    /** Calls an endpoint; its state/model event redraws. Errors show in the toolbar. */
    const act = useCallback(async (method: string, path: string, body?: unknown) => {
        try {
            const result = await call(method, path, body)
            setError(null)
            return result
        } catch (e) {
            setError((e as Error).message)
            refresh() // put inputs back to what the backend has
            return null
        }
    }, [refresh])

    // the 3D view, made once
    useEffect(() => {
        const v = createViewer(container.current!)
        viewer.current = v
        v.onFrame(() => frames.current?.updateLabelScales(v.camera))
        const uninstallKeys = installKeyboardControls(v)
        const uninstallEditor = installEditor(v, () => frames.current, {
            onSelect: (link) => act("POST", "api/select", { link }),
            onMoveOrigin: (joint, xyz) => act("POST", `api/joints/${encodeURIComponent(joint)}/origin`, { xyz }),
            onUndo: () => act("POST", "api/undo"),
        })
        // overlapping frames: after a 500 ms hover, point at the tree
        let dwell: number | null = null
        let hide = 0
        const pointermove = (event: PointerEvent) => {
            if (frames.current?.overlapAtPointer(event.clientX, event.clientY)) {
                if (dwell === null) {
                    dwell = setTimeout(() => {
                        setOverlapTip(true)
                        clearTimeout(hide)
                        hide = setTimeout(() => setOverlapTip(false), 6000)
                    }, 500)
                }
            } else if (dwell !== null) {
                clearTimeout(dwell)
                dwell = null
            }
        }
        v.renderer.domElement.addEventListener("pointermove", pointermove)
        return () => {
            v.renderer.domElement.removeEventListener("pointermove", pointermove)
            uninstallEditor()
            uninstallKeys()
            frames.current?.dispose()
            frames.current = null
            builtStructure.current = -1
            v.dispose()
        }
    }, [act])

    // backend state, and the agent's changes as they happen
    useEffect(() => {
        refresh()
        return appEvents((event) => {
            if (event.type === "capture" && viewer.current) {
                const v = viewer.current
                const data = v.capture().replace(/^data:image\/png;base64,/, "")
                call("POST", `api/captures/${event.request}`, {
                    image: { mimeType: "image/png", data },
                    camera: {
                        position: v.camera.position.toArray(),
                        target: v.controls.target.toArray(),
                        fov: v.camera.fov,
                    },
                }).catch(() => {})
            }
        })
    }, [refresh])

    // draw the model: rebuild when links/joints changed, else just move frames
    useEffect(() => {
        const v = viewer.current
        if (!model || !v) {
            return
        }
        if (!frames.current || builtStructure.current !== model.structure) {
            frames.current?.dispose()
            frames.current = buildFrames(v, model)
            builtStructure.current = model.structure
        } else {
            frames.current.update(model)
        }
        frames.current.setSelected(model.selected)
        frames.current.setArrowScale(model.arrowScale)
    }, [model])

    // drop a URDF anywhere to open it
    useEffect(() => {
        const over = (event: DragEvent) => event.preventDefault()
        const drop = (event: DragEvent) => {
            event.preventDefault()
            const file = event.dataTransfer?.files[0]
            if (file) {
                openFile(file)
            }
        }
        addEventListener("dragover", over)
        addEventListener("drop", drop)
        return () => {
            removeEventListener("dragover", over)
            removeEventListener("drop", drop)
        }
    })

    const openFile = async (file: File) => act("POST", "api/load", { text: await file.text(), name: file.name })
    const t: Tree | null = useMemo(() => (model ? tree(model) : null), [model])
    const selected = model?.selected ?? null
    const joint = selected && t ? t.jointByChild.get(selected) : undefined
    const neighbors = selected && t ? neighborsOf(t, selected) : []

    const treeRows: { name: string; depth: number }[] = []
    if (model && t) {
        const walk = (name: string, depth: number) => {
            treeRows.push({ name, depth })
            for (const child of t.childrenOf.get(name) ?? []) {
                walk(child, depth + 1)
            }
        }
        walk(model.root, 0)
    }
    const removeLink = (name: string) => act("DELETE", `api/links/${encodeURIComponent(name)}`)
    const scaleArrows = (factor: number) =>
        model && act("POST", "api/arrow-scale", { scale: Math.min(5, Math.max(0.25, model.arrowScale * factor)) })

    return (
        <>
            <div className="toolbar">
                <span className="dim-title">URDF Editor</span>
                <label className="dim-btn sm" style={{ cursor: "pointer" }}>
                    Load URDF
                    <input
                        type="file"
                        accept=".urdf,.xml,application/xml"
                        hidden
                        onChange={(event) => event.target.files?.[0] && openFile(event.target.files[0])}
                    />
                </label>
                <select
                    id="recent"
                    className="dim-select"
                    title="recently saved URDFs"
                    value=""
                    onMouseDown={() => refresh()}
                    onChange={(event) =>
                        event.target.value === ":sample"
                            ? act("POST", "api/open-sample")
                            : act("POST", "api/open", { file: event.target.value })}
                >
                    <option value="">Recent…</option>
                    {files.map((file) => <option key={file.file} value={file.file}>{file.name}</option>)}
                    <option value=":sample">sample robot</option>
                </select>
                <span className="fname" title={model?.path ?? ""}>
                    {model ? `${model.label}${model.unsavedChanges ? " •" : ""}` : ""}
                </span>
                <span className="spacer"></span>
                {error && <div className="dim-alert danger" title={error}>{error}</div>}
                <span className="fname">{status}</span>
                <button
                    type="button"
                    className="dim-btn sm"
                    title="undo (ctrl/⌘+z)"
                    disabled={!model?.canUndo}
                    onClick={() => act("POST", "api/undo")}
                >
                    <Icon name="rotate-left" size={14} />
                </button>
                <button
                    type="button"
                    className="dim-btn sm"
                    onClick={async () => {
                        flash("saving…")
                        const saved = await act("POST", "api/save") as { file: string } | null
                        flash(saved ? `saved ${saved.file.replace(/\.urdf$/, "")}` : "")
                    }}
                >
                    Save
                </button>
                <a className="dim-btn sm" href="api/export" download>Download URDF</a>
                <ThemeToggle />
            </div>

            <div id="app" ref={container}></div>
            <div id="overlap-tip" className={`dim-panel${overlapTip ? " show" : ""}`}>
                For overlapping nodes, use the panel on the left to select the one you want
            </div>
            <div className="hud">
                {"wasd/qe: move · ijkl: look · drag: orbit\nclick frame: connections · drag a basis arrow: move axis · ctrl/⌘+z: undo"}
            </div>

            <div className="pane dim-panel glass" id="tree">
                <h2 className="dim-label">Frames ({model?.linkList.length ?? 0})</h2>
                <div>
                    {treeRows.map(({ name, depth }) => (
                        <div
                            key={name}
                            className={`treenode${name === selected ? " sel" : neighbors.includes(name) ? " nbr" : ""}`}
                            style={{ paddingLeft: depth * 14 + 6 }}
                            onClick={() => act("POST", "api/select", { link: name })}
                            onMouseEnter={() => frames.current?.setHovered(name)}
                            onMouseLeave={() => frames.current?.setHovered(null)}
                        >
                            <span className="nm">{name}</span>
                            {name !== model?.root && (
                                <span
                                    className="rm"
                                    title="remove frame"
                                    onClick={(event) => {
                                        event.stopPropagation()
                                        removeLink(name)
                                    }}
                                >
                                    <Icon name="close" size={13} />
                                </span>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            <div className="pane dim-panel glass" id="panel">
                <h2 className="dim-label">Selected Frame</h2>
                {selected
                    ? (
                        <NameField
                            value={selected}
                            onCommit={(name) =>
                                act("POST", `api/links/${encodeURIComponent(selected)}/properties`, { name })}
                        />
                    )
                    : <div id="selected">(none)</div>}
                <div id="neighbors">
                    {selected ? (neighbors.length ? "→ " + neighbors.join(", ") : "(no connections)") : ""}
                </div>
                <div className="panel-btns">
                    <button
                        type="button"
                        className="dim-btn sm"
                        disabled={!selected}
                        onClick={() => act("POST", `api/links/${encodeURIComponent(selected!)}/children`)}
                    >
                        <Icon name="plus" />child
                    </button>
                    <button
                        type="button"
                        className="dim-btn sm danger"
                        disabled={!selected || selected === model?.root}
                        onClick={() => removeLink(selected!)}
                    >
                        <Icon name="trash" />remove
                    </button>
                </div>
                {joint ? <JointPanel key={joint.name} joint={joint} act={act} /> : (
                    <>
                        <div className="colhead">
                            <span></span>
                            <span>pos (m)</span>
                            <span>angle (°)</span>
                        </div>
                        {(["x", "y", "z"] as const).map((axis) => (
                            <div className="axisrow" key={axis}>
                                <span className={axis}>{axis}</span>
                                <input className="numin dim-input dim-mono" type="number" disabled />
                                <input className="numin dim-input dim-mono" type="number" disabled />
                            </div>
                        ))}
                    </>
                )}
            </div>

            <div className="pane dim-panel glass" id="thickness">
                <button
                    type="button"
                    className="dim-btn icon"
                    title="smaller arrows"
                    onClick={() => scaleArrows(1 / ARROW_STEP)}
                >
                    <Icon name="minus" />
                </button>
                <span>arrows</span>
                <button
                    type="button"
                    className="dim-btn icon"
                    title="bigger arrows"
                    onClick={() => scaleArrows(ARROW_STEP)}
                >
                    <Icon name="plus" />
                </button>
            </div>
        </>
    )
}
