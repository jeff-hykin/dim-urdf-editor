import { assert, assertEquals, assertStringIncludes } from "@std/assert"
import { parseXml, serializeXml } from "./xml.ts"

const saves = await Deno.makeTempDir()
Deno.env.set("URDF_SAVES_DIR", saves)
const { handle } = await import("./http.ts")
const { answerCapture, DESCRIPTION, routes } = await import("./routes.ts")

const call = async (method: string, path: string, body?: unknown) => {
    const response = await handle(
        new Request(`http://app/${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) }),
        routes,
        DESCRIPTION,
    )
    const text = await response!.text()
    let json
    try {
        json = JSON.parse(text)
    } catch {
        json = text
    }
    return { status: response!.status, json }
}
const ok = async (method: string, path: string, body?: unknown) => {
    const result = await call(method, path, body)
    assertEquals(result.status, 200, JSON.stringify(result.json))
    return result.json
}
const fails = async (method: string, path: string, body: unknown, status: number) => {
    const result = await call(method, path, body)
    assertEquals(result.status, status, JSON.stringify(result.json))
    assert(result.json.error, "an error says why")
    return result.json.error as string
}

Deno.test("xml round-trips untouched text, comments and attribute quoting", () => {
    const text = `<?xml version="1.0"?>\n<!-- hi -->\n<robot name="a&amp;b">\n  <link name='x'/>\n</robot>\n`
    const doc = parseXml(text)
    assertEquals(doc.root.attributes, [["name", "a&b"]])
    assertEquals(serializeXml(doc), text.replace("'x'", '"x"'))
})

Deno.test("state, model, export: the sample robot", async () => {
    await ok("POST", "api/open-sample")
    const state = await ok("GET", "api/state")
    assertEquals([state.robot, state.root, state.links, state.joints], ["spot", "body", 13, 12])
    const model = await ok("GET", "api/model")
    assertEquals(model.jointList.find((j: { name: string }) => j.name === "front_left_hip_roll").parent, "body")
    assertStringIncludes(await ok("GET", "api/export"), `<robot name="spot">`)
    assertEquals((await call("GET", "api/nope")).status, 404)
})

Deno.test("joint values: one, many, reset; limits and fixed joints refuse", async () => {
    await ok("POST", "api/open-sample")
    assertEquals((await ok("POST", "api/joints/front_left_upper_pitch/value", { value: 0.5 })).value, 0.5)
    await fails("POST", "api/joints/front_left_upper_pitch/value", { value: 9 }, 400)
    await fails("POST", "api/joints/nope/value", { value: 0 }, 404)
    await fails("POST", "api/joints/front_left_upper_pitch/value", {}, 400)
    const many = await ok("POST", "api/joint-values", {
        values: { front_left_lower_knee: 1, rear_left_lower_knee: 1.2 },
    })
    assertEquals(many.jointValues.rear_left_lower_knee, 1.2)
    await fails("POST", "api/joint-values", { values: { front_left_lower_knee: 0.3, rear_left_lower_knee: -5 } }, 400)
    assertEquals((await ok("GET", "api/state")).jointValues.front_left_lower_knee, 1, "all or none")
    await fails("POST", "api/joint-values", { values: [1] }, 400)
    await ok("POST", "api/joint-values/reset")
    assertEquals((await ok("GET", "api/state")).jointValues, {})
    assertEquals((await ok("GET", "api/state")).unsavedChanges, false, "posing isn't an edit")
})

Deno.test("origins and joint properties edit the XML; undo puts them back", async () => {
    await ok("POST", "api/open-sample")
    const joint = await ok("POST", "api/joints/front_left_hip_roll/origin", { xyz: [0.4, 0.1, 0], rpy: [0, 0, 0.5] })
    assertEquals([joint.xyz, joint.rpy], [[0.4, 0.1, 0], [0, 0, 0.5]])
    assertStringIncludes(await ok("GET", "api/export"), `<origin xyz="0.4 0.1 0" rpy="0 0 0.5"/>`)
    await fails("POST", "api/joints/front_left_hip_roll/origin", { xyz: [1, 2] }, 400)
    await fails("POST", "api/joints/nope/origin", { xyz: [1, 2, 3] }, 404)
    const edited = await ok("POST", "api/joints/front_left_hip_roll/properties", {
        name: "fl_roll",
        axis: [0, 0, 1],
        lower: -1,
        upper: 1,
    })
    assertEquals([edited.name, edited.axis, edited.lower, edited.upper], ["fl_roll", [0, 0, 1], -1, 1])
    await fails("POST", "api/joints/fl_roll/properties", { type: "wobbly" }, 400)
    await fails("POST", "api/joints/fl_roll/properties", { name: "front_right_hip_roll" }, 400)
    assertEquals((await ok("GET", "api/state")).unsavedChanges, true)
    await ok("POST", "api/undo")
    await ok("POST", "api/undo")
    const back = (await ok("GET", "api/model")).jointList.find((j: { name: string }) =>
        j.name === "front_left_hip_roll"
    )
    assertEquals([back.xyz, back.rpy], [[0.32, 0.115, 0], [0, 0, 0]])
    await fails("POST", "api/undo", undefined, 409)
})

Deno.test("links: add a child, rename, remove (children move up), select", async () => {
    await ok("POST", "api/open-sample")
    const added = await ok("POST", "api/links/body/children", { name: "camera", xyz: [0.45, 0, 0.1] })
    assertEquals(added.link, "camera")
    assertEquals((await ok("GET", "api/state")).selected, "camera")
    await fails("POST", "api/links/body/children", { name: "camera" }, 400)
    await fails("POST", "api/joints/camera_joint/value", { value: 0 }, 400)
    await fails("POST", "api/links/nope/children", {}, 404)
    await ok("POST", "api/links/camera/properties", { name: "head_camera" })
    await fails("POST", "api/links/head_camera/properties", { name: "body" }, 400)
    await fails("POST", "api/links/nope/properties", { name: "x" }, 404)
    const model = (await ok("GET", "api/model")).jointList
    assertEquals(model.find((j: { child: string }) => j.child === "head_camera").parent, "body")
    await ok("DELETE", "api/links/front_left_upper")
    const after = (await ok("GET", "api/model")).jointList
    assertEquals(after.find((j: { child: string }) => j.child === "front_left_lower").parent, "front_left_hip")
    await fails("DELETE", "api/links/body", undefined, 400)
    await fails("DELETE", "api/links/nope", undefined, 404)
    assertEquals((await ok("POST", "api/select", { link: "body" })).selected, "body")
    assertEquals((await ok("POST", "api/select", {})).selected, null)
    await fails("POST", "api/select", { link: "nope" }, 404)
})

Deno.test("save, list, open by file and path, load text", async () => {
    await ok("POST", "api/open-sample")
    const saved = await ok("POST", "api/save", {})
    assertEquals(saved.file, "spot.urdf")
    const listed = await ok("GET", "api/files")
    assertEquals(listed.files.map((f: { file: string }) => f.file), ["spot.urdf"])
    assertEquals((await ok("GET", `api/files?dir=${encodeURIComponent(saves)}`)).paths, [`${saves}/spot.urdf`])
    await fails("GET", "api/files?dir=/no/such/dir", undefined, 404)
    await ok("POST", "api/save", { path: `${saves}/elsewhere.urdf` })
    await fails("POST", "api/save", { path: "relative.urdf" }, 400)
    assertEquals((await ok("POST", "api/open", { file: "spot.urdf" })).label, "spot")
    assertEquals((await ok("POST", "api/open", { path: `${saves}/elsewhere.urdf` })).path, `${saves}/elsewhere.urdf`)
    await fails("POST", "api/open", { file: "../etc/passwd" }, 400)
    await fails("POST", "api/open", { file: "missing.urdf" }, 404)
    await fails("POST", "api/open", { path: "/no/such.urdf" }, 404)
    const loaded = await ok("POST", "api/load", {
        text: `<robot name="tiny"><link name="a"/></robot>`,
        name: "tiny.urdf",
    })
    assertEquals([loaded.robot, loaded.links], ["tiny", 1])
    await fails("POST", "api/load", { text: "<robot><link name='a'></robot>" }, 400)
    await fails("POST", "api/load", { text: "<robot/>" }, 400)
    await fails("POST", "api/load", {}, 400)
})

Deno.test("arrow scale", async () => {
    assertEquals((await ok("POST", "api/arrow-scale", { scale: 1 })).arrowScale, 1)
    await fails("POST", "api/arrow-scale", { scale: 50 }, 400)
})

Deno.test("view: the page answers the capture; with no page it says so", async () => {
    const pending = call("GET", "api/view")
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert(answerCapture("c1", { image: { mimeType: "image/png", data: "iVBOR" } }))
    const view = await pending
    assertEquals([view.status, view.json.image.data], [200, "iVBOR"])
    assertEquals((await call("GET", "api/view")).status, 503)
})

Deno.test("agent.json lists every route", async () => {
    const { json } = await call("GET", "agent.json")
    assertEquals(json.endpoints.length, routes.length)
})
