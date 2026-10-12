import { headers } from "next/headers"
import { NextRequest } from "next/server"
import { redirect } from "next/navigation"
import { getAdminAccess } from "@/lib/admin"
import { Header } from "@/components/header"
import { AdminDashboard } from "@/components/admin-dashboard"

export const metadata = { title: "관리자 대시보드 - NewsHub" }

export default async function AdminPage() {
  const access = await getAdminAccess(new NextRequest("http://localhost/admin", { headers: await headers() }))
  if (!access.allowed) redirect(access.status === 401 ? "/auth/login" : "/")
  return <div className="min-h-screen bg-background"><Header /><AdminDashboard /></div>
}
