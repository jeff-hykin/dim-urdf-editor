// An axis triad per link frame, nested so world transforms come for free, plus connection lines, neighbor
// highlighting, and each joint posed at its value (rotation about / slide along its axis).
import * as THREE from "three"
import { Line2 } from "three/addons/lines/Line2.js"
import { LineGeometry } from "three/addons/lines/LineGeometry.js"
import { LineMaterial } from "three/addons/lines/LineMaterial.js"
import { type Joint, type Model, neighborsOf, tree, type Visual } from "../model.ts"
import { cssColor, onThemeChange, withAlpha } from "./theme-colors.ts"
import type { Viewer } from "./viewer.ts"

// Theme-dependent scene colors, re-read from theme.css tokens on every light/dark change.
const palette: Record<string, string> = {}
function readPalette() {
    Object.assign(palette, {
        x: cssColor("--axis-x"),
        y: cssColor("--axis-y"),
        z: cssColor("--axis-z"),
        fg: cssColor("--fg"),
        card: cssColor("--card"),
        bg: cssColor("--bg"),
        muted: cssColor("--muted-fg"),
        line: cssColor("--input"),
        hover: cssColor("--info"),
        neighbor: cssColor("--warn"),
    })
}

type LabelState = "selected" | "neighbor" | "dim" | "default"

// A text label as an in-scene sprite, so 3D geometry (the arrows) occludes it.
function makeLabelSprite(text: string) {
    const canvas = document.createElement("canvas")
    const context = canvas.getContext("2d")!
    const font = "32px ui-monospace, monospace"
    context.font = font
    const padding = 14
    const width = Math.ceil(context.measureText(text).width) + padding * 2
    const height = 48
    canvas.width = width
    canvas.height = height

    function draw(background: string, foreground: string) {
        context.clearRect(0, 0, width, height)
        context.fillStyle = background
        context.fillRect(0, 0, width, height)
        context.font = font
        context.textAlign = "center"
        context.textBaseline = "middle"
        context.fillStyle = foreground
        context.fillText(text, width / 2, height / 2)
    }

    const texture = new THREE.CanvasTexture(canvas)
    const material = new THREE.SpriteMaterial({ map: texture, depthTest: true, depthWrite: false, transparent: true })
    const sprite = new THREE.Sprite(material)

    function setState(state: LabelState) {
        if (state === "selected") {
            draw(withAlpha(palette.fg, 0.95), palette.bg)
        } else if (state === "neighbor") {
            draw(withAlpha(palette.neighbor, 0.95), palette.bg)
        } else {
            draw(withAlpha(palette.card, 0.7), palette.fg)
        }
        material.opacity = state === "dim" ? 0.2 : 1
        texture.needsUpdate = true
    }
    setState("default")
    return { sprite, setState, aspect: width / height }
}

const AXIS_LENGTH = 0.08
const SHAFT_RADIUS = 0.0035
const HEAD_LENGTH = 0.022
const LABEL_MARGIN = 0.014
const LABEL_SCREEN_K = 0.02 // label world-height per unit camera distance (constant on-screen size)
const SELECTED_ARROW_BOOST = 1.6 // selected frame's arrows grow so they stand out among overlapping nodes
const SPHERE_WORLD_RADIUS = 0.008
const VISUAL_OPACITY = 0.25
export const AXIS_DIR = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) }
const scratchHSL = { h: 0, s: 0, l: 0 }

export type Pickable = { linkName: string; kind: "sphere" | "axis"; axis?: "x" | "y" | "z" }

function quaternionFromRpy([roll, pitch, yaw]: number[]) {
    const qx = new THREE.Quaternion().setFromAxisAngle(AXIS_DIR.x, roll)
    const qy = new THREE.Quaternion().setFromAxisAngle(AXIS_DIR.y, pitch)
    const qz = new THREE.Quaternion().setFromAxisAngle(AXIS_DIR.z, yaw)
    return qz.multiply(qy).multiply(qx) // URDF: R = Rz * Ry * Rx
}

/** Where a joint puts its child frame in the parent frame: the origin, then the joint's motion at its value. */
function jointTransform(joint: Joint) {
    const quaternion = quaternionFromRpy(joint.rpy)
    const position = new THREE.Vector3(...joint.xyz)
    const axis = new THREE.Vector3(...joint.axis).normalize()
    if (joint.value && (joint.type === "revolute" || joint.type === "continuous")) {
        quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axis, joint.value))
    } else if (joint.value && joint.type === "prismatic") {
        position.add(axis.applyQuaternion(quaternionFromRpy(joint.rpy)).multiplyScalar(joint.value))
    }
    return { position, quaternion }
}

