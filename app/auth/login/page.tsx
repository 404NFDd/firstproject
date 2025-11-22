import Link from "next/link"
import { AuthForm } from "@/components/auth-form"
import { ArrowLeft } from "lucide-react"

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Back to Home Button */}
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          메인으로 돌아가기
        </Link>

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
          <h2 className="text-2xl font-bold text-foreground mb-6">로그인</h2>
          <AuthForm mode="login" />

          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              계정이 없으신가요?{" "}
              <Link href="/auth/register" className="text-primary hover:underline font-medium">
                회원가입
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
