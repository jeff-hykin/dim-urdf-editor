// three.js scene scaffolding (Z-up, like URDF) and the render loop.
import * as THREE from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { cssColor, onThemeChange } from "./theme-colors.ts"

export type Viewer = {
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    renderer: THREE.WebGLRenderer
    controls: OrbitControls
    onFrame: (callback: () => void) => void
    /** the current view as a PNG data URL */
    capture: () => string
    dispose: () => void
}

export function createViewer(container: HTMLElement): Viewer {
    const scene = new THREE.Scene()
    scene.background = new THREE.Color()

    const camera = new THREE.PerspectiveCamera(50, 1, 0.001, 1000)
    camera.up.set(0, 0, 1) // URDF is Z-up
    camera.position.set(0.6, -0.8, 0.5)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(globalThis.devicePixelRatio)
    container.appendChild(renderer.domElement)

    scene.add(new THREE.AmbientLight(0xffffff, 0.8))
    const sun = new THREE.DirectionalLight(0xffffff, 0.6)
    sun.position.set(1, -1, 2)
    scene.add(sun)

    let grid: THREE.GridHelper | null = null
    function applyTheme() {
        ;(scene.background as THREE.Color).set(cssColor("--bg"))
        if (grid) {
            scene.remove(grid)
            grid.geometry.dispose()
            ;(grid.material as THREE.Material).dispose()
        }
        grid = new THREE.GridHelper(2, 20, cssColor("--input"), cssColor("--border"))
        grid.rotation.x = Math.PI / 2 // lay flat on XY (Z-up)
        scene.add(grid)
    }
    applyTheme()
    const stopTheme = onThemeChange(applyTheme)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.1

    function resize() {
        const width = container.clientWidth || 1
        const height = container.clientHeight || 1
        camera.aspect = width / height
        camera.updateProjectionMatrix()
        renderer.setSize(width, height)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(container)

    const updaters: (() => void)[] = []
    let frame = 0
    function loop() {
        frame = requestAnimationFrame(loop)
        for (const update of updaters) {
            update()
        }
        controls.update()
        renderer.render(scene, camera)
    }
    loop()

    return {
        scene,
        camera,
        renderer,
        controls,
        onFrame: (callback) => updaters.push(callback),
        // render and read in the same task: the drawing buffer is still there (no preserveDrawingBuffer needed)
        capture: () => {
            for (const update of updaters) {
                update()
            }
            renderer.render(scene, camera)
            return renderer.domElement.toDataURL("image/png")
        },
        dispose: () => {
            cancelAnimationFrame(frame)
            observer.disconnect()
            stopTheme()
            controls.dispose()
            renderer.dispose()
            renderer.domElement.remove()
        },
    }
}
