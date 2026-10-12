"use client"

import type { ReactNode } from "react"
import { SessionProvider } from "next-auth/react"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toaster"

interface AppProvidersProps {
  children: ReactNode
}

export function AppProviders({ children }: AppProvidersProps) {
  return (
    <SessionProvider>
      <ThemeProvider>
        {children}
        <Toaster />
      </ThemeProvider>
    </SessionProvider>
  )
}

