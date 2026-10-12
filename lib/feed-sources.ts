import type { TechCategory } from "@/lib/news-categories"

export interface TechFeedSource {
  id: string
  name: string
  url: string
  category: TechCategory
  website: string
  language: "ko" | "en"
}

export const TECH_FEED_SOURCES: readonly TechFeedSource[] = [
  { id: "jetbrains-idea", name: "JetBrains IntelliJ IDEA", url: "https://blog.jetbrains.com/idea/feed/", category: "developer", website: "https://blog.jetbrains.com/idea/", language: "en" },
  { id: "visual-studio", name: "Microsoft Visual Studio", url: "https://devblogs.microsoft.com/visualstudio/feed/", category: "developer", website: "https://devblogs.microsoft.com/visualstudio/", language: "en" },
  { id: "naver-d2", name: "NAVER D2", url: "https://d2.naver.com/d2.atom", category: "engineering", website: "https://d2.naver.com/", language: "ko" },
  { id: "toss-tech", name: "Toss Tech", url: "https://toss.tech/rss.xml", category: "engineering", website: "https://toss.tech/", language: "ko" },
  { id: "nolan-lawson", name: "Nolan Lawson", url: "https://nolanlawson.com/feed/", category: "engineering", website: "https://nolanlawson.com/", language: "en" },
  { id: "mat-duggan", name: "Mat Duggan", url: "https://matduggan.com/rss/", category: "engineering", website: "https://matduggan.com/", language: "en" },
  { id: "the-new-stack", name: "The New Stack", url: "https://thenewstack.io/blog/feed/", category: "engineering", website: "https://thenewstack.io/", language: "en" },
  { id: "github-changelog", name: "GitHub Changelog", url: "https://github.blog/changelog/feed/", category: "release", website: "https://github.blog/changelog/", language: "en" },
  { id: "nodejs", name: "Node.js Blog", url: "https://nodejs.org/en/feed/blog.xml", category: "release", website: "https://nodejs.org/en/blog", language: "en" },
  { id: "react", name: "React Releases", url: "https://github.com/react/react/releases.atom", category: "release", website: "https://github.com/react/react/releases", language: "en" },
  { id: "nextjs", name: "Next.js Blog", url: "https://nextjs.org/feed.xml", category: "release", website: "https://nextjs.org/blog", language: "en" },
  { id: "vue", name: "Vue Blog", url: "https://blog.vuejs.org/feed.rss", category: "release", website: "https://blog.vuejs.org/", language: "en" },
  { id: "typescript", name: "TypeScript Blog", url: "https://devblogs.microsoft.com/typescript/feed/", category: "release", website: "https://devblogs.microsoft.com/typescript/", language: "en" },
  { id: "php", name: "PHP Releases", url: "https://www.php.net/feed.atom", category: "release", website: "https://www.php.net/releases/", language: "en" },
  { id: "laravel", name: "Laravel Releases", url: "https://github.com/laravel/framework/releases.atom", category: "release", website: "https://github.com/laravel/framework/releases", language: "en" },
  { id: "java", name: "Inside Java", url: "https://inside.java/feed.xml", category: "release", website: "https://inside.java/", language: "en" },
  { id: "spring", name: "Spring Releases", url: "https://spring.io/blog/category/releases.atom", category: "release", website: "https://spring.io/blog/category/releases", language: "en" },
  { id: "python", name: "Python Insider", url: "https://blog.python.org/feeds/posts/default?alt=rss", category: "release", website: "https://blog.python.org/", language: "en" },
  { id: "postgresql", name: "PostgreSQL News", url: "https://www.postgresql.org/news.rss", category: "release", website: "https://www.postgresql.org/about/news/", language: "en" },
  { id: "mysql", name: "MySQL Blog", url: "https://blogs.oracle.com/mysql/feed", category: "release", website: "https://blogs.oracle.com/mysql/", language: "en" },
  { id: "dotnet", name: ".NET Blog", url: "https://devblogs.microsoft.com/dotnet/feed/", category: "release", website: "https://devblogs.microsoft.com/dotnet/", language: "en" },
  { id: "docker", name: "Docker Blog", url: "https://www.docker.com/feed/", category: "infrastructure", website: "https://www.docker.com/blog/", language: "en" },
  { id: "hugging-face", name: "Hugging Face Blog", url: "https://huggingface.co/blog/feed.xml", category: "ai", website: "https://huggingface.co/blog", language: "en" },
  { id: "cloudflare", name: "Cloudflare Blog", url: "https://blog.cloudflare.com/rss/", category: "infrastructure", website: "https://blog.cloudflare.com/", language: "en" },
]

// 기사와 개인 질문·의견이 혼합된 커뮤니티 피드는 표시·브리핑에서도 제외합니다.
export const EXCLUDED_COMMUNITY_SOURCES: readonly string[] = ["GeekNews", "Hacker News"]
