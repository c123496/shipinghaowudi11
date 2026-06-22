export interface TaskSummary {
  id: string;
  title: string;
  status: string;
  created_at: string;
}

export interface StepStatus {
  status: "pending" | "running" | "done" | "error";
  started_at: string | null;
  finished_at: string | null;
  error_msg: string | null;
  // Artifacts loaded when done
  meta?: DyMeta;
  transcript?: Transcript;
  rewrite?: RewriteData;
  subtitles?: string;
  wenan?: WenanData;
  storyboard?: StoryboardData;
}

export interface DyMeta {
  title: string;
  uploader: string;
  view_count: number;
  like_count: number;
  duration: number;
  description: string;
}

export interface Transcript {
  language: string;
  duration: number;
  full_text: string;
  segments: { id: number; start: number; end: number; text: string }[];
}

export interface ComplianceIssue {
  rule: string;
  severity: "high" | "mid" | "low";
  quote: string;
  reason: string;
  suggestion: string;
}

export interface ComplianceReport {
  passed: boolean;
  issues: ComplianceIssue[];
}

export interface RewriteData {
  candidates: string[];
  selected: number;
  book?: BookInfo;
  compliance?: ComplianceReport[];
}

export interface TaskDetail extends TaskSummary {
  douyin_url: string;
  steps: Record<string, StepStatus>;
}

export interface BookInfo {
  book_title: string;
  book_author: string;
  confidence: number;
  evidence: string;
}

export interface WenanData {
  cleaned?: string;
  rewrite?: string;
  dedup?: string;
  rewrite_similarity?: number;
  dedup_similarity?: number;
  book?: BookInfo;
  inputs?: { keyword?: string; rewrite_notes?: string; protected_terms?: string };
}

export type WenanOp = "clean" | "rewrite" | "dedup" | "identify-book";

export interface StoryboardGrid {
  status: "generating" | "done" | "error";
  grid?: string;
  cells?: string[];
  error?: string;
}

export interface StoryboardData {
  batches?: string[][];
  mode?: string;
  source?: "rewrite" | "dedup";
  grids?: Record<string, StoryboardGrid>;
  ref_image_count?: number; // 对标视频检测到的画面张数
  image_count?: number; // 实际采用的分镜图张数
}

export interface StoryboardVideoVariant {
  label: string;
  file: string;
  exists: boolean;
  duration: number | null;
  script_ready?: boolean;
  script_chars?: number;
  stale?: boolean;
  storyboard_ready?: boolean;
  storyboard_source?: string | null;
}

export interface WenanRunBody {
  keyword?: string;
  rewrite_notes?: string;
  protected_terms?: string;
  existing_title?: string;
  existing_author?: string;
  cleaned?: string;
}

export interface ScriptItem {
  task_id: string;
  source: string;
  created_at: string;
  book?: BookInfo | null;
  transcript?: {
    preview: string;
    full_text: string;
  } | null;
  rewrite?: {
    candidates_count: number;
    selected_index: number;
    candidates: string[];
    preview: string;
    full_text: string;
  } | null;
  wenan_rewrite?: {
    preview: string;
    full_text: string;
  } | null;
  dedup?: {
    preview: string;
    full_text: string;
  } | null;
  has_rewrite: boolean;
  has_dedup: boolean;
  has_wenan_rewrite: boolean;
  rewrite_similarity?: number | null;
  wenan_rewrite_similarity?: number | null;
  dedup_similarity?: number | null;
}

export interface GalleryItem {
  id: string;
  task_id?: string;
  title: string;
  label?: string;
  video_url: string;
  cover_url: string | null;
  duration: number | null;
}

export interface DiscoverItem {
  aweme_id: string;
  url: string;
  title: string;
  author: string;
  like_count: number;
  comment_count: number;
  duration: number;
  cover: string | null;
  ai_label: boolean;
  ai_hint: boolean;
  history_hit: boolean;
  comment_checked: number;
  book_comments: string[];
  qualified: boolean;
}

export interface DiscoverStatus {
  running: boolean;
  keyword: string;
  logs: string[];
  results: DiscoverItem[];
  error: string | null;
  started_at: number | null;
}

