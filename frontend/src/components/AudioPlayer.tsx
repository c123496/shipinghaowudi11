export default function AudioPlayer({ src }: { src: string }) {
  return (
    <div className="bg-gray-800 rounded-xl p-4">
      <p className="text-xs text-gray-500 mb-3">TTS 配音预览</p>
      <audio
        controls
        src={src}
        className="w-full"
        style={{ colorScheme: "dark" }}
      >
        您的浏览器不支持音频播放
      </audio>
    </div>
  );
}
