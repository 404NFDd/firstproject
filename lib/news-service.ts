import { prisma } from "@/lib/prisma"

// 외부 뉴스 API에서 데이터 수집 (NewsAPI 또는 다른 소스)
export async function fetchNewsFromAPI() {
  try {
    // 예: NewsAPI를 사용하는 경우
    const response = await fetch(`https://newsapi.org/v2/top-headlines?country=us&apiKey=${process.env.NEWS_API_KEY}`)

    if (!response.ok) {
      throw new Error("뉴스 API 요청 실패")
    }

    const data = await response.json()
    return data.articles || []
  } catch (error) {
    console.error("Error fetching news from API:", error)
    return []
  }
}

// 뉴스를 DB에 저장
export async function saveNewsToDatabase(articles: any[]) {
  try {
    for (const article of articles) {
      // 중복 확인
      const existingNews = await prisma.news.findFirst({
        where: {
          title: article.title,
          source: article.source?.name || "Unknown",
        },
      })

      if (!existingNews) {
        await prisma.news.create({
          data: {
            title: article.title,
            description: article.description,
            content: article.content,
            imageUrl: article.urlToImage,
            sourceUrl: article.url,
            source: article.source?.name || "Unknown",
            author: article.author,
            publishedAt: new Date(article.publishedAt),
            category: "general",
          },
        })
      }
    }
  } catch (error) {
    console.error("Error saving news to database:", error)
  }
}

// 모든 뉴스 가져오기 (페이지네이션)
export async function getNews(page = 1, limit = 10, category?: string) {
  try {
    const skip = (page - 1) * limit
    const where = category ? { category } : {}

    const [news, total] = await Promise.all([
      prisma.news.findMany({
        where,
        orderBy: { publishedAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.news.count({ where }),
    ])

    return {
      news,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    }
  } catch (error) {
    console.error("Error getting news:", error)
    return { news: [], pagination: { total: 0, page: 1, limit, pages: 0 } }
  }
}

// 개별 뉴스 상세 조회
export async function getNewsDetail(newsId: string) {
  try {
    return await prisma.news.findUnique({
      where: { id: newsId },
      include: {
        bookmarks: true,
        readHistory: true,
      },
    })
  } catch (error) {
    console.error("Error getting news detail:", error)
    return null
  }
}

// 뉴스 검색
export async function searchNews(query: string, page = 1, limit = 10) {
  try {
    const skip = (page - 1) * limit

    const [news, total] = await Promise.all([
      prisma.news.findMany({
        where: {
          OR: [{ title: { contains: query } }, { description: { contains: query } }, { content: { contains: query } }],
        },
        orderBy: { publishedAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.news.count({
        where: {
          OR: [{ title: { contains: query } }, { description: { contains: query } }, { content: { contains: query } }],
        },
      }),
    ])

    return {
      news,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    }
  } catch (error) {
    console.error("Error searching news:", error)
    return { news: [], pagination: { total: 0, page: 1, limit, pages: 0 } }
  }
}

// 사용자의 즐겨찾기 뉴스 가져오기
export async function getUserBookmarks(userId: string, page = 1, limit = 10) {
  try {
    const skip = (page - 1) * limit

    const [bookmarks, total] = await Promise.all([
      prisma.newsBookmark.findMany({
        where: { userId },
        include: { news: true },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.newsBookmark.count({ where: { userId } }),
    ])

    return {
      bookmarks: bookmarks.map((b) => b.news),
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    }
  } catch (error) {
    console.error("Error getting user bookmarks:", error)
    return { bookmarks: [], pagination: { total: 0, page: 1, limit, pages: 0 } }
  }
}
