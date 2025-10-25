'use client'
import dynamic from 'next/dynamic'

const Analyzer = dynamic(() => import('@/components/VideoAnalyzer'), { ssr: false })

export default function AnalyzePage() {
  return (
    <section className="space-y-6">
      <h1 className="text-3xl font-semibold">开始分析你的投篮</h1>
      <Analyzer />
    </section>
  )
}
