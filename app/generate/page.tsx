'use client';

import { useState, useEffect } from 'react';

interface Script {
  id: string;
  title: string;
  content: string;
  wordCount: number;
  tags: string[];
  bookName: string;
}

export default function GeneratePage() {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [topic, setTopic] = useState('');
  const [angle, setAngle] = useState('历史叙事型');
  const [requirements, setRequirements] = useState('');
  const [selectedRefs, setSelectedRefs] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState('');
  const [filterBook, setFilterBook] = useState('');

  const angles = ['历史叙事型', '人物特写型', '情感共鸣型', '文化评论型', '故事反转型'];

  useEffect(() => {
    fetch('/api/scripts').then(r => r.json()).then(setScripts);
  }, []);

  const allBooks = [...new Set(scripts.filter(s => s.bookName).map(s => s.bookName))].sort();

  const filteredScripts = filterBook
    ? scripts.filter(s => s.bookName === filterBook)
    : scripts;

  function toggleRef(id: string) {
    setSelectedRefs(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : prev.length < 5 ? [...prev, id] : prev
    );
  }

  async function handleGenerate() {
    if (!topic.trim()) return;
    setGenerating(true);
    setResult('');
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topic.trim(),
          angle,
          referenceIds: selectedRefs,
          requirements: requirements.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.content) setResult(data.content);
      else alert(data.error || '生成失败');
    } catch (e) {
      alert('生成失败：' + String(e));
    }
    setGenerating(false);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground mb-6">文案生成</h1>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">主题</label>
            <input
              type="text"
              placeholder="如：钱锺书的学人风骨"
              value={topic}
              onChange={e => setTopic(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:border-primary"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">创作角度</label>
            <div className="flex flex-wrap gap-2">
              {angles.map(a => (
                <button
                  key={a}
                  onClick={() => setAngle(a)}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                    angle === a ? 'bg-primary text-white border-primary' : 'border-border text-muted hover:border-primary-light'
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">额外要求（可选）</label>
            <textarea
              placeholder="如：重点突出他在困难时期的坚持..."
              value={requirements}
              onChange={e => setRequirements(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:border-primary resize-y"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              风格参考（选择 1-5 篇，已选 {selectedRefs.length}）
            </label>

            {/* Book filter */}
            {allBooks.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                <button
                  onClick={() => setFilterBook('')}
                  className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                    !filterBook ? 'bg-primary text-white border-primary' : 'border-border text-muted hover:border-primary-light'
                  }`}
                >
                  全部
                </button>
                {allBooks.map(book => (
                  <button
                    key={book}
                    onClick={() => setFilterBook(book === filterBook ? '' : book)}
                    className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                      filterBook === book ? 'bg-accent text-white border-accent' : 'border-border text-muted hover:border-primary-light'
                    }`}
                  >
                    《{book}》
                  </button>
                ))}
              </div>
            )}

            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              {filteredScripts.map(script => (
                <div
                  key={script.id}
                  onClick={() => toggleRef(script.id)}
                  className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors text-sm ${
                    selectedRefs.includes(script.id)
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary-light'
                  }`}
                >
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${selectedRefs.includes(script.id) ? 'bg-primary' : 'bg-border'}`} />
                  <span className="truncate flex-1">{script.title}</span>
                  {script.bookName && (
                    <span className="text-xs text-accent flex-shrink-0">《{script.bookName}》</span>
                  )}
                  <span className="text-xs text-muted flex-shrink-0">{script.wordCount}字</span>
                </div>
              ))}
              {scripts.length === 0 && <p className="text-xs text-muted py-4 text-center">文案库为空，请先添加文案</p>}
            </div>
          </div>

          <button
            onClick={handleGenerate}
            disabled={generating || !topic.trim()}
            className="w-full py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-light disabled:opacity-50"
          >
            {generating ? '正在生成...' : '生成文案'}
          </button>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-foreground mb-4">生成结果</h2>
        {result ? (
          <div className="p-5 bg-surface rounded-xl border border-border">
            <div className="whitespace-pre-wrap text-sm leading-7 text-foreground">{result}</div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => navigator.clipboard.writeText(result)}
                className="px-3 py-1.5 text-xs border border-border rounded-lg text-muted hover:text-foreground"
              >
                复制全文
              </button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(result);
                  window.location.href = '/humanize';
                }}
                className="px-3 py-1.5 text-xs bg-primary text-white rounded-lg hover:bg-primary-light"
              >
                发送至人性化改写
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-64 bg-surface rounded-xl border border-border text-muted text-sm">
            {generating ? '正在创作中...' : '在左侧填写主题后点击生成'}
          </div>
        )}
      </div>
    </div>
  );
}
