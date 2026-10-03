// A URDF as a frame tree: links, joints (origin, axis, limits) and primitive visuals, read from and edited in the XML
// tree (xml.ts), which stays the source of truth so a save keeps every untouched tag.
import {
    appendElement,
    attr,
    child,
    elements,
    indentOf,
    parseXml,
    removeAttr,
    removeElement,
    serializeXml,
    setAttr,
    type XmlDocument,
    type XmlElement,
} from "./xml.ts"

export type Vec3 = [number, number, number]
export type Shape =
    | { type: "box"; size: Vec3 }
    | { type: "cylinder"; radius: number; length: number }
    | { type: "sphere"; radius: number }
    | { type: "mesh"; filename: string }
export type Visual = { shape: Shape; origin: { xyz: Vec3; rpy: Vec3 }; color: [number, number, number, number] }
export type Joint = {
    name: string
    type: string
    parent: string
    child: string
    xyz: Vec3
    rpy: Vec3
    axis: Vec3
    lower: number | null
    upper: number | null
}
export type Link = { name: string; visuals: Visual[] }

export const JOINT_TYPES = ["fixed", "revolute", "continuous", "prismatic", "floating", "planar"]
/** Joint types a single value poses (radians, or meters for prismatic). */
export const MOVABLE = new Set(["revolute", "continuous", "prismatic"])
const DEFAULT_COLOR: [number, number, number, number] = [0.6, 0.6, 0.65, 1]

function numbers(text: string | undefined, count: number): number[] | null {
    const parts = text?.trim().split(/\s+/).map(Number)
    return parts && parts.length === count && parts.every(Number.isFinite) ? parts : null
}
const triple = (text: string | undefined, fallback: Vec3) => (numbers(text, 3) as Vec3 | null) ?? fallback
const round = (values: number[]) => values.map((value) => Number(value.toFixed(6))).join(" ")

export class Urdf {
    doc: XmlDocument

    constructor(text: string) {
        this.doc = parseXml(text)
        if (this.doc.root.name !== "robot") {
            throw new Error(`the root element is <${this.doc.root.name}>, not <robot>`)
        }
        if (!this.links().length) {
            throw new Error("the URDF has no <link>")
        }
    }

    get robotName() {
        return attr(this.doc.root, "name") ?? "robot"
    }

    toString() {
        return serializeXml(this.doc)
    }

