// URDF Editor page: the 3D frame view, the frame tree and the selected-frame panel, all dimos-react. Every action is a
// backend endpoint (backend/routes.ts); the page draws GET api/model (useBackendState: re-read on each state/model
// event over zenoh), so an agent's edits show here.
import {
    Alert,
    AppShell,
    Button,
    Column,
    EmptyState,
    Field,
    Heading,
    Hud,
    IconButton,
    KeyHints,
    Label,
    NumberInput,
    Panel,
    Row,
    Select,
    Slider,
    Text,
    TextInput,
    toast,
    Toolbar,
    TopBar,
    Tree,
    useBackendEvents,
    useBackendState,
} from "dimos-react"
import { KeyboardFly, Scene3D, type Viewer } from "dimos-react/three"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { call } from "./api.ts"
import { openApp } from "./dim-app/source/desktop.js"
import { type Joint, JOINT_TYPES, type Model, MOVABLE, neighborsOf, type Tree as LinkTree, tree } from "./model.ts"
import { installEditor } from "./scene/editor.ts"
import { buildFrames, type Frames } from "./scene/frames.ts"

const RAD_TO_DEG = 180 / Math.PI
const ARROW_STEP = 1.25
const AXES = ["x", "y", "z"] as const
const SAMPLE_HINT_KEY = "dim-urdf-editor.sample-hint-closed"
type SavedFile = { file: string; name: string }
type Act = (method: string, path: string, body?: unknown) => Promise<unknown>

/** Opens the browser's file chooser; resolves to the chosen file (null when cancelled). */
function chooseFile(accept: string): Promise<File | null> {
    return new Promise((resolve) => {
        const picker = document.createElement("input")
        picker.type = "file"
        picker.accept = accept
        picker.addEventListener("change", () => resolve(picker.files?.[0] ?? null))
        picker.addEventListener("cancel", () => resolve(null))
        picker.click()
    })
}

/** A text box sent on Enter or blur (renames). */
function NameField(
    { value, onCommit }: { value: string; onCommit: (value: string) => void },
) {
    const [draft, setDraft] = useState<string | null>(null)
    const commit = () => {
        if (draft !== null && draft.trim() && draft !== value) {
            onCommit(draft.trim())
        }
        setDraft(null)
    }
    return (
        <TextInput
            mono
            size="sm"
            value={draft ?? value}
            onChange={setDraft}
            onEnter={() => (document.activeElement as HTMLElement | null)?.blur()}
            onBlur={commit}
        />
    )
}

/** The x / y / z rows: position (m) and angle (°) of the selected frame's joint origin. */
function OriginRows({ joint, act }: { joint?: Joint; act: Act }) {
    const origin = (xyz: number[], rpy: number[]) =>
        joint &&
        act("POST", `api/joints/${encodeURIComponent(joint.name)}/origin`, {
            xyz,
            rpy,
        })
    return (
        <Column gap={4}>
            <Row gap={6}>
                <Label style={{ width: 14 }} />
                <Label style={{ flex: 1 }}>pos (m)</Label>
                <Label style={{ flex: 1 }}>angle (°)</Label>
            </Row>
            {AXES.map((axis, i) => (
                <Row gap={6} key={axis}>
                    <Text mono style={{ width: 14, color: `var(--axis-${axis})` }}>
                        {axis}
                    </Text>
                    <NumberInput
                        size="sm"
                        precision={4}
                        step={0.01}
                        disabled={!joint}
                        value={joint ? joint.xyz[i] : null}
                        onChange={(v: number) =>
                            joint &&
                            origin(joint.xyz.map((old, j) => (j === i ? v : old)), joint.rpy)}
                    />
                    <NumberInput
                        size="sm"
                        precision={2}
                        step={1}
                        disabled={!joint}
                        value={joint ? joint.rpy[i] * RAD_TO_DEG : null}
                        onChange={(v: number) =>
                            joint &&
                            origin(
                                joint.xyz,
                                joint.rpy.map((old, j) => (j === i ? v / RAD_TO_DEG : old)),
                            )}
                    />
                </Row>
            ))}
        </Column>
    )
}

