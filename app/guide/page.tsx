import type { Metadata } from "next"
import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import { Header } from "@/components/header"
import { TECH_FEED_SOURCES } from "@/lib/feed-sources"
import { getNewsCategoryLabel } from "@/lib/news-categories"

export const metadata: Metadata = {
  title: "개발자 뉴스 읽기 가이드 - NewsHub",
  description: "기술 기사에서 변경사항, 적용 범위와 공식 근거를 확인하는 방법과 NewsHub 수집·브리핑 안내입니다.",
}

const readingSteps = [
  { title: "무엇이 바뀌었나요?", text: "대상 제품과 기능, 발표 날짜를 먼저 확인하세요. 정식 출시인지 시험 제공인지, 원문에 명시된 버전과 지원 종료 날짜도 함께 읽습니다." },
  { title: "내 환경에도 해당하나요?", text: "현재 사용하는 기술과 버전을 비교하세요. 성능 수치는 측정 조건을, 보안 공지는 영향받는 버전과 취약점 식별자를 공식 자료에서 확인합니다." },
  { title: "적용 전에 무엇을 확인하나요?", text: "공식 릴리스 노트와 마이그레이션 안내를 찾아보세요. 변경사항을 검토하고 테스트 환경에서 확인하면 실제 서비스에 적용할 범위를 정하는 데 도움이 됩니다." },
]

const officialSources = [
  { title: "GitHub 변경 소식", url: "https://github.blog/changelog/", text: "개발 도구, 저장소와 협업 기능의 변경사항을 확인합니다." },
  { title: "Node.js 공식 블로그", url: "https://nodejs.org/en/blog", text: "런타임 릴리스, 보안 공지와 마이그레이션 안내를 읽습니다." },
  { title: "Chrome 개발자 블로그", url: "https://developer.chrome.com/blog/", text: "브라우저와 웹 개발 기능의 업데이트를 살펴봅니다." },
  { title: "GitHub 보안 권고", url: "https://github.com/advisories", text: "패키지별 보안 공지와 취약점 식별자를 확인합니다." },
]