export interface DiscoverRunParams {
  keyword: string;
  min_likes?: number;
  max_check?: number;
  stop_after_hits?: number;
}

const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

export const api = {
  listTasks: () => request<TaskSummary[]>("/tasks"),

  discoverRun: (params: DiscoverRunParams) =>
    request<{ status: string }>("/discover/run", {
      method: "POST",
      body: JSON.stringify(params),
    }),

  discoverStatus: () => request<DiscoverStatus>("/discover/status"),

  listGallery: () => request<GalleryItem[]>("/gallery"),

  listScripts: () => request<ScriptItem[]>("/scripts"),

  getTask: (id: string) => request<TaskDetail>(`/tasks/${id}`),

  createTask: (douyin_url: string) =>
    request<TaskDetail>("/tasks", {
      method: "POST",
      body: JSON.stringify({ douyin_url }),
    }),

  // 手动文案模式：直接给定稿口播文案，跳过解析/转写/清洗/改写
  createScriptTask: (script_text: string) =>
    request<TaskDetail>("/tasks", {
      method: "POST",
      body: JSON.stringify({ script_text }),
    }),

  updateTitle: (taskId: string, title: string) =>
    request(`/tasks/${taskId}/title`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),

  runStep: (taskId: string, step: string, gridCount?: number, ttsBackend?: string, asrBackend?: string) =>
    request(`/tasks/${taskId}/steps/${step}/run`, {
      method: "POST",
      body: JSON.stringify({
        grid_count: gridCount ?? null,
        tts_backend: ttsBackend || null,
        asr_backend: asrBackend || null,
      }),
    }),

  stepLogs: (taskId: string, step: string) =>
    request<{ logs: string[] }>(`/tasks/${taskId}/steps/${step}/logs`),

  runAll: (taskId: string, backends?: { asr_backend?: string; tts_backend?: string }) =>
    request(`/tasks/${taskId}/run-all`, {
      method: "POST",
      body: JSON.stringify({
        asr_backend: backends?.asr_backend || null,
        tts_backend: backends?.tts_backend || null,
      }),
    }),

  updateRewrite: (taskId: string, data: Partial<RewriteData>) =>
    request(`/tasks/${taskId}/artifacts/rewrite`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  updateSubtitles: (taskId: string, content: string) =>
    request(`/tasks/${taskId}/artifacts/subtitles`, {
      method: "PATCH",
      body: JSON.stringify({ content }),
    }),

  fileUrl: (taskId: string, filename: string) =>
    `${BASE}/files/${taskId}/${filename}`,

  sseUrl: (taskId: string, step: string) =>
    `${BASE}/tasks/${taskId}/steps/${step}/sse`,

  allSseUrl: (taskId: string) =>
    `${BASE}/tasks/${taskId}/run-all/sse`,

  getWenan: (taskId: string) => request<WenanData>(`/tasks/${taskId}/wenan`),

  runWenan: (taskId: string, op: WenanOp, body: WenanRunBody) =>
    request<Partial<WenanData>>(`/tasks/${taskId}/wenan/${op}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getStoryboard: (taskId: string) =>
    request<StoryboardData>(`/tasks/${taskId}/storyboard`),

  prepareStoryboard: (
    taskId: string,
    mode: string,
    source: "rewrite" | "dedup",
    imageCount?: number
  ) =>
    request<StoryboardData>(`/tasks/${taskId}/storyboard/prepare`, {
      method: "POST",
      body: JSON.stringify({ mode, source, image_count: imageCount ?? null }),
    }),

  generateStoryboard: (
    taskId: string,
    body: { grid_index: number; book_title: string; book_author: string; mode: string; style?: string }
  ) =>
    request(`/tasks/${taskId}/storyboard/generate`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getStoryboardVideos: (taskId: string) =>
    request<Record<string, StoryboardVideoVariant>>(`/tasks/${taskId}/storyboard/videos`),

  generateStoryboardVideo: (taskId: string, variant: "rewrite" | "dedup") =>
    request<StoryboardVideoVariant & { variant: string; image_count: number }>(
      `/tasks/${taskId}/storyboard/videos/generate`,
      {
        method: "POST",
        body: JSON.stringify({ variant }),
      }
    ),
};


