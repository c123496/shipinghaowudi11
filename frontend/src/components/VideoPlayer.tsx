import { api } from "../api/client";

export default function VideoPlayer({ src, taskId }: { src: string; taskId: string }) {
  return (
    <div className="flex flex-col items-center gap-4">
      <video
        src={src}
        controls
        className="rounded-xl bg-black"
        style={{ maxHeight: "480px", maxWidth: "270px" }}
      >
        您的浏览器不支持视频播放
      </video>
      <a
        href={src}
        download={`final_${taskId.slice(0, 8)}.mp4`}
        className="px-6 py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded-xl transition-colors flex items-center gap-2"
      >
        ⬇ 下载成片 MP4
      </a>
    </div>
  );
}
