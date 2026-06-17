import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "@tanstack/react-router"
import { getRouter } from "./router"

// Import global styles — @tailwindcss/vite handles processing
import "./styles.css"

const router = getRouter()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
