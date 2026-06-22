import { useState } from "react";
import { api, TaskDetail } from "../api/client";

type TaskMode = "link" | "script";

export default function NewTaskDialog({
  onCreated,
  onClose,
}: {
  onCreated: (task: TaskDetail) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<TaskMode>("script");
  const [url, setUrl] = useState("");
  const [script, setScript] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    setLoading(true);
    setError("");
    try {
      let task: TaskDetail;
      if (mode === "link") {
        const trimmed = url.trim();
        if (!trimmed) {
          setError("请粘贴抖音或视频号分享链接");
          return;
        }
        task = await api.createTask(trimmed);
      } else {
        const trimmed = script.trim();
        if (!trimmed) {
          setError("请输入完整口播文案");
          return;
        }
        task = await api.createScriptTask(trimmed);
      }
      onCreated(task);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const tabClass = (active: boolean) =>
    `flex-1 rounded-lg px-3 py-2 text-sm transition-colors ${
      active
        ? "bg-brand/15 border border-brand/50 text-amber-200 font-semibold"
        : "border border-gray-700 text-gray-400 hover:text-gray-200"
    }`;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-lg mx-4 shadow-2xl">
        <h2 className="text-lg font-semibold mb-4">新建视频任务</h2>

        <div className="flex gap-2 mb-4">
          <button className={tabClass(mode === "script")} onClick={() => setMode("script")}>
            ✍️ 直接写文案
          </button>
          <button className={tabClass(mode === "link")} onClick={() => setMode("link")}>
            🔗 粘贴链接
          </button>
        </div>

        {mode === "link" ? (
          <>
            <label className="block text-sm text-gray-400 mb-2">抖音 / 视频号分享链接</label>
            <textarea
              className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-gray-100 resize-none focus:outline-none focus:border-brand"
              rows={3}
              placeholder="抖音：https://v.douyin.com/...&#10;视频号：https://weixin.qq.com/sph/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSubmit();
              }}
              autoFocus
            />
            <p className="text-xs text-amber-400/80 mt-2 leading-relaxed">
              ⚠️ 请<strong>完整复制</strong>整段分享文案（链接不要缺字符），否则会解析失败。
              视频号需先在专用 Chrome 登录元宝。
            </p>
          </>
        ) : (
          <>
            <label className="block text-sm text-gray-400 mb-2">口播文案（定稿）</label>
            <textarea
              className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-gray-100 resize-none focus:outline-none focus:border-brand"
              rows={10}
              placeholder="把写好的完整口播文案粘贴到这里…"
              value={script}
              onChange={(e) => setScript(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSubmit();
              }}
              autoFocus
            />
            <p className="text-xs text-amber-400/80 mt-2 leading-relaxed">
              💡 文案即定稿：一键出片会跳过解析与改写，自动完成
              识书 → 配音 → 配图 → 字幕 → 成片，<strong>中途不再暂停</strong>。
              <br />
              🎨 默认<strong>水墨国画风 + 三国克隆声</strong>；建议口播 1500–1800 字（约 6 分钟）以内，完播更好。
            </p>
          </>
        )}

        {error && <p className="text-red-400 text-sm mt-2">{error}</p>}

        <div className="flex gap-3 mt-5 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-5 py-2 bg-brand hover:bg-brand-dark text-white text-sm rounded-lg disabled:opacity-50 transition-colors"
          >
            {loading ? "创建中..." : "创建任务"}
          </button>
        </div>
      </div>
    </div>
  );
}
