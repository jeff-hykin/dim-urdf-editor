import { AppProvider } from "dimos-react"
import { createRoot } from "react-dom/client"
import { App } from "./App.tsx"

createRoot(document.getElementById("root")!).render(
    <AppProvider>
        <App />
    </AppProvider>,
)
