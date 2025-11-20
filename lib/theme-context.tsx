"use client"

import type React from "react"
import { createContext, useContext, useState, useEffect } from "react"

interface ThemeContextType {
  theme: "light" | "dark"
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<"light" | "dark">("dark")
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    let cancelled = false
    const timeoutId = window.setTimeout(() => {
      if (cancelled) return
      setMounted(true)
      const savedTheme = localStorage.getItem("theme") as "light" | "dark" | null
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
      const initialTheme = savedTheme || (prefersDark ? "dark" : "light")
      setTheme(initialTheme)
      const html = document.documentElement
      html.classList.remove("light", "dark")
      html.classList.add(initialTheme)
    }, 0)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [])

  useEffect(() => {
    if (!mounted) return
    localStorage.setItem("theme", theme)
    const html = document.documentElement
    html.classList.remove("light", "dark")
    html.classList.add(theme)
  }, [theme, mounted])

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"))
  }

  if (!mounted) {
    return <>{children}</>
  }

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider")
  }
  return context
}