function JointFields({ joint, act }: { joint: Joint; act: Act }) {
    const base = `api/joints/${encodeURIComponent(joint.name)}`
    const properties = (body: unknown) => act("POST", `${base}/properties`, body)
    const value = (v: number) => act("POST", `${base}/value`, { value: v })
    const lower = joint.type === "continuous" || joint.lower === null ? -Math.PI : joint.lower
    const upper = joint.type === "continuous" || joint.upper === null ? Math.PI : joint.upper
    return (
        <Column gap={8}>
            <Heading level={3}>Joint</Heading>
            <Field label="name" inline>
                <NameField
                    value={joint.name}
                    onCommit={(name) => properties({ name })}
                />
            </Field>
            <Field label="type" inline>
                <Select
                    size="sm"
                    value={joint.type}
                    options={JOINT_TYPES}
                    onChange={(type: string) => properties({ type })}
                />
            </Field>
            {joint.type !== "fixed" && (
                <Field label="axis" inline>
                    <Row gap={4}>
                        {AXES.map((axis, i) => (
                            <NumberInput
                                key={axis}
                                size="sm"
                                precision={2}
                                step={0.1}
                                value={joint.axis[i]}
                                onChange={(v: number) =>
                                    properties({
                                        axis: joint.axis.map((old, j) => (j === i ? v : old)),
                                    })}
                            />
                        ))}
                    </Row>
                </Field>
            )}
            {(joint.type === "revolute" || joint.type === "prismatic") && (
                <Field label="limits" inline>
                    <Row gap={4}>
                        <NumberInput
                            size="sm"
                            precision={3}
                            step={0.1}
                            value={joint.lower}
                            onChange={(v: number) => properties({ lower: v })}
                        />
                        <NumberInput
                            size="sm"
                            precision={3}
                            step={0.1}
                            value={joint.upper}
                            onChange={(v: number) => properties({ upper: v })}
                        />
                    </Row>
                </Field>
            )}
            {MOVABLE.has(joint.type) && (
                <Field label="value" inline>
                    <Row gap={6}>
                        <Slider
                            min={lower}
                            max={upper}
                            step={(upper - lower) / 200}
                            value={joint.value}
                            showValue={false}
                            onChange={value}
                            style={{ flex: 1 }}
                        />
                        <NumberInput
                            size="sm"
                            precision={3}
                            step={0.05}
                            value={joint.value}
                            onChange={value}
                        />
                    </Row>
                </Field>
            )}
        </Column>
    )
}

