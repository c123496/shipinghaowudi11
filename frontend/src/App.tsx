import { useState, useEffect, useCallback } from "react";
import { api, TaskSummary, TaskDetail } from "./api/client";
import TaskList from "./components/TaskList";
import NewTaskDialog from "./components/NewTaskDialog";
import PipelineView from "./components/PipelineView";
import HomePage from "./components/HomePage";
import Gallery from "./components/Gallery";
import ScriptLibrary from "./components/ScriptLibrary";
import DiscoverPanel from "./components/DiscoverPanel";

export default function App() {
  const [view, setView] = useState<"home" | "gallery" | "scripts" | "discover" | "work">("home");
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);
  const [showNew, setShowNew] = useState(false);

  const loadTasks = useCallback(async () => {
    const data = await api.listTasks();
    setTasks(data);
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const data = await api.getTask(id);
    setTaskDetail(data);
    // Keep sidebar title in sync
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, title: data.title, status: data.status } : t))
    );
  }, []);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // Poll task detail when a step is running
  useEffect(() => {
    if (!selectedId || !taskDetail) return;
    const running = Object.values(taskDetail.steps).some((s) => s.status === "running");
    if (!running) return;
    const timer = setInterval(() => loadDetail(selectedId), 2000);
    return () => clearInterval(timer);
  }, [selectedId, taskDetail, loadDetail]);

  const handleSelectTask = (id: string) => {
    setSelectedId(id);
    loadDetail(id);
  };

  const handleCreated = (task: TaskDetail) => {
    setTasks((prev) => [
      { id: task.id, title: task.title, status: task.status, created_at: task.created_at },
      ...prev,
    ]);
    setSelectedId(task.id);
    setTaskDetail(task);
    setShowNew(false);
    setView("work");
  };

  // 首页
  if (view === "home") {
    return (
      <>
        <HomePage
          tasks={tasks}
          onStart={() => setShowNew(true)}
          onBrowse={() => setView("gallery")}
          onScripts={() => setView("scripts")}
          onDiscover={() => setView("discover")}
        />
        {showNew && (
          <NewTaskDialog onCreated={handleCreated} onClose={() => setShowNew(false)} />
        )}
      </>
    );
  }

  // 我的作品
  if (view === "gallery") {
    return (
      <>
        <Gallery onHome={() => setView("home")} onNew={() => setShowNew(true)} />
        {showNew && (
          <NewTaskDialog onCreated={handleCreated} onClose={() => setShowNew(false)} />
        )}
      </>
    );
  }

  // 文案库
  if (view === "scripts") {
    return (
      <>
        <ScriptLibrary
          onHome={() => setView("home")}
          onEnterTask={(id) => {
            setSelectedId(id);
            loadDetail(id);
            setView("work");
          }}
        />
      </>
    );
  }

  // 找同类爆款
  if (view === "discover") {
    return <DiscoverPanel onHome={() => setView("home")} onCreated={handleCreated} />;
  }

  // 工作台
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-72 flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-800">
          <button
            onClick={() => setView("home")}
            className="flex items-center gap-1.5 text-lg font-bold text-brand transition-colors hover:text-amber-300"
            title="返回首页"
          >
            <span className="text-base">←</span> 视频号爆款
          </button>
          <button
            onClick={() => setShowNew(true)}
            className="text-sm bg-brand hover:bg-brand-dark text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            + 新建
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <TaskList tasks={tasks} selectedId={selectedId} onSelect={handleSelectTask} />
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        {taskDetail && selectedId ? (
          <PipelineView
            task={taskDetail}
            onRefresh={() => loadDetail(selectedId)}
            onTitleChange={(title) => {
              setTaskDetail((prev) => (prev ? { ...prev, title } : prev));
              setTasks((prev) =>
                prev.map((t) => (t.id === selectedId ? { ...t, title } : t))
              );
            }}
          />
        ) : (
          <EmptyState onNew={() => setShowNew(true)} />
        )}
      </main>

      {showNew && (
        <NewTaskDialog onCreated={handleCreated} onClose={() => setShowNew(false)} />
      )}
    </div>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-gray-500">
      <div className="text-6xl mb-6">🎬</div>
      <p className="text-xl mb-2 text-gray-300">粘贴抖音链接，开始制作</p>
      <p className="text-sm mb-6">从链接解析到带字幕成片，全程不离开此界面</p>
      <button
        onClick={onNew}
        className="bg-brand hover:bg-brand-dark text-white px-6 py-3 rounded-xl text-base transition-colors"
      >
        + 新建任务
      </button>
    </div>
  );
}