export default function NewsGuidePage() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <Link href="/" className="text-sm text-primary hover:underline">뉴스 피드로 돌아가기</Link>
        <div className="mt-6 mb-10">
          <p className="text-sm font-medium text-primary mb-2">개발자·IT 종사자를 위한 읽기 가이드</p>
          <h1 className="text-3xl sm:text-4xl font-bold">기술 소식을 실무의 맥락으로 읽기</h1>
          <p className="mt-4 text-muted-foreground leading-relaxed max-w-3xl">
            여러 기술 블로그와 매체의 소식으로 개발 동향을 살펴보고, 실제 적용에 필요한 정보는 출처의 글과 공식 발표에서 확인하세요.
            아래 세 가지 질문으로 변경사항과 적용 범위를 정리할 수 있습니다.
          </p>
        </div>

        <section aria-labelledby="reading-title" className="mb-12">
          <h2 id="reading-title" className="text-2xl font-semibold mb-5">기술 기사를 읽을 때 확인할 세 가지</h2>
          <ol className="grid gap-4 sm:grid-cols-3">
            {readingSteps.map((step, index) => (
              <li key={step.title} className="rounded-xl border border-border bg-card p-5">
                <p className="text-sm text-primary mb-3">{index + 1}단계</p>
                <h3 className="font-semibold mb-2">{step.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="feeds-title" className="mb-12">
          <h2 id="feeds-title" className="text-2xl font-semibold mb-2">수집하는 개발·기술 피드</h2>
          <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
            여러 출처에서 후보를 모으고, 원문에서 새로운 변화·실무 가치·구체적인 사실을 확인합니다. 채택한 글은 한국어 제목과 짧은 AI 요약으로 표시하며, 상세에서 핵심 항목과 주제별 정리를 읽을 수 있습니다. 내용이 빈약한 광고·홍보, 개인 질문과 하소연은 제외하며 원문 근거나 수치를 확인하지 못한 요약은 게시를 보류합니다.
          </p>
          <ul className="grid gap-4 sm:grid-cols-2">
            {TECH_FEED_SOURCES.map((source) => (
              <li key={source.id} className="rounded-xl border border-border bg-card p-5">
                <a href={source.website} target="_blank" rel="noopener noreferrer" className="font-semibold inline-flex items-center gap-2 text-primary hover:underline">
                  {source.name}<ArrowUpRight className="w-4 h-4" aria-hidden="true" /><span className="sr-only"> (출처를 새 탭에서 열기)</span>
                </a>
                <p className="mt-2 text-sm text-muted-foreground">{getNewsCategoryLabel(source.category)}</p>
                <a href={source.url} target="_blank" rel="noopener noreferrer" className="inline-block mt-3 text-sm text-muted-foreground hover:text-primary hover:underline">
                  공개 피드 보기<span className="sr-only"> (새 탭에서 열림)</span>
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="sources-title" className="mb-12">
          <h2 id="sources-title" className="text-2xl font-semibold mb-2">변경사항을 확인하는 공식 자료</h2>
          <p className="text-sm text-muted-foreground mb-5">수집된 소식을 검토할 때 릴리스 노트와 보안 공지를 공식 사이트에서 직접 확인할 수 있습니다.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {officialSources.map((source) => (
              <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" className="rounded-xl border border-border bg-card p-5 hover:border-primary transition focus-visible:outline-2 focus-visible:outline-primary">
                <h3 className="font-semibold flex items-center gap-2">{source.title}<ArrowUpRight className="w-4 h-4" aria-hidden="true" /><span className="sr-only"> (새 탭에서 열림)</span></h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{source.text}</p>
              </a>
            ))}
          </div>
        </section>

        <section aria-labelledby="service-title" className="rounded-xl border border-border bg-card p-5 sm:p-6">
          <h2 id="service-title" className="text-2xl font-semibold mb-4">피드와 브리핑 이용 안내</h2>
          <div className="divide-y divide-border">
            <details className="py-4" open>
              <summary className="font-medium cursor-pointer">어떤 기사를 보여주나요?</summary>
              <p className="mt-3 text-sm text-muted-foreground leading-relaxed">공개 RSS·Atom 피드의 개발·기술 소식과 네이버 IT·과학 뉴스 중 AI가 채택한 글을 첫 화면에서 모아봅니다. 개발·기술, 엔지니어링, AI·연구, 클라우드·인프라, 릴리스·도구 주제를 선택하거나 기존 종합뉴스 카테고리로 이동할 수 있습니다. 커뮤니티의 개인 질문·하소연이 섞인 피드는 제외합니다.</p>
            </details>
            <details className="py-4">
              <summary className="font-medium cursor-pointer">뉴스는 언제 갱신되나요?</summary>
              <p className="mt-3 text-sm text-muted-foreground leading-relaxed">로그인 후 뉴스 수집을 실행할 수 있습니다. 개별 카테고리에서는 해당 분야만, 기술 전체에서는 기술 분야와 IT·과학을, 모든 뉴스에서는 전체 분야를 수집합니다. 수집 시작 후 1시간 동안 추가 수집이 제한됩니다. 기술 기사는 AI 선별·요약 후 표시되므로 수집 직후 모두 나타나지는 않습니다. 기술 피드는 게시 또는 갱신 시각, 네이버 기사는 발행정보로 구분해 표시합니다. 모든 시각은 한국 시간 기준입니다.</p>
            </details>
            <details className="py-4">
              <summary className="font-medium cursor-pointer">피드에 전체 본문이 없으면 어떻게 읽나요?</summary>
              <p className="mt-3 text-sm text-muted-foreground leading-relaxed">원문은 요약할 때만 읽고, 한국어 핵심 요약과 주제별 정리로 제공합니다. 전문과 전문 번역은 보관하거나 표시하지 않습니다. 본문을 확인할 수 없으면 요약을 게시하지 않습니다. 전체 글은 상세 화면의 ‘원본보기’에서 확인할 수 있습니다. 커뮤니티 게시글과 댓글을 기사로 수집하지 않습니다.</p>
            </details>
            <details className="py-4">
              <summary className="font-medium cursor-pointer">메일 브리핑은 어떻게 구성되나요?</summary>
              <p className="mt-3 text-sm text-muted-foreground leading-relaxed">일일 브리핑의 대상은 지난 24시간에 발행되고 한국어 요약이 준비된 기사입니다. 모든 카테고리를 대상으로 하며, 화면에서 선택한 주제로 제한되지는 않습니다. 한국어 AI 요약과 원본 링크를 제공하므로 출처에서 전체 맥락을 확인할 수 있습니다. 자동 발송이 설정된 환경에서는 한국 시각 오전 7시에 보내며, 프로필에서 구독을 관리합니다.</p>
            </details>
            <details className="py-4">
              <summary className="font-medium cursor-pointer">선택한 기사를 메일로 받을 수 있나요?</summary>
              <p className="mt-3 text-sm text-muted-foreground leading-relaxed">로그인 후 기사 목록의 메일 버튼을 누르거나 체크박스로 최대 50개 기사를 선택해 계정 이메일로 받을 수 있습니다. 선택 기사 메일에는 한국어 AI 요약과 원본 링크를 담습니다. 프로필의 테스트 브리핑도 현재 로그인한 계정으로 발송됩니다.</p>
            </details>
          </div>
        </section>
      </main>
    </div>
  )
}
