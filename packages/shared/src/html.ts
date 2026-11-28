/**
 * Xử lý nội dung HTML an toàn cho trình soạn thảo WYSIWYG bài viết Cộng đồng.
 * - Loại bỏ hoàn toàn thẻ nguy hiểm (<script>, <style>, <iframe>...) và thuộc tính sự kiện (onerror, onclick...) chống XSS.
 * - Giữ lại các thẻ định dạng biên tập chuẩn và thuộc tính `data-file-id` của hình ảnh lưu trên Cloudflare R2.
 */

const BLOCK_DROP_RE = /<\s*(script|style|iframe|object|embed|form|svg|math|meta|link)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
const SELF_DROP_RE = /<\s*(script|style|iframe|object|embed|form|input|button|textarea|select|meta|link)\b[^>]*\/?\s*>/gi;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'hr',
  'h2',
  'h3',
  'h4',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'figure',
  'figcaption',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'a',
  'img',
]);

const VOID_TAGS = new Set(['br', 'hr', 'img']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function escapeAttr(val: string): string {
  return val
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function getAttr(attrChunk: string, name: string): string | null {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>/]+))`, 'i');
  const m = attrChunk.match(re);
  if (!m) return null;
  return (m[1] ?? m[2] ?? m[3] ?? '').trim();
}

function stripControlAndSpace(url: string): string {
  let out = '';
  for (const ch of url) {
    const code = ch.charCodeAt(0);
    if (code > 0x20 && code !== 0x7f && !/\s/.test(ch)) {
      out += ch;
    }
  }
  return out;
}

function isSafeLinkUrl(url: string): boolean {
  const cleaned = stripControlAndSpace(url);
  return /^(https?:\/\/|\/|mailto:|tel:)/i.test(cleaned);
}

function isSafeImgSrc(url: string): boolean {
  const cleaned = stripControlAndSpace(url);
  return /^(https?:\/\/|\/)/i.test(cleaned);
}

/** Kiểm tra chuỗi có chứa thẻ HTML định dạng của trình soạn thảo hay không */
export function isRichHtml(content: string): boolean {
  return /<\s*(p|div|br|hr|h[1-6]|ul|ol|li|blockquote|pre|code|figure|img|strong|b|em|i|u|s|a)\b/i.test(content);
}

/** Làm sạch HTML bài viết Cộng đồng trước khi lưu DB và trước khi hiển thị */
export function sanitizeCommunityHtml(raw: string): string {
  if (!raw) return '';
  if (!isRichHtml(raw)) return raw.trim();

  let html = raw
    .replace(HTML_COMMENT_RE, '')
    .replace(BLOCK_DROP_RE, '')
    .replace(SELF_DROP_RE, '');

  html = html.replace(/<\s*(\/?)\s*([a-zA-Z0-9-]+)([^>]*)>/g, (_full, slash: string, rawTag: string, attrs: string) => {
    const isClosing = slash === '/';
    let tag = rawTag.toLowerCase();
    // Chuẩn hoá thẻ <div> hoặc <h1> do contentEditable sinh ra về <p> / <h2>
    if (tag === 'div') tag = 'p';
    if (tag === 'h1') tag = 'h2';
    if (tag === 'h5' || tag === 'h6') tag = 'h4';

    if (!ALLOWED_TAGS.has(tag)) return '';
    if (VOID_TAGS.has(tag)) {
      if (isClosing) return '';
      if (tag === 'br') return '<br />';
      if (tag === 'hr') return '<hr />';
      // tag === 'img'
      const rawFileId = getAttr(attrs, 'data-file-id');
      const fileId = rawFileId && UUID_RE.test(rawFileId) ? rawFileId.toLowerCase() : null;
      const rawSrc = getAttr(attrs, 'src');
      const src = rawSrc && isSafeImgSrc(rawSrc) ? rawSrc : null;
      if (!fileId && !src) return '';
      const rawAlt = getAttr(attrs, 'alt')?.slice(0, 200) ?? '';
      const parts = [
        fileId ? ` data-file-id="${escapeAttr(fileId)}"` : '',
        src ? ` src="${escapeAttr(src)}"` : '',
        ` alt="${escapeAttr(rawAlt)}"`,
        ' loading="lazy"',
      ];
      return `<img${parts.join('')} />`;
    }

    if (isClosing) return `</${tag}>`;

    if (tag === 'a') {
      const href = getAttr(attrs, 'href');
      if (!href || !isSafeLinkUrl(href)) return '<a>';
      return `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">`;
    }

    return `<${tag}>`;
  });

  return html.trim();
}

/** Chuyển nội dung HTML thành văn bản thuần để tạo tóm tắt ngắn, tìm kiếm và kiểm tra độ dài */
export function stripHtmlToText(input: string): string {
  if (!input) return '';
  return input
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|h[1-6]|li|blockquote|pre|figcaption)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/** Trích xuất danh sách UUID file ảnh (data-file-id) được chèn trong bài viết để kiểm tra quyền & ký lại link R2 */
export function extractEmbeddedFileIds(html: string): string[] {
  if (!html) return [];
  const out = new Set<string>();
  const re = /data-file-id="([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[1]) out.add(m[1].toLowerCase());
  }
  return [...out];
}

/** Thay thế thuộc tính src của các thẻ <img data-file-id="..."> bằng link ký mới nhất từ Cloudflare R2 / Storage */
export function injectResolvedFileUrls(html: string, urlByFileId: ReadonlyMap<string, string>): string {
  if (!html || !urlByFileId.size) return html;
  return html.replace(/<img\b([^>]*?)\/?\s*>/gi, (full, attrs: string) => {
    const fid = getAttr(attrs, 'data-file-id')?.toLowerCase();
    if (!fid) return full;
    const freshUrl = urlByFileId.get(fid);
    if (!freshUrl) return full;
    const alt = getAttr(attrs, 'alt')?.slice(0, 200) ?? '';
    return `<img data-file-id="${escapeAttr(fid)}" src="${escapeAttr(freshUrl)}" alt="${escapeAttr(alt)}" loading="lazy" />`;
  });
}
