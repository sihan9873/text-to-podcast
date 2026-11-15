export default function DevTools() {
  return (
    <main className="mx-auto max-w-3xl space-y-5 p-8">
      <h1 className="text-2xl font-semibold">本地测试控制台</h1>
      <p>在仓库根目录运行一次启动命令，之后即可在浏览器按钮中检查环境、启停服务、执行测试并查看日志、脚本和音频。</p>
      <pre className="rounded-lg bg-secondary p-4">python scripts/local_console.py</pre>
      <a className="inline-block rounded-lg bg-primary px-5 py-3 text-primary-foreground" href="http://localhost:8765" target="_blank" rel="noreferrer">打开测试控制台 ↗</a>
      <p>控制台独立于业务登录。关闭启动终端时，会停止由控制台启动的服务；本轮数据库与报告会保留。</p>
      <a className="block text-primary" href="/projects">返回项目</a>
    </main>
  )
}
