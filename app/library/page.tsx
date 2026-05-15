'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

interface Script {
  id: string;
  title: string;
  content: string;
  wordCount: number;
  tags: string[];
  emotionTone: string;
  bookName: string;
  createdAt: string;
  source: string;
}

export default function LibraryPage() {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [textContent, setTextContent] = useState('');
  const [titleInput, setTitleInput] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [filterBook, setFilterBook] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'book'>('book');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { fetchScripts(); }, []);

  async function fetchScripts() {
    setLoading(true);
    const res = await fetch('/api/scripts');
    const data = await res.json();
    setScripts(data);
    setLoading(false);
  }

  async function handleUpload() {
    if (!textContent.trim()) return;
    setUploading(true);
    try {
      const res = await fetch('/api/scripts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: textContent, title: titleInput }),
      });
      if (res.ok) {
        setTextContent('');
        setTitleInput('');
        setShowUpload(false);
        fetchScripts();
      } else {
        const err = await res.json();
        alert(err.error || '上传失败');
      }
    } catch (e) {
      alert('上传失败：' + String(e));
    }
    setUploading(false);
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setTextContent(text);
    if (!titleInput) setTitleInput(file.name.replace(/\.[^/.]+$/, ''));
    setShowUpload(true);
  }

  async function handleDelete(id: string) {
    if (!confirm('确定删除这篇文案？')) return;
    await fetch(`/api/scripts?id=${id}`, { method: 'DELETE' });
    fetchScripts();
  }

  const allTags = [...new Set(scripts.flatMap(s => s.tags))];
  const allBooks = [...new Set(scripts.filter(s => s.bookName).map(s => s.bookName))].sort();
  const noBookScripts = scripts.filter(s => !s.bookName);

  const filtered = scripts.filter(s => {
    if (filterTag && !s.tags.includes(filterTag)) return false;
    if (filterBook && s.bookName !== filterBook) return false;
    return true;
  });

  // Group by bookName
  const bookGroups: Record<string, Script[]> = {};
  for (const s of filtered) {
    const key = s.bookName || '__none__';
    if (!bookGroups[key]) bookGroups[key] = [];
    bookGroups[key].push(s);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">文案库</h1>
          <p className="text-muted text-sm mt-1">共 {scripts.length} 篇文案 | {allBooks.length} 个书目</p>
        </div>
        <div className="flex gap-2">
          <div className="flex border border-border rounded-lg overflow-hidden text-sm">
            <button
              onClick={() => setViewMode('book')}
              className={`px-3 py-1.5 ${viewMode === 'book' ? 'bg-primary text-white' : 'text-muted hover:bg-surface-hover'}`}
            >
              按书目
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 ${viewMode === 'list' ? 'bg-primary text-white' : 'text-muted hover:bg-surface-hover'}`}
            >
              全部
            </button>
          </div>
          <button
            onClick={() => setShowUpload(!showUpload)}
            className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-light transition-colors"
          >
            {showUpload ? '取消' : '+ 添加文案'}
          </button>
        </div>
      </div>

      {showUpload && (
        <div className="mb-6 p-5 bg-surface rounded-xl border border-border space-y-4">
          <div className="flex gap-3">
            <input
              type="text"
              placeholder="标题（留空自动提取）"
              value={titleInput}
              onChange={e => setTitleInput(e.target.value)}
              className="flex-1 px-3 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:border-primary"
            />
            <label className="px-3 py-2 border border-border rounded-lg text-sm text-muted cursor-pointer hover:bg-surface-hover">
              上传文件
              <input ref={fileRef} type="file" accept=".txt,.md" onChange={handleFileUpload} className="hidden" />
            </label>
          </div>
          <textarea
            placeholder="粘贴文案内容..."
            value={textContent}
            onChange={e => setTextContent(e.target.value)}
            rows={10}
            className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:border-primary resize-y"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowUpload(false)}
              className="px-4 py-2 text-sm text-muted hover:text-foreground"
            >
              取消
            </button>
            <button
              onClick={handleUpload}
              disabled={uploading || !textContent.trim()}
              className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-light disabled:opacity-50"
            >
              {uploading ? '正在分析并保存...' : '保存文案'}
            </button>
          </div>
        </div>
      )}

      {/* Book filter pills */}
      {allBooks.length > 0 && viewMode === 'book' && (
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => setFilterBook('')}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              !filterBook ? 'bg-primary text-white border-primary' : 'border-border text-muted hover:border-primary-light'
            }`}
          >
            全部书目
          </button>
          {allBooks.map(book => (
            <button
              key={book}
              onClick={() => setFilterBook(book === filterBook ? '' : book)}
              className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                filterBook === book ? 'bg-accent text-white border-accent' : 'border-border text-muted hover:border-primary-light'
              }`}
            >
              《{book}》({scripts.filter(s => s.bookName === book).length})
            </button>
          ))}
        </div>
      )}

      {/* Tag filter */}
      {viewMode === 'list' && allTags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => setFilterTag('')}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              !filterTag ? 'bg-primary text-white border-primary' : 'border-border text-muted hover:border-primary-light'
            }`}
          >
            全部
          </button>
          {allTags.map(tag => (
            <button
              key={tag}
              onClick={() => setFilterTag(tag === filterTag ? '' : tag)}
              className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                filterTag === tag ? 'bg-primary text-white border-primary' : 'border-border text-muted hover:border-primary-light'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <p className="text-muted text-sm">加载中...</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-muted">还没有文案，点击右上角添加第一篇</p>
        </div>
      ) : viewMode === 'book' ? (
        /* Book group view */
        <div className="space-y-6">
          {Object.entries(bookGroups).map(([book, items]) => (
            <div key={book}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-base font-bold text-foreground">
                  {book === '__none__' ? '未关联书目' : `《${book}》`}
                </span>
                <span className="text-xs text-muted bg-surface-hover px-2 py-0.5 rounded-full">
                  {items.length} 篇
                </span>
              </div>
              <div className="space-y-2">
                {items.map(script => (
                  <ScriptCard key={script.id} script={script} onDelete={handleDelete} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Flat list view */
        <div className="space-y-3">
          {filtered.map(script => (
            <ScriptCard key={script.id} script={script} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

function ScriptCard({ script, onDelete }: { script: Script; onDelete: (id: string) => void }) {
  return (
    <div className="group p-4 bg-surface rounded-xl border border-border hover:border-primary-light transition-all">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Link href={`/library/${script.id}`} className="font-semibold text-foreground hover:text-primary transition-colors">
              {script.title}
            </Link>
            {script.bookName && (
              <span className="text-xs bg-accent/10 text-accent px-2 py-0.5 rounded-full">
                《{script.bookName}》
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted">
            <span>{script.wordCount} 字</span>
            <span>{script.emotionTone}</span>
            <span>{new Date(script.createdAt).toLocaleDateString('zh-CN')}</span>
          </div>
          <p className="mt-2 text-sm text-muted line-clamp-2">{script.content.substring(0, 120)}...</p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {script.tags.map(tag => (
              <span key={tag} className="px-2 py-0.5 text-xs bg-surface-hover rounded text-muted">{tag}</span>
            ))}
          </div>
        </div>
        <button
          onClick={() => onDelete(script.id)}
          className="opacity-0 group-hover:opacity-100 px-2 py-1 text-xs text-muted hover:text-accent transition-all"
        >
          删除
        </button>
      </div>
    </div>
  );
}
