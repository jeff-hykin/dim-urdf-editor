// What GET api/model returns (backend/routes.ts + backend/urdf.ts), and the tree maps the scene and panels use.
export type Vec3 = [number, number, number]
export type Shape =
    | { type: "box"; size: Vec3 }
    | { type: "cylinder"; radius: number; length: number }
    | { type: "sphere"; radius: number }
    | { type: "mesh"; filename: string }
export type Visual = { shape: Shape; origin: { xyz: Vec3; rpy: Vec3 }; color: [number, number, number, number] }
export type Link = { name: string; visuals: Visual[] }
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
    value: number
}
export type Model = {
    robot: string
    label: string
    path: string | null
    unsavedChanges: boolean
    root: string
    selected: string | null
    arrowScale: number
    canUndo: boolean
    structure: number
    revision: number
    linkList: Link[]
    jointList: Joint[]
}

export const JOINT_TYPES = ["fixed", "revolute", "continuous", "prismatic", "floating", "planar"]
export const MOVABLE = new Set(["revolute", "continuous", "prismatic"])

export type Tree = {
    jointByChild: Map<string, Joint>
    childrenOf: Map<string, string[]>
    visualsByLink: Map<string, Visual[]>
}

export function tree(model: Model): Tree {
    const jointByChild = new Map<string, Joint>()
    const childrenOf = new Map<string, string[]>(model.linkList.map((link) => [link.name, []]))
    for (const joint of model.jointList) {
        jointByChild.set(joint.child, joint)
        childrenOf.get(joint.parent)?.push(joint.child)
    }
    return { jointByChild, childrenOf, visualsByLink: new Map(model.linkList.map((link) => [link.name, link.visuals])) }
}

export function neighborsOf(t: Tree, link: string): string[] {
    const incoming = t.jointByChild.get(link)
    return [...(incoming ? [incoming.parent] : []), ...(t.childrenOf.get(link) ?? [])]
}
