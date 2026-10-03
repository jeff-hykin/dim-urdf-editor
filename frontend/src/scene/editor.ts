// Picking and axis-constrained drag editing. The drag previews locally; the new origin goes to the backend on release.
import * as THREE from "three"
import { AXIS_DIR, type Frames, type Pickable } from "./frames.ts"
import type { Viewer } from "./viewer.ts"

// parameter along axis line (point A, unit dir U) closest to the pick ray
function closestParamOnAxis(ray: THREE.Ray, A: THREE.Vector3, U: THREE.Vector3) {
    const w0 = new THREE.Vector3().subVectors(A, ray.origin)
    const b = U.dot(ray.direction)
    const denom = 1 - b * b
    if (Math.abs(denom) < 1e-6) {
        return null // axis nearly parallel to the view ray
    }
    return (b * ray.direction.dot(w0) - U.dot(w0)) / denom
}

export type EditorCallbacks = {
    onSelect: (link: string | null) => void
    onMoveOrigin: (joint: string, xyz: [number, number, number]) => void
    onUndo: () => void
}

/** `getFrames` returns the current frames (they are rebuilt when the tree changes). Returns an uninstall. */
export function installEditor(viewer: Viewer, getFrames: () => Frames | null, callbacks: EditorCallbacks): () => void {
    const { camera, controls, renderer } = viewer
    const canvas = renderer.domElement
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    let drag: {
        link: string
        joint: string
        group: THREE.Object3D
        axisWorldDir: THREE.Vector3
        startWorldPos: THREE.Vector3
        startParam: number
        moved: boolean
    } | null = null

    function setPointer(event: PointerEvent) {
        const rect = canvas.getBoundingClientRect()
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
        raycaster.setFromCamera(pointer, camera)
    }

    const pointerdown = (event: PointerEvent) => {
        const frames = getFrames()
        if (!frames) {
            return
        }
        setPointer(event)
        const hit = raycaster.intersectObjects(frames.pickables, false)[0]?.object.userData as Pickable | undefined
        if (!hit) {
            return
        }
        callbacks.onSelect(hit.linkName)
        // an axis arrow drags the frame along that axis; the root has no joint to edit
        const joint = frames.jointOf(hit.linkName)
        if (hit.kind !== "axis" || !joint || !hit.axis) {
            return
        }
        const group = frames.framesByLink.get(hit.linkName)!.group
        const axisWorldDir = AXIS_DIR[hit.axis].clone()
            .applyQuaternion(group.getWorldQuaternion(new THREE.Quaternion()))
            .normalize()
        const startWorldPos = group.getWorldPosition(new THREE.Vector3())
        const startParam = closestParamOnAxis(raycaster.ray, startWorldPos, axisWorldDir)
        if (startParam === null) {
            return
        }
        drag = { link: hit.linkName, joint: joint.name, group, axisWorldDir, startWorldPos, startParam, moved: false }
        controls.enabled = false
        canvas.setPointerCapture(event.pointerId)
    }

    const pointermove = (event: PointerEvent) => {
        if (!drag) {
            return
        }
        setPointer(event)
        const param = closestParamOnAxis(raycaster.ray, drag.startWorldPos, drag.axisWorldDir)
        if (param === null) {
            return
        }
        const world = drag.startWorldPos.clone().addScaledVector(drag.axisWorldDir, param - drag.startParam)
        drag.group.position.copy(drag.group.parent!.worldToLocal(world))
        drag.moved = true
        getFrames()?.refreshLines()
    }

    const endDrag = (event: PointerEvent) => {
        if (!drag) {
            return
        }
        const { link, joint, group, moved } = drag
        drag = null
        controls.enabled = true
        canvas.releasePointerCapture(event.pointerId)
        const frames = getFrames()
        if (moved && frames) {
            callbacks.onMoveOrigin(joint, frames.originForPosition(link, group.position))
        }
    }

    const keydown = (event: KeyboardEvent) => {
        if ((event.target as HTMLElement | null)?.closest?.("input, select, textarea")) {
            return
        }
        if (event.key === "Escape") {
            callbacks.onSelect(null)
        } else if (event.key.toLowerCase() === "z" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            callbacks.onUndo()
        }
    }

    canvas.addEventListener("pointerdown", pointerdown)
    canvas.addEventListener("pointermove", pointermove)
    canvas.addEventListener("pointerup", endDrag)
    canvas.addEventListener("pointercancel", endDrag)
    addEventListener("keydown", keydown)
    return () => {
        canvas.removeEventListener("pointerdown", pointerdown)
        canvas.removeEventListener("pointermove", pointermove)
        canvas.removeEventListener("pointerup", endDrag)
        canvas.removeEventListener("pointercancel", endDrag)
        removeEventListener("keydown", keydown)
    }
}
