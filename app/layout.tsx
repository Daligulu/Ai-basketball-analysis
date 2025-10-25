import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'AI Basketball Analysis',
  description: 'Analyze basketball shots with on-device pose estimation and ball tracking'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <header className="border-b border-slate-800">
          <div className="container flex items-center justify-between py-4">
            <a href="/" className="text-xl font-semibold">AI Basketball Analysis</a>
            <nav className="flex gap-6 text-sm text-slate-300">
              <a href="/analyze" className="hover:text-white">开始分析</a>
              <a href="https://github.com/chonyy/AI-basketball-analysis" target="_blank" rel="noreferrer" className="hover:text-white">原项目</a>
            </nav>
          </div>
        </header>
        <main className="container py-8">{children}</main>
        <footer className="container py-10 text-sm text-slate-400">
          <p>本网站在浏览器端运行姿态识别和简单的篮球轨迹分析，便于在 Vercel 上无服务器部署。</p>
        </footer>
      </body>
    </html>
  )
}
