"use client"
import { ThemeProvider as NextThemesProvider, useTheme as useNextTheme, type ThemeProviderProps } from "next-themes"

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="dark" enableSystem {...props}>
      {children}
    </NextThemesProvider>
  )
}

export function useTheme() {
  const theme = useNextTheme()
  return {
    ...theme,
    toggleTheme: () => {
      theme.setTheme(theme.theme === "dark" ? "light" : "dark")
    },
  }
}
