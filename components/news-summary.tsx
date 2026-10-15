import { Fragment, type ReactNode } from "react"
import type { CurationResult } from "@/lib/news-curation"
import { getSafeNewsUrl } from "@/lib/news-links"

// 생성한 텍스트는 React로 이스케이프하고 굵은 표현과 웹 링크만 표시합니다.
function inline(text: string): ReactNode {
  const parts: ReactNode[] = []
  let end = 0
  for (const match of text.matchAll(/\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)/g)) {
    parts.push(text.slice(end, match.index))
    const url = getSafeNewsUrl(match[3])
    parts.push(<Fragment key={match.index}>{match[1] ? <strong className="font-semibold">{match[1]}</strong> :
      url ? <a href={url} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4">{inline(match[2])}</a> : match[2]}</Fragment>)
    end = match.index! + match[0].length
  }
  parts.push(text.slice(end))
  return parts
}

export function NewsSummary({ summary }: { summary: CurationResult }) {
  return <div className="text-foreground leading-7 break-words">
    <p className="mb-8 text-base leading-8 sm:text-lg">{inline(summary.summary)}</p>
    <section aria-label="핵심 요약">
      <h2 className="text-sm font-semibold text-muted-foreground mb-4">핵심 요약</h2>
      <ul className="list-disc pl-5 space-y-3">{summary.highlights.map((text, index) => <li key={index}>{inline(text)}</li>)}</ul>
    </section>
    {summary.sections.length > 0 && <hr className="my-8 border-border" />}
    {summary.sections.map((section, index) => <section key={index} aria-label={section.heading} className="mb-8">
      <h2 className="text-xl sm:text-2xl font-bold mb-4">{section.heading}</h2>
      <ul className="list-disc pl-5 space-y-3">{section.bullets.map((bullet, bulletIndex) => <li key={bulletIndex}>
        {inline(bullet.text)}
        {bullet.details.length > 0 && <ul className="list-disc pl-5 mt-2 space-y-2 text-muted-foreground">
          {bullet.details.map((text, detailIndex) => <li key={detailIndex}>{inline(text)}</li>)}
        </ul>}
      </li>)}</ul>
      {section.table && <div className="mt-5 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm text-left">
          <caption className="sr-only">{section.heading} 비교표</caption>
          <thead className="bg-muted"><tr>{section.table.headers.map((header, column) =>
            <th key={column} scope="col" className="px-4 py-3 font-semibold whitespace-nowrap">{inline(header)}</th>)}</tr></thead>
          <tbody>{section.table.rows.map((row, rowIndex) => <tr key={rowIndex} className="border-t border-border">
            {row.map((cell, column) => <td key={column} className="px-4 py-3">{inline(cell)}</td>)}
          </tr>)}</tbody>
        </table>
      </div>}
    </section>)}
  </div>
}