function makeAxis(name: "x" | "y" | "z", linkName: string) {
    const group = new THREE.Group()
    const color = palette[name]
    const shaftLength = AXIS_LENGTH - HEAD_LENGTH
    const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS, shaftLength, 8),
        new THREE.MeshBasicMaterial({ color }),
    )
    shaft.position.y = shaftLength / 2
    const head = new THREE.Mesh(
        new THREE.ConeGeometry(SHAFT_RADIUS * 2.6, HEAD_LENGTH, 10),
        new THREE.MeshBasicMaterial({ color }),
    )
    head.position.y = shaftLength + HEAD_LENGTH / 2
    group.add(shaft, head)
    const meta: Pickable = { linkName, kind: "axis", axis: name }
    for (const mesh of [shaft, head]) {
        // the full-saturation color, so styleFrame can desaturate non-focused frames
        mesh.material.userData = { baseColor: new THREE.Color(color), axis: name }
        mesh.userData = meta
    }
    // geometry points up +Y; rotate so it points along the named axis
    if (name === "x") {
        group.rotation.z = -Math.PI / 2
    } else if (name === "z") {
        group.rotation.x = Math.PI / 2
    }
    group.userData = meta
    return group
}

function makeVisualMesh(visual: Visual): THREE.Object3D | null {
    let geometry: THREE.BufferGeometry
    const shape = visual.shape
    if (shape.type === "box") {
        geometry = new THREE.BoxGeometry(...shape.size)
    } else if (shape.type === "cylinder") {
        geometry = new THREE.CylinderGeometry(shape.radius, shape.radius, shape.length, 24)
        geometry.rotateX(Math.PI / 2) // URDF cylinders run along local Z
    } else if (shape.type === "sphere") {
        geometry = new THREE.SphereGeometry(shape.radius, 24, 16)
    } else {
        return null // meshes aren't drawn
    }
    const [r, g, b] = visual.color
    const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(r, g, b),
        transparent: true,
        opacity: VISUAL_OPACITY,
        depthWrite: false,
        side: THREE.DoubleSide,
        roughness: 0.85,
        metalness: 0,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(...visual.origin.xyz)
    mesh.quaternion.copy(quaternionFromRpy(visual.origin.rpy))
    // outline so the translucent shape reads clearly
    if (shape.type !== "sphere") {
        mesh.add(
            new THREE.LineSegments(
                new THREE.EdgesGeometry(geometry),
                new THREE.LineBasicMaterial({ color: new THREE.Color(r, g, b), transparent: true, opacity: 0.5 }),
            ),
        )
    }
    return mesh
}

type Frame = {
    group: THREE.Group
    sphere: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
    label: ReturnType<typeof makeLabelSprite>
    markerMaterials: THREE.MeshBasicMaterial[]
    axes: THREE.Group[]
    name: string
}

export type Frames = ReturnType<typeof buildFrames>

