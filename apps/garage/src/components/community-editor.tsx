'use client';

/* eslint-disable @next/next/no-img-element */

import { isRichHtml, sanitizeCommunityHtml, stripHtmlToText } from '@cardiy/shared';
import { Alert, Badge, Button, Dialog, Input, Spinner } from '@cardiy/ui';
import {
  Bold,
  Eraser,
  Heading2,
  Heading3,
  Headphones,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListMusic,
  ListOrdered,
  Monitor,
  Pilcrow,
  Quote,
  Smartphone,
  Trash2,
  Underline,
  Upload,
} from 'lucide-react';
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { ApiError } from '@/lib/api';
import {
  COMMUNITY_AUTHOR_UI,
  COMMUNITY_TOPICS,
  COMMUNITY_TYPE_UI,
  uploadCommunityPhoto,
  type CommunityAuthorKind,
  type CommunityPostType,
  type PlaylistItem,
} from '@/lib/community';

export type CommunityUploadFn = (file: File) => Promise<{ id: string; url: string }>;

function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toEditableHtml(value: string): string {
  if (!value || !value.trim()) return '';
  if (isRichHtml(value)) return sanitizeCommunityHtml(value);
  return value
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtmlText(block).replace(/\n/g, '<br />')}</p>`)
    .join('');
}

/** Khung chọn & xem trước Ảnh bìa bài viết tỷ lệ 16:9 (tự chuyển WebP & đẩy lên Cloudflare R2) */
export function CoverImageField({
  label = 'Ảnh bìa bài viết (tỷ lệ 16:9 — tối ưu cho điện thoại & máy tính)',
  coverUrl,
  onChange,
  uploadFn = uploadCommunityPhoto,
  testIdPrefix = 'community-cover',
}: {
  label?: string;
  coverUrl: string | null;
  onChange: (next: { id: string | null; url: string | null }) => void;
  uploadFn?: CommunityUploadFn;
  testIdPrefix?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSelect(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setErr(null);
    try {
      const uploaded = await uploadFn(file);
      onChange({ id: uploaded.id, url: uploaded.url });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Tải ảnh bìa thất bại');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="space-y-1.5" data-testid={`${testIdPrefix}-field`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <span className="text-[11px] text-slate-400">Tự động nén WebP nhẹ & lưu Cloudflare R2</span>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        data-testid={`${testIdPrefix}-input`}
        onChange={(e) => void handleSelect(e.target.files?.[0])}
      />

      {coverUrl ? (
        <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-900/5">
          <div className="aspect-[16/9] max-h-56 w-full overflow-hidden bg-slate-100">
            <img
              src={coverUrl}
              alt="Ảnh bìa bài viết"
              className="h-full w-full object-cover"
              data-testid={`${testIdPrefix}-preview`}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/80 bg-white/95 px-3 py-2">
            <span className="text-xs text-emerald-700">Đã gắn ảnh bìa chuẩn khung 16:9</span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                className="px-3 py-1 text-xs"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
                data-testid={`${testIdPrefix}-change-btn`}
              >
                <Upload className="h-3.5 w-3.5" /> {uploading ? 'Đang tải…' : 'Đổi ảnh bìa'}
              </Button>
              <Button
                variant="outline"
                className="px-3 py-1 text-xs text-rose-600"
                disabled={uploading}
                onClick={() => onChange({ id: null, url: null })}
                data-testid={`${testIdPrefix}-remove-btn`}
              >
                <Trash2 className="h-3.5 w-3.5" /> Xoá
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          className="flex aspect-[16/9] max-h-40 w-full flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/70 px-4 text-center transition hover:border-brand-400 hover:bg-sky-50/40 disabled:opacity-60"
          data-testid={`${testIdPrefix}-upload-btn`}
        >
          {uploading ? (
            <>
              <Spinner className="h-5 w-5 text-brand-600" />
              <span className="text-xs font-medium text-brand-700">Đang chuyển sang WebP & tải lên Cloudflare R2…</span>
            </>
          ) : (
            <>
              <ImagePlus className="h-6 w-6 text-brand-600" />
              <span className="text-sm font-medium text-slate-700">Bấm để chọn ảnh bìa bài viết</span>
              <span className="text-xs text-slate-400">Khuyến nghị ảnh ngang 16:9 (JPG, PNG, WebP — tối đa 10 MB)</span>
            </>
          )}
        </button>
      )}

      {err && <Alert>{err}</Alert>}
    </div>
  );
}

/** Trình soạn thảo WYSIWYG không phụ thuộc thư viện ngoài, hỗ trợ chèn/dán/kéo-thả ảnh nén WebP lên Cloudflare R2 */
export function WysiwygEditor({
  label,
  value,
  onChange,
  placeholder = 'Nhập nội dung bài viết, định dạng tiêu đề, danh sách hoặc chèn hình ảnh minh hoạ…',
  uploadFn = uploadCommunityPhoto,
  minHeightClass = 'min-h-[220px]',
  testId = 'community-wysiwyg',
}: {
  label: string;
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  uploadFn?: CommunityUploadFn;
  minHeightClass?: string;
  testId?: string;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const lastEmittedRef = useRef<string | null>(null);

  const [uploadingImg, setUploadingImg] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('https://');

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (lastEmittedRef.current !== null && value === lastEmittedRef.current) return;
    const html = toEditableHtml(value);
    if (el.innerHTML !== html) {
      el.innerHTML = html;
    }
    lastEmittedRef.current = value;
  }, [value]);

  function saveSelection() {
    if (typeof window === 'undefined') return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (editorRef.current?.contains(range.commonAncestorContainer)) {
      savedRangeRef.current = range.cloneRange();
    }
  }

  function restoreSelection() {
    const el = editorRef.current;
    if (!el || typeof window === 'undefined') return;
    el.focus();
    const sel = window.getSelection();
    if (!sel) return;
    if (savedRangeRef.current && el.contains(savedRangeRef.current.commonAncestorContainer)) {
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
    }
  }

  function emitChange() {
    const el = editorRef.current;
    if (!el) return;
    const raw = el.innerHTML;
    const hasImg = /<img\b/i.test(raw);
    const next = !hasImg && stripHtmlToText(raw).length === 0 ? '' : raw;
    if (next === '' && el.innerHTML !== '') {
      // Giữ rỗng thật sự khi chỉ còn <br> để hiện placeholder
      el.innerHTML = '';
    }
    lastEmittedRef.current = next;
    onChange(next);
  }

  function exec(command: string, arg?: string) {
    restoreSelection();
    document.execCommand(command, false, arg);
    saveSelection();
    emitChange();
  }

  function insertHtmlAtCursor(htmlSnippet: string) {
    const el = editorRef.current;
    if (!el) return;
    restoreSelection();
    const sel = typeof window !== 'undefined' ? window.getSelection() : null;
    if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
      document.execCommand('insertHTML', false, htmlSnippet);
    } else {
      el.insertAdjacentHTML('beforeend', htmlSnippet);
    }
    saveSelection();
    emitChange();
  }

  async function uploadAndInsertImages(files: File[]) {
    const imageFiles = files.filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i.test(f.name));
    if (!imageFiles.length) return;
    setUploadingImg(true);
    setErr(null);
    try {
      for (const file of imageFiles) {
        const up = await uploadFn(file);
        const cleanAlt = escapeHtmlText(file.name.replace(/\.[^./\\]+$/, '').slice(0, 120) || 'Ảnh minh hoạ bài viết');
        insertHtmlAtCursor(
          `<figure><img data-file-id="${escapeHtmlText(up.id)}" src="${escapeHtmlText(up.url)}" alt="${cleanAlt}" loading="lazy" /></figure><p><br /></p>`,
        );
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Chèn hình ảnh thất bại');
    } finally {
      setUploadingImg(false);
      if (imgInputRef.current) imgInputRef.current.value = '';
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLDivElement>) {
    const files = Array.from(e.clipboardData?.files ?? []);
    const imgs = files.filter((f) => f.type.startsWith('image/'));
    if (imgs.length > 0) {
      e.preventDefault();
      saveSelection();
      void uploadAndInsertImages(imgs);
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    const files = Array.from(e.dataTransfer?.files ?? []);
    const imgs = files.filter((f) => f.type.startsWith('image/'));
    if (imgs.length > 0) {
      e.preventDefault();
      void uploadAndInsertImages(imgs);
    }
  }

  function applyLink() {
    const trimmed = linkUrl.trim();
    if (trimmed && /^(https?:\/\/|\/|mailto:|tel:)/i.test(trimmed)) {
      exec('createLink', trimmed);
    }
    setLinkOpen(false);
    setLinkUrl('https://');
  }

  const toolBtn =
    'inline-flex h-8 items-center justify-center gap-1 rounded-lg px-2 text-xs font-medium text-slate-700 transition hover:bg-slate-200/70 disabled:opacity-50';

  return (
    <div className="space-y-1.5" data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          onClick={() => editorRef.current?.focus()}
          className="cursor-pointer text-sm font-medium text-slate-700"
        >
          {label}
        </div>
        <span className="text-[11px] text-slate-400">Hỗ trợ dán / kéo-thả ảnh trực tiếp (WebP → R2)</span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
        <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-slate-50 px-2 py-1.5" role="toolbar" aria-label="Thanh định dạng bài viết">
          <button
            type="button"
            title="Tiêu đề lớn (H2)"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec('formatBlock', 'H2')}
            className={toolBtn}
            data-testid={`${testId}-h2`}
          >
            <Heading2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Tiêu đề phụ (H3)"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec('formatBlock', 'H3')}
            className={toolBtn}
            data-testid={`${testId}-h3`}
          >
            <Heading3 className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Đoạn văn thường"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec('formatBlock', 'P')}
            className={toolBtn}
          >
            <Pilcrow className="h-4 w-4" />
          </button>

          <span className="mx-1 h-4 w-px bg-slate-200" />

          <button
            type="button"
            title="In đậm"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec('bold')}
            className={toolBtn}
            data-testid={`${testId}-bold`}
          >
            <Bold className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="In nghiêng"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec('italic')}
            className={toolBtn}
            data-testid={`${testId}-italic`}
          >
            <Italic className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Gạch chân"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec('underline')}
            className={toolBtn}
          >
            <Underline className="h-4 w-4" />
          </button>

          <span className="mx-1 h-4 w-px bg-slate-200" />

          <button
            type="button"
            title="Danh sách chấm đầu dòng"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec('insertUnorderedList')}
            className={toolBtn}
            data-testid={`${testId}-ul`}
          >
            <List className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Danh sách đánh số"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec('insertOrderedList')}
            className={toolBtn}
          >
            <ListOrdered className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Khối trích dẫn / lưu ý"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec('formatBlock', 'BLOCKQUOTE')}
            className={toolBtn}
            data-testid={`${testId}-quote`}
          >
            <Quote className="h-4 w-4" />
          </button>

          <span className="mx-1 h-4 w-px bg-slate-200" />

          <button
            type="button"
            title="Gắn liên kết"
            onMouseDown={(e) => {
              e.preventDefault();
              saveSelection();
            }}
            onClick={() => setLinkOpen((v) => !v)}
            className={toolBtn}
          >
            <Link2 className="h-4 w-4" />
          </button>

          <button
            type="button"
            title="Chèn hình ảnh vào bài viết (WebP -> Cloudflare R2)"
            disabled={uploadingImg}
            onMouseDown={(e) => {
              e.preventDefault();
              saveSelection();
            }}
            onClick={() => imgInputRef.current?.click()}
            className={`${toolBtn} bg-brand-50 text-brand-700 hover:bg-brand-100`}
            data-testid={`${testId}-insert-image-btn`}
          >
            {uploadingImg ? <Spinner className="h-3.5 w-3.5 text-brand-600" /> : <ImagePlus className="h-4 w-4" />}
            <span>{uploadingImg ? 'Đang tải ảnh…' : 'Chèn ảnh'}</span>
          </button>

          <button
            type="button"
            title="Xoá định dạng đoạn bôi đen"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec('removeFormat')}
            className={`${toolBtn} ml-auto text-slate-500`}
          >
            <Eraser className="h-4 w-4" />
          </button>

          <input
            ref={imgInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            data-testid={`${testId}-image-input`}
            onChange={(e) => void uploadAndInsertImages(Array.from(e.target.files ?? []))}
          />
        </div>

        {linkOpen && (
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-sky-50/60 px-3 py-2">
            <Input
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://philongauto.southteam.co/cho/..."
              className="h-8 flex-1 bg-white py-1 text-xs"
            />
            <Button className="px-3 py-1 text-xs" onClick={applyLink}>
              Gắn link
            </Button>
            <Button variant="outline" className="px-3 py-1 text-xs" onClick={() => setLinkOpen(false)}>
              Đóng
            </Button>
          </div>
        )}

        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={label}
          data-placeholder={placeholder}
          data-testid={`${testId}-editor`}
          onInput={emitChange}
          onBlur={saveSelection}
          onKeyUp={saveSelection}
          onMouseUp={saveSelection}
          onPaste={handlePaste}
          onDrop={handleDrop}
          className={`cd-wysiwyg-surface cd-article-prose ${minHeightClass} max-h-[55vh] w-full overflow-y-auto px-3.5 py-3 focus:outline-none`}
        />
      </div>

      {err && <Alert>{err}</Alert>}
    </div>
  );
}

/** Hiển thị nội dung bài viết Cộng đồng (tương thích cả HTML từ WYSIWYG lẫn bài văn bản thuần cũ) */
export function CommunityRichContent({
  content,
  className = '',
  testId,
}: {
  content: string;
  className?: string;
  testId?: string;
}) {
  if (isRichHtml(content)) {
    const clean = sanitizeCommunityHtml(content);
    return (
      <div
        className={`cd-article-prose ${className}`}
        data-testid={testId}
        dangerouslySetInnerHTML={{ __html: clean }}
      />
    );
  }
  return (
    <div
      className={`whitespace-pre-line text-[15px] leading-7 text-slate-800 sm:text-base sm:leading-relaxed ${className}`}
      data-testid={testId}
    >
      {content}
    </div>
  );
}

export interface CommunityPreviewDraft {
  title: string;
  summary?: string | null;
  content: string;
  coverUrl?: string | null;
  type: CommunityPostType;
  topic: string;
  authorKind: CommunityAuthorKind;
  authorName: string;
  durationMinutes?: number | null;
  mediaUrl?: string | null;
  playlistItems?: PlaylistItem[];
  permanentUrl?: string | null;
  isDraft?: boolean;
}

/** Hộp thoại Xem trước bài viết với chế độ chuyển đổi Điện thoại (390px) / Máy tính trước khi đăng hoặc cập nhật */
export function CommunityPreviewDialog({
  open,
  onClose,
  draft,
}: {
  open: boolean;
  onClose: () => void;
  draft: CommunityPreviewDraft | null;
}) {
  const [viewport, setViewport] = useState<'mobile' | 'desktop'>('mobile');

  if (!draft) return null;

  const tp = COMMUNITY_TYPE_UI[draft.type];
  const au = COMMUNITY_AUTHOR_UI[draft.authorKind];
  const topicLabel = COMMUNITY_TOPICS.find((t) => t.code === draft.topic)?.label ?? draft.topic;
  const playlist = (draft.playlistItems ?? []).filter((it) => it.title.trim().length > 0);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Xem trước bài viết trên Cộng đồng"
      wide
      footer={
        <Button variant="outline" onClick={onClose} data-testid="community-preview-close">
          Đóng xem trước
        </Button>
      }
    >
      <div className="space-y-4" data-testid="community-preview-dialog">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-100 p-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setViewport('mobile')}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                viewport === 'mobile' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600 hover:bg-white/60'
              }`}
              data-testid="community-preview-mobile-btn"
            >
              <Smartphone className="h-3.5 w-3.5" /> Điện thoại
            </button>
            <button
              type="button"
              onClick={() => setViewport('desktop')}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                viewport === 'desktop' ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600 hover:bg-white/60'
              }`}
              data-testid="community-preview-desktop-btn"
            >
              <Monitor className="h-3.5 w-3.5" /> Máy tính
            </button>
          </div>
          {draft.permanentUrl && (
            <span className="truncate px-2 font-mono text-[11px] text-slate-600" data-testid="community-preview-url">
              Link giữ nguyên: {draft.permanentUrl}
            </span>
          )}
        </div>

        <div
          className={
            viewport === 'mobile'
              ? 'mx-auto max-w-[390px] rounded-[28px] border-4 border-slate-800 bg-white p-4 shadow-lg'
              : 'rounded-2xl border border-slate-200 bg-white p-6'
          }
          data-testid={`community-preview-frame-${viewport}`}
        >
          <article className="space-y-4">
            <div className="flex flex-wrap items-center gap-1.5">
              {draft.isDraft && <Badge tone="peach">Bản xem trước</Badge>}
              <Badge tone={tp.tone}>{tp.label}</Badge>
              <Badge tone={au.tone}>{draft.authorName}</Badge>
              <Badge tone="slate">{topicLabel}</Badge>
            </div>

            <h1 className={viewport === 'mobile' ? 'text-xl font-bold leading-snug text-slate-900' : 'text-2xl font-bold text-slate-900'}>
              {draft.title.trim() || '(Chưa nhập tiêu đề bài viết)'}
            </h1>

            {draft.summary?.trim() && (
              <p className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm font-medium text-slate-600">{draft.summary.trim()}</p>
            )}

            {draft.coverUrl && (
              <div className="aspect-[16/9] w-full overflow-hidden rounded-2xl bg-slate-100">
                <img src={draft.coverUrl} alt={draft.title || 'Ảnh bìa'} className="h-full w-full object-cover" />
              </div>
            )}

            {(draft.type === 'AUDIO' || draft.type === 'PLAYLIST') && playlist.length > 0 && (
              <div className="space-y-2 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-3.5 text-xs">
                <div className="flex items-center justify-between gap-2 font-semibold text-indigo-950">
                  <span className="inline-flex items-center gap-1.5">
                    {draft.type === 'AUDIO' ? <Headphones className="h-4 w-4 text-indigo-600" /> : <ListMusic className="h-4 w-4 text-emerald-600" />}
                    {draft.type === 'AUDIO' ? 'Danh mục chương Sách nói' : 'Danh sách tập Playlist'}
                  </span>
                  {draft.durationMinutes ? <span className="text-indigo-700">{draft.durationMinutes} phút</span> : null}
                </div>
                <ol className="divide-y divide-indigo-100 rounded-xl bg-white px-3 py-1">
                  {playlist.map((it, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 py-2">
                      <span className="font-medium text-slate-800">
                        #{i + 1} {it.title}
                      </span>
                      {it.duration && <span className="font-mono text-slate-500">{it.duration}</span>}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            <CommunityRichContent
              content={draft.content || 'Chưa có nội dung chi tiết.'}
              testId="community-preview-content"
            />
          </article>
        </div>
      </div>
    </Dialog>
  );
}
