"use client"

import { useState, useEffect } from "react"
import { Header } from "@/components/header"
import { User, Mail, LogOut, Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { signOut } from "next-auth/react"

interface UserProfile {
  id: string
  email: string
  name: string
  image?: string
}

export default function ProfilePage() {
  const router = useRouter()
  const [user, setUser] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [isEditing, setIsEditing] = useState(false)
  const [formData, setFormData] = useState({ name: "" })

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const response = await fetch("/api/auth/me")
        if (!response.ok) {
          router.push("/auth/login")
          return
        }
        const data = await response.json()
        setUser(data.user)
        setFormData({ name: data.user.name })
      } catch (error) {
        console.error("Error fetching user:", error)
        router.push("/auth/login")
      } finally {
        setLoading(false)
      }
    }

    fetchUser()
  }, [router])

  const redirectToLogin = async () => {
    try {
      await signOut({ callbackUrl: "/auth/login" })
    } catch (error) {
      console.error("Error while redirecting to login:", error)
    }
  }

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" })
    } catch (error) {
      console.error("Error logging out:", error)
    } finally {
      await redirectToLogin()
    }
  }

  const handleSaveProfile = async () => {
    try {
      const response = await fetch("/api/auth/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      })

      if (response.ok) {
        const data = await response.json()
        setUser(data.user)
        setIsEditing(false)
      }
    } catch (error) {
      console.error("Error updating profile:", error)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Profile Card */}
          <div className="md:col-span-1">
            <div className="rounded-lg border border-border bg-card p-6">
              <div className="flex flex-col items-center text-center mb-6">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center mb-4">
                  <User className="w-8 h-8 text-primary-foreground" />
                </div>
                <h2 className="text-xl font-bold text-foreground">{user?.name}</h2>
                <p className="text-sm text-muted-foreground mt-1">{user?.email}</p>
              </div>

              <button
                onClick={handleLogout}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground transition"
              >
                <LogOut className="w-4 h-4" />
                로그아웃
              </button>
            </div>
          </div>

          {/* Profile Settings */}
          <div className="md:col-span-2">
            <div className="rounded-lg border border-border bg-card p-6">
              <h3 className="text-2xl font-bold text-foreground mb-6">프로필 설정</h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">이름</label>
                  {isEditing ? (
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-4 py-2 rounded-lg bg-input border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  ) : (
                    <p className="text-foreground">{user?.name}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-2 flex items-center gap-2">
                    <Mail className="w-4 h-4" />
                    이메일
                  </label>
                  <p className="text-muted-foreground">{user?.email}</p>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                {isEditing ? (
                  <>
                    <button
                      onClick={handleSaveProfile}
                      className="flex-1 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 transition"
                    >
                      저장
                    </button>
                    <button
                      onClick={() => setIsEditing(false)}
                      className="flex-1 px-4 py-2 rounded-lg border border-border bg-card text-foreground hover:bg-input transition"
                    >
                      취소
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="flex-1 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 transition"
                  >
                    편집
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