export function buildFrames(viewer: Viewer, model: Model) {
    const scene = viewer.scene
    readPalette()
    let current = tree(model)
    const framesByLink = new Map<string, Frame>()
    const pickables: THREE.Object3D[] = []

    function makeFrame(linkName: string) {
        const group = new THREE.Group()
        const sphere = new THREE.Mesh(
            new THREE.SphereGeometry(SPHERE_WORLD_RADIUS, 16, 12),
            new THREE.MeshBasicMaterial({ color: palette.muted }),
        )
        sphere.userData = { linkName, kind: "sphere" } satisfies Pickable
        group.add(sphere)
        pickables.push(sphere)
        const markerMaterials = [sphere.material]
        const axes = []
        for (const name of ["x", "y", "z"] as const) {
            const axis = makeAxis(name, linkName)
            group.add(axis)
            axes.push(axis)
            pickables.push(...axis.children)
            markerMaterials.push(
                ...axis.children.map((child) => (child as THREE.Mesh).material as THREE.MeshBasicMaterial),
            )
        }
        const label = makeLabelSprite(linkName)
        label.sprite.position.set(0, AXIS_LENGTH + LABEL_MARGIN, 0) // tip of the y axis
        group.add(label.sprite)
        for (const visual of current.visualsByLink.get(linkName) ?? []) {
            const mesh = makeVisualMesh(visual)
            if (mesh) {
                group.add(mesh)
            }
        }
        framesByLink.set(linkName, { group, sphere, label, markerMaterials, axes, name: linkName })
        return group
    }

    // root at the scene origin, each child under its parent
    const rootGroup = makeFrame(model.root)
    scene.add(rootGroup)
    const queue = [model.root]
    while (queue.length) {
        const parent = queue.shift()!
        for (const child of current.childrenOf.get(parent) ?? []) {
            const childGroup = makeFrame(child)
            const { position, quaternion } = jointTransform(current.jointByChild.get(child)!)
            childGroup.position.copy(position)
            childGroup.quaternion.copy(quaternion)
            framesByLink.get(parent)!.group.add(childGroup)
            queue.push(child)
        }
    }

    // connection lines between parent and child frame origins (world space); fat lines so a selection can thicken
    const normalLineMaterial = new LineMaterial({ color: palette.line, linewidth: 1.5 })
    const highlightLineMaterial = new LineMaterial({ color: palette.neighbor, linewidth: 3.5 })
    function syncLineResolution() {
        const size = new THREE.Vector2()
        viewer.renderer.getDrawingBufferSize(size)
        normalLineMaterial.resolution.set(size.x, size.y)
        highlightLineMaterial.resolution.set(size.x, size.y)
    }
    syncLineResolution()
    globalThis.addEventListener("resize", syncLineResolution)

    const lines = new Map<string, Line2>()
    for (const joint of model.jointList) {
        if (!framesByLink.get(joint.parent) || !framesByLink.get(joint.child)) {
            continue
        }
        const geometry = new LineGeometry()
        geometry.setPositions([0, 0, 0, 0, 0, 0])
        const line = new Line2(geometry, normalLineMaterial)
        line.userData = { parent: joint.parent, child: joint.child }
        scene.add(line)
        lines.set(joint.child, line)
    }

    function refreshLines() {
        scene.updateMatrixWorld(true)
        const a = new THREE.Vector3()
        const b = new THREE.Vector3()
        for (const [child, line] of lines) {
            framesByLink.get(line.userData.parent)!.group.getWorldPosition(a)
            framesByLink.get(child)!.group.getWorldPosition(b)
            line.geometry.setPositions([a.x, a.y, a.z, b.x, b.y, b.z])
        }
    }
    refreshLines()

    let selected: string | null = null
    let hovered: string | null = null
    let globalArrowScale = 1

    function applyArrowScaleToFrame(name: string) {
        const frame = framesByLink.get(name)
        if (!frame) {
            return
        }
        const factor = globalArrowScale * (name === selected ? SELECTED_ARROW_BOOST : 1)
        for (const axis of frame.axes) {
            axis.scale.setScalar(factor)
        }
        frame.label.sprite.position.set(0, AXIS_LENGTH * factor + LABEL_MARGIN, 0)
    }

    function styleFrame(name: string | null) {
        const frame = name ? framesByLink.get(name) : undefined
        if (!frame || !name) {
            return
        }
        const neighbors = selected ? new Set(neighborsOf(current, selected)) : new Set<string>()
        const isSelected = name === selected
        const isNeighbor = neighbors.has(name)
        const isHovered = name === hovered
        // with a selection, every other frame goes translucent and half-saturated, so the focused one stands out
        const dim = Boolean(selected) && !isSelected && !isHovered
        const opacity = dim ? (isNeighbor ? 0.5 : 0.22) : 1
        const saturation = dim ? 0.5 : 1
        for (const material of frame.markerMaterials) {
            material.transparent = opacity < 1
            material.opacity = opacity
            const base = material.userData.baseColor as THREE.Color | undefined
            if (base) {
                material.color.copy(base).getHSL(scratchHSL)
                material.color.setHSL(scratchHSL.h, scratchHSL.s * saturation, scratchHSL.l)
            }
        }
        frame.sphere.material.color.set(
            isHovered ? palette.hover : isSelected ? palette.fg : isNeighbor ? palette.neighbor : palette.muted,
        )
        frame.sphere.scale.setScalar(isHovered ? 2.4 : isSelected ? 1.8 : 1)
        frame.label.setState(isHovered || isSelected ? "selected" : isNeighbor ? "neighbor" : dim ? "dim" : "default")
        applyArrowScaleToFrame(name)
    }

    function setSelected(linkName: string | null) {
        selected = linkName && framesByLink.has(linkName) ? linkName : null
        for (const name of framesByLink.keys()) {
            styleFrame(name)
        }
        const neighbors = selected ? new Set(neighborsOf(current, selected)) : new Set<string>()
        for (const [child, line] of lines) {
            const touches = child === selected || line.userData.parent === selected || neighbors.has(child)
            line.material = touches && selected ? highlightLineMaterial : normalLineMaterial
        }
    }

    // light/dark flip: re-read tokens, recolor axis bases + lines, restyle every frame (labels redraw)
    const stopThemeListener = onThemeChange(() => {
        readPalette()
        for (const frame of framesByLink.values()) {
            for (const material of frame.markerMaterials) {
                if (material.userData.axis) {
                    ;(material.userData.baseColor as THREE.Color).set(palette[material.userData.axis])
                }
            }
            styleFrame(frame.name)
        }
        normalLineMaterial.color.set(palette.line)
        highlightLineMaterial.color.set(palette.neighbor)
    })

    function setHovered(linkName: string | null) {
        const previous = hovered
        hovered = linkName
        styleFrame(previous)
        styleFrame(linkName)
    }

    function setArrowScale(factor: number) {
        globalArrowScale = factor
        for (const name of framesByLink.keys()) {
            applyArrowScaleToFrame(name)
        }
    }

    /** Same links and joints, new origins / values: move the frames without rebuilding. */
    function update(next: Model) {
        current = tree(next)
        for (const joint of next.jointList) {
            const frame = framesByLink.get(joint.child)
            if (frame) {
                const { position, quaternion } = jointTransform(joint)
                frame.group.position.copy(position)
                frame.group.quaternion.copy(quaternion)
            }
        }
        refreshLines()
    }

    /** The joint origin xyz that puts `linkName`'s frame at `local` (its position in the parent frame). */
    function originForPosition(linkName: string, local: THREE.Vector3): [number, number, number] {
        const joint = current.jointByChild.get(linkName)!
        const offset = jointTransform(joint).position.sub(new THREE.Vector3(...joint.xyz))
        const origin = local.clone().sub(offset)
        return [origin.x, origin.y, origin.z]
    }

    // Keep labels a constant on-screen size by scaling them with camera distance.
    const labelWorldPos = new THREE.Vector3()
    function updateLabelScales(camera: THREE.Camera) {
        for (const frame of framesByLink.values()) {
            frame.label.sprite.getWorldPosition(labelWorldPos)
            const height = LABEL_SCREEN_K * camera.position.distanceTo(labelWorldPos)
            frame.label.sprite.scale.set(height * frame.label.aspect, height, 1)
        }
    }

    // Screen-space circle (pixels) of a frame's origin sphere, or null if behind the camera.
    const overlapWorldPos = new THREE.Vector3()
    function frameScreenCircle(frame: Frame, width: number, height: number) {
        frame.group.getWorldPosition(overlapWorldPos)
        const ndc = overlapWorldPos.clone().project(viewer.camera)
        if (ndc.z > 1) {
            return null
        }
        const distance = viewer.camera.position.distanceTo(overlapWorldPos)
        const fovY = (viewer.camera.fov * Math.PI) / 180
        return {
            cx: (ndc.x * 0.5 + 0.5) * width,
            cy: (-ndc.y * 0.5 + 0.5) * height,
            r: (SPHERE_WORLD_RADIUS * (height / 2)) / (Math.tan(fovY / 2) * distance),
        }
    }

    type Circle = { cx: number; cy: number; r: number }
    // Fraction of the smaller circle's area covered by the intersection of two circles.
    function circleOverlapFraction(a: Circle, b: Circle) {
        const d = Math.hypot(a.cx - b.cx, a.cy - b.cy)
        const [ra, rb] = [a.r, b.r]
        if (d >= ra + rb) {
            return 0
        }
        if (d <= Math.abs(ra - rb)) {
            return 1 // one fully inside the other
        }
        const p1 = ra * ra * Math.acos((d * d + ra * ra - rb * rb) / (2 * d * ra))
        const p2 = rb * rb * Math.acos((d * d + rb * rb - ra * ra) / (2 * d * rb))
        const p3 = 0.5 * Math.sqrt((-d + ra + rb) * (d + ra - rb) * (d - ra + rb) * (d + ra + rb))
        return (p1 + p2 - p3) / (Math.PI * Math.min(ra, rb) ** 2)
    }

    // True when the pointer sits over two frame spheres that overlap >= 80% on screen ("which node am I clicking?").
    function overlapAtPointer(clientX: number, clientY: number) {
        const rect = viewer.renderer.domElement.getBoundingClientRect()
        const px = clientX - rect.left
        const py = clientY - rect.top
        const under: Circle[] = []
        for (const frame of framesByLink.values()) {
            const circle = frameScreenCircle(frame, rect.width, rect.height)
            if (circle && Math.hypot(px - circle.cx, py - circle.cy) <= circle.r + 6) {
                under.push(circle)
            }
        }
        for (let i = 0; i < under.length; i++) {
            for (let j = i + 1; j < under.length; j++) {
                if (circleOverlapFraction(under[i], under[j]) >= 0.8) {
                    return true
                }
            }
        }
        return false
    }

    function dispose() {
        scene.remove(rootGroup)
        for (const line of lines.values()) {
            scene.remove(line)
            line.geometry.dispose()
        }
        normalLineMaterial.dispose()
        highlightLineMaterial.dispose()
        globalThis.removeEventListener("resize", syncLineResolution)
        stopThemeListener()
    }

    return {
        framesByLink,
        pickables,
        refreshLines,
        setSelected,
        setHovered,
        setArrowScale,
        update,
        originForPosition,
        updateLabelScales,
        overlapAtPointer,
        jointOf: (linkName: string) => current.jointByChild.get(linkName),
        dispose,
    }
}
