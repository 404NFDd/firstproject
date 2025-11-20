import Link from "next/link"
import { AuthForm } from "@/components/auth-form"

export default function RegisterPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-gradient-to-br from-primary to-accent mb-4">
            <div className="w-8 h-8"></div>
          </div>
          <h1 className="text-3xl font-bold gradient-text">NewsHub</h1>
          <p className="text-muted-foreground mt-2">최신 뉴스를 한 곳에서</p>
        </div>

        {/* Form */}
        <div className="rounded-lg border border-border bg-card p-6 sm:p-8">
          <h2 className="text-2xl font-bold text-foreground mb-6">회원가입</h2>
          <AuthForm mode="register" />

          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              이미 계정이 있으신가요?{" "}
              <Link href="/auth/login" className="text-primary hover:underline font-medium">
                로그인
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
