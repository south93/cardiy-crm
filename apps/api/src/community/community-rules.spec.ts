import {
  extractEmbeddedFileIds,
  injectResolvedFileUrls,
  sanitizeCommunityHtml,
  stripHtmlToText,
} from '@cardiy/shared';
import {
  canAcceptQaAnswer,
  communityPostCode,
  initialPostStatus,
  postStatusAfterEdit,
} from './community-rules';

describe('Quy tắc Cộng đồng chủ xe & Nội dung sàn (Vòng 4.4 — M34)', () => {
  it('bài biên tập của Sàn lên thẳng DA_DANG; bài của Chủ xe / Garage vào CHO_DUYET chờ kiểm duyệt A6.32; hỗ trợ lưu nháp NHAP', () => {
    expect(initialPostStatus('PLATFORM')).toBe('DA_DANG');
    expect(initialPostStatus('OWNER')).toBe('CHO_DUYET');
    expect(initialPostStatus('GARAGE')).toBe('CHO_DUYET');
    expect(initialPostStatus('PLATFORM', true)).toBe('NHAP');
    expect(initialPostStatus('GARAGE', true)).toBe('NHAP');
    expect(initialPostStatus('OWNER', true)).toBe('NHAP');

    expect(postStatusAfterEdit('DA_DANG', 'PLATFORM')).toBe('DA_DANG');
    expect(postStatusAfterEdit('NHAP', 'PLATFORM')).toBe('DA_DANG');
    expect(postStatusAfterEdit('TAM_AN', 'PLATFORM')).toBe('TAM_AN');
    expect(postStatusAfterEdit('DA_DANG', 'GARAGE')).toBe('DA_DANG');
    expect(postStatusAfterEdit('NHAP', 'GARAGE')).toBe('CHO_DUYET');
    expect(postStatusAfterEdit('DA_DANG', 'OWNER')).toBe('CHO_DUYET');
    expect(postStatusAfterEdit('BI_TU_CHOI', 'OWNER')).toBe('CHO_DUYET');
    expect(postStatusAfterEdit('DA_DANG', 'PLATFORM', true)).toBe('NHAP');
  });

  it('chỉ bài Hỏi đáp (QA) đang xuất bản mới chọn được câu trả lời giải đáp', () => {
    expect(canAcceptQaAnswer({ type: 'QA', status: 'DA_DANG' })).toBe(true);
    expect(canAcceptQaAnswer({ type: 'BLOG', status: 'DA_DANG' })).toBe(false);
    expect(canAcceptQaAnswer({ type: 'QA', status: 'CHO_DUYET' })).toBe(false);
    expect(communityPostCode(7)).toBe('BV000007');
  });

  it('WYSIWYG HTML: lọc sạch XSS, trích xuất và làm mới link R2 cho ảnh chèn trong bài', () => {
    const fid = '550e8400-e29b-41d4-a716-446655440000';
    const raw = `
      <h2>Quy trình bảo dưỡng phanh</h2>
      <script>alert('xss')</script>
      <p onclick="evil()">Kiểm tra <strong>má phanh</strong> và <a href="javascript:alert(1)">link độc</a> <a href="https://philongauto.southteam.co/cho">Sàn CARDIY</a>.</p>
      <figure><img data-file-id="${fid}" src="https://old-expired-url.example/old.webp" onerror="alert(1)" alt="Má phanh mới" /><figcaption>Ảnh thực tế tại trạm</figcaption></figure>
    `;
    const clean = sanitizeCommunityHtml(raw);
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('onerror');
    expect(clean).not.toContain('javascript:');
    expect(clean).toContain(`data-file-id="${fid}"`);
    expect(clean).toContain('href="https://philongauto.southteam.co/cho"');

    expect(extractEmbeddedFileIds(clean)).toEqual([fid]);
    const refreshed = injectResolvedFileUrls(clean, new Map([[fid, 'https://r2.example.com/fresh-signed.webp']]));
    expect(refreshed).toContain('src="https://r2.example.com/fresh-signed.webp"');

    const text = stripHtmlToText(clean);
    expect(text).toContain('Quy trình bảo dưỡng phanh');
    expect(text).not.toContain('<p>');
  });
});

