import { TaskSummary } from "../api/client";

const STATUS_DOT: Record<string, string> = {
  pending: "bg-gray-500",
  running: "bg-blue-400 animate-pulse",
  done: "bg-green-400",
  error: "bg-red-400",
};

export default function TaskList({
  tasks,
  selectedId,
  onSelect,
}: {
  tasks: TaskSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (tasks.length === 0) {
    return (
      <p className="text-gray-600 text-sm text-center mt-8 px-4">
        还没有任务，点击「+ 新建」开始
      </p>
    );
  }

  return (
    <ul className="py-2">
      {tasks.map((t) => (
        <li key={t.id}>
          <button
            onClick={() => onSelect(t.id)}
            className={`w-full text-left px-4 py-3 hover:bg-gray-800 transition-colors flex items-start gap-3 ${
              selectedId === t.id ? "bg-gray-800 border-r-2 border-brand" : ""
            }`}
          >
            <span
              className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[t.status] ?? "bg-gray-500"}`}
            />
            <span className="text-sm text-gray-200 line-clamp-2 leading-snug">{t.title}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
