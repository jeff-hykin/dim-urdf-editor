// main.js — wire the URDF viewer/editor together as a self-contained app.
//
// One persistent viewer/controls/editor. `model` and `frames` are STABLE objects
// (mutated in place / Object.assign-repopulated) so the editor's captured
// references stay valid while we rebuild the frame graph after add/remove/load.

import { parseUrdf, setJointXyz, setJointRpy, addChildFrame, removeFrame, serializeUrdf } from "./urdf-model.js"
import { DimAppFrontend } from "https://esm.sh/gh/jeff-hykin/dim-app@v0.3.0/frontend.js"
import { createViewer } from "./viewer.js"
import { buildFrames } from "./frames.js"
import { installKeyboardControls } from "./controls.js"
import { installEditor } from "./editor.js"

const RAD_TO_DEG = 180 / Math.PI
const DEG_TO_RAD = Math.PI / 180

const SAMPLE_URDF = `<?xml version="1.0"?>
<robot name="sample">
  <link name="base_link"/>
  <link name="shoulder"/>
  <link name="elbow"/>
  <link name="wrist"/>
  <joint name="j1" type="fixed"><parent link="base_link"/><child link="shoulder"/><origin xyz="0 0 0.12" rpy="0 0 0"/></joint>
  <joint name="j2" type="fixed"><parent link="shoulder"/><child link="elbow"/><origin xyz="0.2 0 0" rpy="0 0 0"/></joint>
  <joint name="j3" type="fixed"><parent link="elbow"/><child link="wrist"/><origin xyz="0.15 0 0.05" rpy="0 0.4 0"/></joint>
</robot>`

const app = document.getElementById("app")
const viewer = createViewer(app)
installKeyboardControls(viewer)

// ── stable model + frames ─────────────────────────────────────────────────────
const model = {}
const frames = {}

function setModel(text) {
  const parsed = parseUrdf(text)
  for (const k of Object.keys(model)) delete model[k]
  Object.assign(model, parsed)
}
function rebuildFrames() {
  if (frames.dispose) frames.dispose()
  const built = buildFrames(viewer, model)
  for (const k of Object.keys(frames)) delete frames[k]
  Object.assign(frames, built)
}

viewer.onFrame(() => frames.updateLabelScales && frames.updateLabelScales(viewer.camera))

// ── selected-frame panel ──────────────────────────────────────────────────────
const selectedEl = document.getElementById("selected")
const neighborsEl = document.getElementById("neighbors")
const treeEl = document.getElementById("tree-list")
const addBtn = document.getElementById("add-child")
const removeBtn = document.getElementById("remove-frame")
const treeNodes = new Map()
const inputs = {
  px: document.getElementById("px"), py: document.getElementById("py"), pz: document.getElementById("pz"),
  rx: document.getElementById("rx"), ry: document.getElementById("ry"), rz: document.getElementById("rz"),
}
const allInputs = Object.values(inputs)
let currentLink = null

function renderPanel(linkName) {
  currentLink = linkName
  selectedEl.textContent = linkName ?? "(none)"
  const neighbors = linkName ? frames.neighborsOf(linkName) : []
  neighborsEl.textContent = linkName ? (neighbors.length ? "→ " + neighbors.join(", ") : "(no connections)") : ""

  const neighborSet = new Set(neighbors)
  for (const [name, node] of treeNodes) {
    node.classList.toggle("sel", name === linkName)
    node.classList.toggle("nbr", name !== linkName && neighborSet.has(name))
  }

  addBtn.disabled = !linkName
  removeBtn.disabled = !linkName || linkName === model.root

  const joint = linkName ? model.jointByChild.get(linkName) : null
  if (!joint) {
    for (const input of allInputs) { input.value = ""; input.disabled = true }
    return
  }
  for (const input of allInputs) input.disabled = false
  inputs.px.value = joint.xyz[0].toFixed(4)
  inputs.py.value = joint.xyz[1].toFixed(4)
  inputs.pz.value = joint.xyz[2].toFixed(4)
  inputs.rx.value = (joint.rpy[0] * RAD_TO_DEG).toFixed(2)
  inputs.ry.value = (joint.rpy[1] * RAD_TO_DEG).toFixed(2)
  inputs.rz.value = (joint.rpy[2] * RAD_TO_DEG).toFixed(2)
}

function applyInputs() {
  const joint = currentLink ? model.jointByChild.get(currentLink) : null
  if (!joint) return
  const values = allInputs.map((i) => parseFloat(i.value))
  if (values.some(Number.isNaN)) return
  const [px, py, pz, rx, ry, rz] = values
  setJointXyz(joint, [px, py, pz])
  setJointRpy(joint, [rx * DEG_TO_RAD, ry * DEG_TO_RAD, rz * DEG_TO_RAD])
  frames.applyJointToFrame(currentLink)
}
for (const input of allInputs) input.addEventListener("input", applyInputs)

function selectFrame(linkName) {
  frames.setSelected(linkName)
  renderPanel(linkName)
}

