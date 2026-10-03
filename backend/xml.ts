// A small XML tree for URDFs: parse, edit, serialize. Untouched text, comments and attribute order survive a round trip,
// so a saved URDF differs from the opened one only where it was edited. (Deno has no DOMParser.)

export type XmlElement = { kind: "element"; name: string; attributes: [string, string][]; children: XmlNode[] }
export type XmlNode = XmlElement | { kind: "text" | "raw"; text: string }
export type XmlDocument = { prolog: XmlNode[]; root: XmlElement; epilog: XmlNode[] }

const decode = (text: string) =>
    text.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, entity: string) => {
        const named: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" }
        if (named[entity.toLowerCase()]) {
            return named[entity.toLowerCase()]
        }
        return String.fromCodePoint(
            entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1)),
        )
    })
const encode = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;")

export function parseXml(text: string): XmlDocument {
    let at = 0
    const fail = (why: string): never => {
        const line = text.slice(0, at).split("\n").length
        throw new Error(`${why} (line ${line})`)
    }
    const stack: XmlElement[] = []
    const top: XmlNode[] = []
    let root: XmlElement | null = null
    const add = (node: XmlNode) => (stack.length ? stack[stack.length - 1].children : top).push(node)
    while (at < text.length) {
        const lt = text.indexOf("<", at)
        if (lt === -1) {
            add({ kind: "text", text: text.slice(at) })
            break
        }
        if (lt > at) {
            add({ kind: "text", text: text.slice(at, lt) })
            at = lt
        }
        const special = [["<!--", "-->"], ["<![CDATA[", "]]>"], ["<?", "?>"], ["<!", ">"]].find(([open]) =>
            text.startsWith(open, at)
        )
        if (special) {
            const end = text.indexOf(special[1], at)
            if (end === -1) {
                fail(`unclosed ${special[0]}`)
            }
            add({ kind: "raw", text: text.slice(at, end + special[1].length) })
            at = end + special[1].length
            continue
        }
        if (text[at + 1] === "/") {
            const end = text.indexOf(">", at)
            const name = text.slice(at + 2, end).trim()
            const open = stack.pop()
            if (!open || open.name !== name) {
                fail(`</${name}> doesn't close <${open?.name ?? "nothing"}>`)
            }
            at = end + 1
            continue
        }
        const tag = text.slice(at).match(/^<([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/)
        if (!tag) {
            fail("malformed tag")
        }
        const attributes: [string, string][] = []
        for (const [, key, double, single] of tag![2].matchAll(/([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
            attributes.push([key, decode(double ?? single)])
        }
        const element: XmlElement = { kind: "element", name: tag![1], attributes, children: [] }
        if (!stack.length) {
            if (root) {
                fail("more than one root element")
            }
            root = element
        }
        add(element)
        if (!tag![3]) {
            stack.push(element)
        }
        at += tag![0].length
    }
    if (stack.length) {
        fail(`<${stack[stack.length - 1].name}> is never closed`)
    }
    if (!root) {
        throw new Error("no XML element found")
    }
    const index = top.indexOf(root)
    return { prolog: top.slice(0, index), root, epilog: top.slice(index + 1) }
}

function write(node: XmlNode): string {
    if (node.kind !== "element") {
        return node.text
    }
    const attributes = node.attributes.map(([key, value]) => ` ${key}="${encode(value)}"`).join("")
    if (!node.children.length) {
        return `<${node.name}${attributes}/>`
    }
    return `<${node.name}${attributes}>${node.children.map(write).join("")}</${node.name}>`
}

export const serializeXml = (doc: XmlDocument) => [...doc.prolog, doc.root, ...doc.epilog].map(write).join("")

export const elements = (parent: XmlElement, name?: string) =>
    parent.children.filter((child): child is XmlElement => child.kind === "element" && (!name || child.name === name))

export const child = (parent: XmlElement, name: string) => elements(parent, name)[0] as XmlElement | undefined

export const attr = (element: XmlElement | undefined, key: string) => element?.attributes.find(([k]) => k === key)?.[1]

export function setAttr(element: XmlElement, key: string, value: string) {
    const found = element.attributes.find(([k]) => k === key)
    if (found) {
        found[1] = value
    } else {
        element.attributes.push([key, value])
    }
}

export function removeAttr(element: XmlElement, key: string) {
    element.attributes = element.attributes.filter(([k]) => k !== key)
}

/** A new element appended to `parent`, indented like its siblings (`parentIndent`: the parent's own, when it's empty). */
export function appendElement(
    parent: XmlElement,
    name: string,
    attributes: [string, string][] = [],
    parentIndent = "",
): XmlElement {
    const element: XmlElement = { kind: "element", name, attributes, children: [] }
    const space = (node: XmlNode | undefined) => node?.kind === "text" && /^\s*$/.test(node.text) ? node.text : null
    const closing = space(parent.children[parent.children.length - 1])
    const indent = space(parent.children[parent.children.length - 3]) ?? `\n${parentIndent}  `
    if (closing !== null) {
        parent.children.pop()
    }
    parent.children.push({ kind: "text", text: indent }, element, {
        kind: "text",
        text: closing ?? `\n${parentIndent}`,
    })
    return element
}

/** The whitespace `element` is indented by inside `parent` (after the last line break). */
export function indentOf(parent: XmlElement, element: XmlElement): string {
    const before = parent.children[parent.children.indexOf(element) - 1]
    return before?.kind === "text" ? before.text.split("\n").pop()!.replace(/\S/g, "") : ""
}

/** Removes `element` (and the whitespace before it) from `parent`. */
export function removeElement(parent: XmlElement, element: XmlElement) {
    const index = parent.children.indexOf(element)
    if (index === -1) {
        return
    }
    const before = parent.children[index - 1]
    const start = before?.kind === "text" && /^\s*$/.test(before.text) ? index - 1 : index
    parent.children.splice(start, index - start + 1)
}
