export default function Page() {
  return (
    <section className="grid md:grid-cols-2 gap-8 items-center">
      <div className="space-y-6">
        <h1 className="text-4xl md:text-5xl font-bold leading-tight">
          AI Basketball Analysis
        </h1>
        <p className="text-slate-300 text-lg">
          Leverages artificial intelligence to break down basketball shots by detecting player movements, shot accuracy, and pose data.
        </p>
        <ul className="text-slate-300 list-disc pl-6 space-y-2">
          <li>浏览器端 <b>MoveNet</b>/BlazePose 姿态点检测</li>
          <li>上传视频或调用摄像头，自动识别<strong>出手</strong>、<strong>轨迹</strong>与<strong>命中/打铁</strong>（启发式）</li>
          <li>可视化肢体角度、速度变化和投篮次数统计</li>
        </ul>
        <div className="flex gap-4">
          <a className="btn" href="/analyze">开始分析</a>
          <a className="btn-outline" href="https://github.com/chonyy/AI-basketball-analysis" target="_blank" rel="noreferrer">参考功能</a>
        </div>
      </div>
      <div className="card">
        <video
          src=""
          className="w-full rounded-lg border border-slate-700 aspect-video bg-black/40 grid place-items-center"
          autoPlay
          playsInline
          muted
          controls={false}
        ></video>
        <p className="text-slate-400 text-sm mt-3">
          提示：为提升准确率，请选择<strong>固定机位</strong>、篮筐可见的画面，并在分析页设置篮筐区域。
        </p>
      </div>
    </section>
  )
}
