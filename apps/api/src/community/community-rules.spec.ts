import {
  canAcceptQaAnswer,
  communityPostCode,
  initialPostStatus,
  postStatusAfterEdit,
} from './community-rules';

describe('Quy tắc Cộng đồng chủ xe & Nội dung sàn (Vòng 4.4 — M34)', () => {
  it('bài biên tập của Sàn lên thẳng DA_DANG; bài của Chủ xe / Garage vào CHO_DUYET chờ kiểm duyệt A6.32', () => {
    expect(initialPostStatus('PLATFORM')).toBe('DA_DANG');
    expect(initialPostStatus('OWNER')).toBe('CHO_DUYET');
    expect(initialPostStatus('GARAGE')).toBe('CHO_DUYET');

    expect(postStatusAfterEdit('DA_DANG', 'PLATFORM')).toBe('DA_DANG');
    expect(postStatusAfterEdit('TAM_AN', 'PLATFORM')).toBe('TAM_AN');
    expect(postStatusAfterEdit('DA_DANG', 'OWNER')).toBe('CHO_DUYET');
    expect(postStatusAfterEdit('BI_TU_CHOI', 'OWNER')).toBe('CHO_DUYET');
  });

  it('chỉ bài Hỏi đáp (QA) đang xuất bản mới chọn được câu trả lời giải đáp', () => {
    expect(canAcceptQaAnswer({ type: 'QA', status: 'DA_DANG' })).toBe(true);
    expect(canAcceptQaAnswer({ type: 'BLOG', status: 'DA_DANG' })).toBe(false);
    expect(canAcceptQaAnswer({ type: 'QA', status: 'CHO_DUYET' })).toBe(false);
    expect(communityPostCode(7)).toBe('BV000007');
  });
});