    #linkElements() {
        return elements(this.doc.root, "link")
    }

    #jointElements() {
        return elements(this.doc.root, "joint").filter((joint) =>
            attr(child(joint, "parent"), "link") && attr(child(joint, "child"), "link")
        )
    }

    #materials() {
        const materials = new Map<string, [number, number, number, number]>()
        for (const material of elements(this.doc.root, "material")) {
            const rgba = numbers(attr(child(material, "color"), "rgba"), 4)
            if (attr(material, "name") && rgba) {
                materials.set(attr(material, "name")!, rgba as [number, number, number, number])
            }
        }
        return materials
    }

    links(): Link[] {
        const materials = this.#materials()
        return this.#linkElements().map((link) => ({
            name: attr(link, "name") ?? "",
            visuals: elements(link, "visual").flatMap((visual): Visual[] => {
                const geometry = child(visual, "geometry")
                const shape = geometry && parseShape(geometry)
                if (!shape) {
                    return []
                }
                const origin = child(visual, "origin")
                const material = child(visual, "material")
                const inline = numbers(attr(child(material ?? visual, "color"), "rgba"), 4)
                const color = (inline as Visual["color"] | null) ??
                    materials.get(attr(material, "name") ?? "") ?? DEFAULT_COLOR
                return [{
                    shape,
                    origin: {
                        xyz: triple(attr(origin, "xyz"), [0, 0, 0]),
                        rpy: triple(attr(origin, "rpy"), [0, 0, 0]),
                    },
                    color,
                }]
            }),
        }))
    }

    joints(): Joint[] {
        return this.#jointElements().map((joint) => {
            const origin = child(joint, "origin")
            const limit = child(joint, "limit")
            const number = (
                text: string | undefined,
            ) => (text === undefined || !Number.isFinite(Number(text)) ? null : Number(text))
            return {
                name: attr(joint, "name") ?? "",
                type: attr(joint, "type") ?? "fixed",
                parent: attr(child(joint, "parent"), "link")!,
                child: attr(child(joint, "child"), "link")!,
                xyz: triple(attr(origin, "xyz"), [0, 0, 0]),
                rpy: triple(attr(origin, "rpy"), [0, 0, 0]),
                axis: triple(attr(child(joint, "axis"), "xyz"), [1, 0, 0]),
                lower: number(attr(limit, "lower")),
                upper: number(attr(limit, "upper")),
            }
        })
    }

    root(): string {
        const children = new Set(this.joints().map((joint) => joint.child))
        const names = this.links().map((link) => link.name)
        return names.find((name) => !children.has(name)) ?? names[0]
    }

    #joint(name: string): XmlElement {
        const joint = this.#jointElements().find((element) => attr(element, "name") === name)
        if (!joint) {
            throw new Error(`no joint named ${name}`)
        }
        return joint
    }

    #link(name: string): XmlElement {
        const link = this.#linkElements().find((element) => attr(element, "name") === name)
        if (!link) {
            throw new Error(`no link named ${name}`)
        }
        return link
    }

    hasJoint = (name: string) => this.#jointElements().some((element) => attr(element, "name") === name)
    hasLink = (name: string) => this.#linkElements().some((element) => attr(element, "name") === name)

    setOrigin(jointName: string, { xyz, rpy }: { xyz?: Vec3; rpy?: Vec3 }) {
        const joint = this.#joint(jointName)
        const origin = child(joint, "origin") ?? appendElement(joint, "origin", [], indentOf(this.doc.root, joint))
        if (xyz) {
            setAttr(origin, "xyz", round(xyz))
        }
        if (rpy) {
            setAttr(origin, "rpy", round(rpy))
        }
    }

    setJointProperties(
        jointName: string,
        props: { name?: string; type?: string; axis?: Vec3; lower?: number | null; upper?: number | null },
    ) {
        const joint = this.#joint(jointName)
        if (props.name !== undefined && props.name !== jointName) {
            if (this.hasJoint(props.name)) {
                throw new Error(`a joint named ${props.name} already exists`)
            }
            setAttr(joint, "name", props.name)
        }
        if (props.type !== undefined) {
            if (!JOINT_TYPES.includes(props.type)) {
                throw new Error(`type must be one of ${JOINT_TYPES.join(", ")}`)
            }
            setAttr(joint, "type", props.type)
        }
        if (props.axis) {
            const length = Math.hypot(...props.axis)
            if (!length) {
                throw new Error("axis can't be zero")
            }
            const axis = child(joint, "axis") ?? appendElement(joint, "axis", [], indentOf(this.doc.root, joint))
            setAttr(axis, "xyz", round(props.axis))
        }
        for (const key of ["lower", "upper"] as const) {
            if (props[key] === undefined) {
                continue
            }
            const limit = child(joint, "limit") ??
                appendElement(joint, "limit", [["effort", "0"], ["velocity", "0"]], indentOf(this.doc.root, joint))
            if (props[key] === null) {
                removeAttr(limit, key)
            } else {
                setAttr(limit, key, String(props[key]))
            }
        }
    }

    renameLink(oldName: string, newName: string) {
        if (!/^[\w.-]+$/.test(newName)) {
            throw new Error("a link name may only have letters, digits, _ . -")
        }
        if (this.hasLink(newName)) {
            throw new Error(`a link named ${newName} already exists`)
        }
        setAttr(this.#link(oldName), "name", newName)
        for (const joint of this.#jointElements()) {
            for (const end of [child(joint, "parent")!, child(joint, "child")!]) {
                if (attr(end, "link") === oldName) {
                    setAttr(end, "link", newName)
                }
            }
        }
    }

    /** A new fixed child frame under `parent`; returns its link name. */
    addChild(parent: string, name?: string, xyz: Vec3 = [0, 0, 0]): string {
        this.#link(parent)
        let linkName = name
        if (!linkName) {
            let n = 1
            while (this.hasLink(`frame_${n}`)) {
                n++
            }
            linkName = `frame_${n}`
        } else if (this.hasLink(linkName)) {
            throw new Error(`a link named ${linkName} already exists`)
        }
        appendElement(this.doc.root, "link", [["name", linkName]])
        const joint = appendElement(this.doc.root, "joint", [["name", `${linkName}_joint`], ["type", "fixed"]])
        const indent = indentOf(this.doc.root, joint)
        appendElement(joint, "parent", [["link", parent]], indent)
        appendElement(joint, "child", [["link", linkName]], indent)
        appendElement(joint, "origin", [["xyz", round(xyz)], ["rpy", "0 0 0"]], indent)
        return linkName
    }

    /** Removes a frame; its children move up to its parent so the tree stays connected. */
    removeLink(name: string) {
        if (name === this.root()) {
            throw new Error(`${name} is the root; it can't be removed`)
        }
        const link = this.#link(name)
        const incoming = this.#jointElements().find((joint) => attr(child(joint, "child"), "link") === name)
        const parent = attr(child(incoming!, "parent"), "link")!
        for (const joint of this.#jointElements()) {
            const end = child(joint, "parent")!
            if (attr(end, "link") === name) {
                setAttr(end, "link", parent)
            }
        }
        removeElement(this.doc.root, link)
        removeElement(this.doc.root, incoming!)
    }
}

function parseShape(geometry: XmlElement): Shape | null {
    const box = child(geometry, "box")
    if (box) {
        return { type: "box", size: triple(attr(box, "size"), [0.1, 0.1, 0.1]) }
    }
    const cylinder = child(geometry, "cylinder")
    if (cylinder) {
        return { type: "cylinder", radius: Number(attr(cylinder, "radius")), length: Number(attr(cylinder, "length")) }
    }
    const sphere = child(geometry, "sphere")
    if (sphere) {
        return { type: "sphere", radius: Number(attr(sphere, "radius")) }
    }
    const mesh = child(geometry, "mesh")
    if (mesh) {
        return { type: "mesh", filename: attr(mesh, "filename") ?? "" }
    }
    return null
}