// ── tree (with per-node remove) ───────────────────────────────────────────────
function rebuildTree() {
  treeEl.innerHTML = ""
  treeNodes.clear()
  const addNode = (linkName, depth) => {
    const node = document.createElement("div")
    node.className = "treenode"
    node.style.paddingLeft = `${depth * 14 + 6}px`
    const nm = document.createElement("span")
    nm.className = "nm"
    nm.textContent = linkName
    node.appendChild(nm)
    if (linkName !== model.root) {
      const rm = document.createElement("span")
      rm.className = "rm"
      rm.textContent = "✕"
      rm.title = "remove frame"
      rm.addEventListener("click", (e) => { e.stopPropagation(); doRemove(linkName) })
      node.appendChild(rm)
    }
    node.addEventListener("click", () => selectFrame(linkName))
    node.addEventListener("mouseenter", () => frames.setHovered(linkName))
    node.addEventListener("mouseleave", () => frames.setHovered(null))
    treeEl.appendChild(node)
    treeNodes.set(linkName, node)
    for (const child of model.childrenOf.get(linkName) ?? []) addNode(child, depth + 1)
  }
  addNode(model.root, 0)
  document.getElementById("frame-count").textContent = String(model.links.length)
}

// ── add / remove frame ────────────────────────────────────────────────────────
function doAdd() {
  if (!currentLink) return
  const name = addChildFrame(model, currentLink)
  rebuildFrames()
  rebuildTree()
  selectFrame(name)
}
function doRemove(name) {
  if (!removeFrame(model, name)) return
  rebuildFrames()
  rebuildTree()
  renderPanel(null)
  frames.setSelected(null)
}
addBtn.addEventListener("click", doAdd)
removeBtn.addEventListener("click", () => currentLink && doRemove(currentLink))

// ── load a URDF (sample on boot, file picker after) ───────────────────────────
function loadUrdf(text, label) {
  try {
    setModel(text)
  } catch (err) {
    alert("Could not parse URDF:\n" + err.message)
    return
  }
  rebuildFrames()
  rebuildTree()
  renderPanel(null)
  document.getElementById("urdf-name").textContent = label
  applyArrowScale()
}
document.getElementById("urdf-file").addEventListener("change", async (e) => {
  const file = e.target.files[0]
  if (!file) return
  loadUrdf(await file.text(), file.name)
})

// ── disk backend: save the edited URDF + reload recently-saved ones ────────────
const dimApp = new DimAppFrontend()
const saveBtn = document.getElementById("save")
const recentEl = document.getElementById("recent")
const saveStatusEl = document.getElementById("save-status")
let statusTimer = null

function robotName() {
  return model.dom?.querySelector("robot")?.getAttribute("name") || "robot"
}
function flashStatus(text) {
  saveStatusEl.textContent = text
  clearTimeout(statusTimer)
  statusTimer = setTimeout(() => { saveStatusEl.textContent = "" }, 4000)
}

saveBtn.addEventListener("click", () => {
  dimApp.send("save", { name: robotName(), text: serializeUrdf(model) })
  flashStatus("saving…")
})
recentEl.addEventListener("change", () => {
  const file = recentEl.value
  if (file) dimApp.send("load", { file })
})

dimApp.receiveRequest((kind, payload) => {
  if (kind === "recent") {
    const selected = recentEl.value
    recentEl.innerHTML = '<option value="">Recent…</option>'
    for (const entry of payload?.files ?? []) {
      const option = document.createElement("option")
      option.value = entry.file
      option.textContent = entry.name
      recentEl.appendChild(option)
    }
    recentEl.value = [...recentEl.options].some((o) => o.value === selected) ? selected : ""
  } else if (kind === "saved") {
    flashStatus(payload?.ok ? `saved ${payload.name}` : `save failed: ${payload?.error ?? "error"}`)
  } else if (kind === "loaded") {
    if (payload?.ok) {
      loadUrdf(payload.text, payload.name)
    } else {
      flashStatus(`load failed: ${payload?.error ?? "error"}`)
      recentEl.value = ""
    }
  }
})
dimApp.send("hello") // ask the backend for the current recent-files list

// ── arrow density ─────────────────────────────────────────────────────────────
let arrowScale = 0.5
const ARROW_STEP = 1.25
function applyArrowScale() {
  arrowScale = Math.min(5, Math.max(0.25, arrowScale))
  frames.setArrowScale(arrowScale)
}
document.getElementById("thicker").addEventListener("click", () => { arrowScale *= ARROW_STEP; applyArrowScale() })
document.getElementById("thinner").addEventListener("click", () => { arrowScale /= ARROW_STEP; applyArrowScale() })

// ── boot: build the sample, then install the editor once ──────────────────────
setModel(SAMPLE_URDF)
rebuildFrames()
rebuildTree()
applyArrowScale()
installEditor(viewer, model, frames, { onSelect: renderPanel, onChange: renderPanel })
renderPanel(null)

globalThis.urdfView = { model, frames, viewer }
console.log(`urdf-view app: ${model.links.length} links, root = ${model.root}`)