export function App() {
    const [model, { refresh: refreshModel, error: modelError }] = useBackendState(
        "model",
        {
            url: "api/model",
            debounceMs: 16,
        },
    ) as [
        Model | undefined,
        { refresh: () => Promise<void>; error: Error | null },
    ]
    const [files, setFiles] = useState<SavedFile[]>([])
    const [overlapTip, setOverlapTip] = useState(false)
    const [collapsed, setCollapsed] = useState<string[]>([])
    const [sampleHintClosed, setSampleHintClosed] = useState(() => {
        try {
            return localStorage.getItem(SAMPLE_HINT_KEY) === "1"
        } catch {
            return false
        }
    })
    const [viewer, setViewer] = useState<Viewer | null>(null)
    const frames = useRef<Frames | null>(null)
    const builtStructure = useRef(-1)

    const refresh = useCallback(async () => {
        try {
            await refreshModel()
            setFiles((await call<{ files: SavedFile[] }>("GET", "api/files")).files)
        } catch (e) {
            toast.error((e as Error).message, { id: "urdf-error" })
        }
    }, [refreshModel])
    useEffect(() => {
        refresh()
    }, [refresh])

    /** Calls an endpoint; its state/model event redraws. Errors show as a toast. */
    const act = useCallback<Act>(async (method, path, body) => {
        try {
            return await call(method, path, body)
        } catch (e) {
            toast.error((e as Error).message, { id: "urdf-error" })
            refresh() // put inputs back to what the backend has
            return null
        }
    }, [refresh])

    // picking, axis drags and the overlap tip on the 3D view
    useEffect(() => {
        if (!viewer) {
            return
        }
        const off = viewer.onFrame(() => frames.current?.updateLabelScales(viewer.camera))
        const uninstallEditor = installEditor(viewer, () => frames.current, {
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
        const canvas = viewer.renderer.domElement
        canvas.addEventListener("pointermove", pointermove)
        return () => {
            canvas.removeEventListener("pointermove", pointermove)
            uninstallEditor()
            off()
            frames.current?.dispose()
            frames.current = null
            builtStructure.current = -1
        }
    }, [viewer, act])

    // GET api/view: the backend asks the page for a capture of the 3D view
    useBackendEvents((event: { type?: string; request?: string }) => {
        if (event.type !== "capture" || !viewer) {
            return
        }
        const data = viewer.capture().replace(/^data:image\/png;base64,/, "")
        call("POST", `api/captures/${event.request}`, {
            image: { mimeType: "image/png", data },
            camera: {
                position: viewer.camera.position.toArray(),
                target: viewer.controls.target.toArray(),
                fov: viewer.camera.fov,
            },
        }).catch(() => {})
    })

    // draw the model: rebuild when links/joints changed, else just move frames
    useEffect(() => {
        if (!model || !viewer) {
            return
        }
        if (!frames.current || builtStructure.current !== model.structure) {
            frames.current?.dispose()
            frames.current = buildFrames(viewer, model)
            builtStructure.current = model.structure
        } else {
            frames.current.update(model)
        }
        frames.current.setSelected(model.selected)
        frames.current.setArrowScale(model.arrowScale)
    }, [model, viewer])

    const openFile = async (file: File) => act("POST", "api/load", { text: await file.text(), name: file.name })

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

    const t: LinkTree | null = useMemo(() => (model ? tree(model) : null), [
        model,
    ])
    const selected = model?.selected ?? null
    const joint = selected && t ? t.jointByChild.get(selected) : undefined
    const neighbors = selected && t ? neighborsOf(t, selected) : []
    const removeLink = (name: string) => act("DELETE", `api/links/${encodeURIComponent(name)}`)
    const scaleArrows = (factor: number) =>
        model &&
        act("POST", "api/arrow-scale", {
            scale: Math.min(5, Math.max(0.25, model.arrowScale * factor)),
        })

    type Node = { id: string; children: Node[] }
    const nodes: Node[] = useMemo(() => {
        if (!model || !t) {
            return []
        }
        const node = (name: string): Node => ({
            id: name,
            children: (t.childrenOf.get(name) ?? []).map(node),
        })
        return [node(model.root)]
    }, [model, t])
    const expanded = useMemo(() => {
        const ids: string[] = []
        const walk = (list: Node[]) =>
            list.forEach((node) => {
                if (node.children.length && !collapsed.includes(node.id)) {
                    ids.push(node.id)
                }
                walk(node.children)
            })
        walk(nodes)
        return ids
    }, [nodes, collapsed])
    const allParents = useMemo(() => {
        const ids: string[] = []
        const walk = (list: Node[]) =>
            list.forEach((
                node,
            ) => (node.children.length && ids.push(node.id), walk(node.children)))
        walk(nodes)
        return ids
    }, [nodes])

    const save = async () => {
        const saved = await act("POST", "api/save") as { file: string } | null
        if (saved) {
            toast.ok(`saved ${saved.file.replace(/\.urdf$/, "")}`)
        }
    }

    const topBar = (
        <TopBar
            title={globalThis.parent === globalThis ? "URDF Editor" : undefined}
            left={
                <Row gap={8}>
                    <Button
                        size="sm"
                        icon="upload"
                        onClick={async () => {
                            const file = await chooseFile(".urdf,.xml,application/xml")
                            if (file) {
                                openFile(file)
                            }
                        }}
                    >
                        Load URDF
                    </Button>
                    <Select
                        size="sm"
                        value={null}
                        placeholder="Recent…"
                        title="recently saved URDFs"
                        onMouseDown={() => refresh()}
                        options={[...files.map((file) => [file.file, file.name]), [
                            ":sample",
                            "sample robot",
                        ]]}
                        onChange={(file: string) =>
                            file === ":sample" ? act("POST", "api/open-sample") : act("POST", "api/open", { file })}
                    />
                    <Text
                        mono
                        small
                        muted
                        title={model?.path ?? ""}
                        style={{ whiteSpace: "nowrap" }}
                    >
                        {model ? `${model.label}${model.unsavedChanges ? " •" : ""}` : ""}
                    </Text>
                </Row>
            }
            right={
                <Row gap={6}>
                    <IconButton
                        icon="rotate-left"
                        size="sm"
                        variant="default"
                        label="undo (ctrl/⌘+z)"
                        disabled={!model?.canUndo}
                        onClick={() => act("POST", "api/undo")}
                    />
                    <Button size="sm" icon="save" onClick={save}>Save</Button>
                    <Button
                        size="sm"
                        icon="download"
                        onClick={() => location.assign("api/export")}
                    >
                        Download URDF
                    </Button>
                </Row>
            }
        />
    )

    return (
        <AppShell topBar={topBar}>
            <Scene3D
                fixedFrame="world"
                style={{ position: "absolute", inset: 0 }}
                near={0.001}
                far={1000}
                fov={50}
                gridSize={2}
                gridDivisions={20}
                freeOrbit
                cameraPosition={[0.6, -0.8, 0.5]}
                cameraTarget={[0, 0, 0]}
                onViewer={setViewer}
            >
                <KeyboardFly speed={0.72} lookSpeed={1.5} />
            </Scene3D>

            {!model && modelError && (
                <EmptyState
                    layer
                    data-testid="onboard-model-error"
                    tone="warn"
                    icon="warn"
                    title="Couldn't load the robot model"
                    message={`The URDF Editor's server answered: ${modelError.message}. If it keeps failing, restart the app from Desktop's App Store.`}
                    actions={
                        <>
                            <Button variant="primary" onClick={() => refresh()}>
                                Try again
                            </Button>
                            <Button onClick={() => openApp("appstore")}>
                                Open the App Store
                            </Button>
                        </>
                    }
                />
            )}

            <Hud
                position="top-left"
                style={{
                    maxHeight: "calc(100% - 60px - var(--dim-inset-bottom, 0px))",
                }}
            >
                <Panel
                    glass
                    title={`Frames (${model?.linkList.length ?? 0})`}
                    style={{ width: 260, minHeight: 0 }}
                >
                    <Tree
                        nodes={nodes}
                        expanded={expanded}
                        onExpandedChange={(ids: string[]) => setCollapsed(allParents.filter((id) => !ids.includes(id)))}
                        selected={selected}
                        onSelect={(link: string) => act("POST", "api/select", { link })}
                        renderLabel={(node: Node) => (
                            <Row
                                gap={4}
                                onMouseEnter={() => frames.current?.setHovered(node.id)}
                                onMouseLeave={() => frames.current?.setHovered(null)}
                            >
                                <Text
                                    mono
                                    small
                                    tone={neighbors.includes(node.id) ? "warn" : undefined}
                                    style={{ flex: 1 }}
                                >
                                    {node.id}
                                </Text>
                                {node.id !== model?.root && (
                                    <IconButton
                                        style={{ flex: "none" }}
                                        icon="close"
                                        size="sm"
                                        label="remove frame"
                                        onClick={(event: MouseEvent) => {
                                            event.stopPropagation()
                                            removeLink(node.id)
                                        }}
                                    />
                                )}
                            </Row>
                        )}
                    />
                </Panel>
            </Hud>

            <Hud
                position="top-right"
                style={{ maxHeight: "calc(100% - var(--dim-inset-bottom, 0px))" }}
            >
                <Panel glass title="Selected Frame" style={{ width: 270 }}>
                    {selected
                        ? (
                            <NameField
                                value={selected}
                                onCommit={(name) =>
                                    act(
                                        "POST",
                                        `api/links/${encodeURIComponent(selected)}/properties`,
                                        { name },
                                    )}
                            />
                        )
                        : <Text muted>(none)</Text>}
                    {selected && (
                        <Text small muted>
                            {neighbors.length ? "→ " + neighbors.join(", ") : "(no connections)"}
                        </Text>
                    )}
                    <Row gap={6}>
                        <Button
                            size="sm"
                            icon="plus"
                            disabled={!selected}
                            onClick={() =>
                                act(
                                    "POST",
                                    `api/links/${encodeURIComponent(selected!)}/children`,
                                )}
                        >
                            child
                        </Button>
                        <Button
                            size="sm"
                            variant="danger"
                            icon="trash"
                            disabled={!selected || selected === model?.root}
                            onClick={() => removeLink(selected!)}
                        >
                            remove
                        </Button>
                    </Row>
                    <OriginRows key={joint?.name ?? "none"} joint={joint} act={act} />
                    {joint && <JointFields key={joint.name} joint={joint} act={act} />}
                </Panel>
                {overlapTip && (
                    <Alert tone="info">
                        For overlapping nodes, use the panel on the left to select the one you want
                    </Alert>
                )}
            </Hud>

            <Hud position="bottom-left">
                {model && model.path === null && model.label === "spot (sample)" &&
                    !sampleHintClosed && (
                    <Alert
                        tone="info"
                        data-testid="onboard-sample-hint"
                        onClose={() => {
                            setSampleHintClosed(true)
                            try {
                                localStorage.setItem(SAMPLE_HINT_KEY, "1")
                            } catch {
                                // storage blocked: hidden until reload
                            }
                        }}
                    >
                        This is a sample robot. Open a .urdf (Load URDF, or drop one anywhere) to edit your own.
                    </Alert>
                )}
                <KeyHints
                    hints={[
                        ["W A S D", "move"],
                        ["Q E", "down/up"],
                        ["I J K L", "look"],
                        ["drag", "orbit"],
                        ["click", "connections"],
                        ["drag arrow", "move axis"],
                        ["⌘ Z", "undo"],
                    ]}
                />
            </Hud>

            <Hud position="bottom-right">
                <Toolbar floating>
                    <IconButton
                        icon="minus"
                        size="sm"
                        label="smaller arrows"
                        onClick={() => scaleArrows(1 / ARROW_STEP)}
                    />
                    <Text small muted>arrows</Text>
                    <IconButton
                        icon="plus"
                        size="sm"
                        label="bigger arrows"
                        onClick={() => scaleArrows(ARROW_STEP)}
                    />
                </Toolbar>
            </Hud>
        </AppShell>
    )
}
