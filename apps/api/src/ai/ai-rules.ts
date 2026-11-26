import { searchKey } from '@cardiy/shared';

export type AiSuggestionKindCode = 'VEHICLE_SUMMARY' | 'QUOTE_SUGGESTION' | 'TECH_QA';
export type AiSuggestionStatusCode = 'DE_XUAT' | 'DA_AP_DUNG' | 'BO_QUA';

export interface SuggestedQuoteLine {
  kind: 'PHU_TUNG' | 'DICH_VU';
  productId: string | null;
  code: string | null;
  name: string;
  unit: string | null;
  quantity: number;
  unitPrice: number;
  onHandStock: number | null;
  reason: string;
}

const STOPWORDS = new Set([
  'va',
  'cua',
  'cho',
  'khi',
  'bi',
  'xe',
  'oto',
  'can',
  'nho',
  'hoi',
  'xem',
  'giup',
  'voi',
  'tai',
  'tren',
  'duoi',
  'trong',
  'ngoai',
  'nhung',
  'mot',
  'cac',
]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Nguyên tắc bắt buộc 1.4 #8: Che toàn bộ thông tin định danh cá nhân (SĐT, Email, CCCD/MST, Họ tên, Địa chỉ)
 * trước khi đóng gói ngữ cảnh gửi tới mô hình AI.
 */
export function redactPiiForAi(
  rawText: string,
  knownSecrets?: {
    names?: (string | null | undefined)[];
    addresses?: (string | null | undefined)[];
  },
): { text: string; maskedCount: number } {
  if (!rawText) return { text: '', maskedCount: 0 };
  let maskedCount = 0;
  let out = rawText;

  // 1. Email
  out = out.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, () => {
    maskedCount += 1;
    return '[EMAIL_ĐÃ_CHE]';
  });

  // 2. Số điện thoại Việt Nam (09x, 03x, 07x, 08x, 05x, +84...)
  out = out.replace(/(?<!\d)(?:\+84|84(?=[\s.-]?\d{9}\b)|0)(?:[\s.-]?\d){8,9}\b/g, () => {
    maskedCount += 1;
    return '[SĐT_ĐÃ_CHE]';
  });

  // 3. CCCD / CMND / Mã số thuế (9–13 chữ số liền nhau, không phải tiền VND đứng trước chữ đ/vnd/km)
  out = out.replace(/\b\d{9,13}\b(?!\s*(?:đ|d|vnd|km))/gi, () => {
    maskedCount += 1;
    return '[MÃ_ĐỊNH_DANH_ĐÃ_CHE]';
  });

  // 4. Địa chỉ & Họ tên khách hàng đã biết trong hồ sơ
  for (const addr of knownSecrets?.addresses ?? []) {
    const clean = addr?.trim();
    if (clean && clean.length >= 4) {
      const re = new RegExp(escapeRegExp(clean), 'gi');
      out = out.replace(re, () => {
        maskedCount += 1;
        return '[ĐỊA_CHỈ_ĐÃ_CHE]';
      });
    }
  }

  for (const name of knownSecrets?.names ?? []) {
    const clean = name?.trim();
    if (clean && clean.length >= 3) {
      const re = new RegExp(escapeRegExp(clean), 'gi');
      out = out.replace(re, () => {
        maskedCount += 1;
        return '[KHÁCH_HÀNG_ĐÃ_CHE]';
      });
    }
  }

  return { text: out, maskedCount };
}

export function extractKeywords(text: string): string[] {
  const norm = searchKey(text);
  const tokens = norm
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  return [...new Set(tokens)];
}

/** Mở rộng từ khoá triệu chứng sang nhóm phụ tùng / dịch vụ tương ứng */
function expandSymptomPhrases(normSymptoms: string): string[] {
  const phrases: string[] = [];
  if (/(dieu hoa|kem mat|mat lanh|nong|mui hoi|gian lanh)/.test(normSymptoms)) {
    phrases.push('loc gio dieu hoa', 'dieu hoa', 'gas lanh', 'gian lanh');
  }
  if (/(phanh|thang|keu ket|rit|rung ban dap)/.test(normSymptoms)) {
    phrases.push('ma phanh', 'dau phanh', 'bao duong phanh', 'dia phanh');
  }
  if (/(bao duong|thay dau|thay nhot|dinh ky|van km|000km|000 km)/.test(normSymptoms)) {
    phrases.push('dau', 'nhot', 'castrol', 'mobil', 'loc dau', 'loc gio', 'bao duong');
  }
  if (/(ac quy|kho no|de dai|de yeu|het binh|dien)/.test(normSymptoms)) {
    phrases.push('ac quy', 'binh', 'gs', 'varta', 'kiem tra dien');
  }
  if (/(lop|vo xe|rung vo lang|mon lop|dao lop|ap suat)/.test(normSymptoms)) {
    phrases.push('lop', 'michelin', 'bridgestone', 'can bang dong', 'dao lop');
  }
  return phrases;
}

export function scoreKnowledgeDocs<
  T extends { code: string; title: string; category: string; content: string; tags: string[]; searchText: string; make?: string | null },
>(query: string, docs: readonly T[], vehicleMake?: string | null): T[] {
  const tokens = extractKeywords(query);
  const normQuery = searchKey(query);
  const normMake = vehicleMake ? searchKey(vehicleMake) : '';

  return docs
    .map((d) => {
      let score = 0;
      const docKey = d.searchText || searchKey(d.code, d.title, d.category, d.content, ...d.tags);
      for (const tag of d.tags) {
        const nk = searchKey(tag);
        if (nk && normQuery.includes(nk)) score += 6;
      }
      for (const tk of tokens) {
        if (searchKey(d.title).includes(tk)) score += 3;
        else if (docKey.includes(tk)) score += 1;
      }
      if (d.make && normMake && searchKey(d.make).includes(normMake)) score += 4;
      return { doc: d, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.doc);
}

export function matchCatalogSuggestions(opts: {
  symptoms: string;
  vehicleMake?: string | null;
  priceZone: string;
  products: readonly {
    id: string;
    code: string;
    name: string;
    kind: 'PHU_TUNG' | 'DICH_VU';
    unit: string | null;
    salePrice: number;
    salePriceBd: number | null;
    vehicleMakes: string[];
    searchText: string;
    onHand: number;
  }[];
}): SuggestedQuoteLine[] {
  const normSymptoms = searchKey(opts.symptoms);
  const tokens = extractKeywords(opts.symptoms);
  const expanded = expandSymptomPhrases(normSymptoms);
  const normMake = opts.vehicleMake ? searchKey(opts.vehicleMake) : '';

  const scored = opts.products
    .filter((p) => {
      if (!p.vehicleMakes.length || !normMake) return true;
      return p.vehicleMakes.some((m) => searchKey(m).includes(normMake) || normMake.includes(searchKey(m)));
    })
    .map((p) => {
      const pKey = p.searchText || searchKey(p.code, p.name);
      let score = 0;
      let matchedReason = 'Khớp mô tả triệu chứng / yêu cầu kiểm tra';

      for (const ph of expanded) {
        if (pKey.includes(ph)) {
          score += 6;
          matchedReason = `Phù hợp chẩn đoán nhóm "${ph}"`;
        }
      }
      for (const tk of tokens) {
        if (pKey.includes(tk)) score += 3;
      }
      if (p.kind === 'PHU_TUNG' && p.onHand > 0 && score > 0) score += 2;
      if (normMake && p.vehicleMakes.length > 0 && score > 0) score += 2;

      const unitPrice = opts.priceZone === 'BD' && p.salePriceBd !== null ? p.salePriceBd : p.salePrice;
      return { p, score, unitPrice, matchedReason };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const lines: SuggestedQuoteLine[] = scored.map(({ p, unitPrice, matchedReason }) => ({
    kind: p.kind,
    productId: p.id,
    code: p.code,
    name: p.name,
    unit: p.unit ?? (p.kind === 'DICH_VU' ? 'lần' : 'cái'),
    quantity: 1,
    unitPrice,
    onHandStock: p.kind === 'PHU_TUNG' ? p.onHand : null,
    reason: p.kind === 'PHU_TUNG' ? `${matchedReason} (Tồn chi nhánh: ${p.onHand})` : matchedReason,
  }));

  // Bổ sung dòng công kiểm tra / bảo dưỡng tiêu chuẩn nếu chưa có dòng DICH_VU nào
  if (!lines.some((l) => l.kind === 'DICH_VU')) {
    const isMajorMaint = /(40000|40\.000|4 van|cap lon)/.test(normSymptoms);
    lines.push({
      kind: 'DICH_VU',
      productId: null,
      code: null,
      name: isMajorMaint ? 'Công bảo dưỡng định kỳ cấp lớn & chẩn đoán tổng thể' : 'Công kiểm tra kỹ thuật & xử lý theo triệu chứng',
      unit: 'gói',
      quantity: 1,
      unitPrice: isMajorMaint ? 650_000 : 250_000,
      onHandStock: null,
      reason: 'Nhân công kỹ thuật đề xuất đi kèm (nhân viên duyệt trước khi ghi vào đơn)',
    });
  }

  return lines;
}

export function buildHeuristicVehicleSummary(ctx: {
  plateMaskedOrCode: string;
  makeModelYear: string;
  odometerKm: number | null;
  registrationDaysLeft: number | null;
  insuranceDaysLeft: number | null;
  orders: readonly {
    code: string;
    date: string;
    km: number | null;
    status: string;
    items: string[];
    replaceAlerts: string[];
    attentionAlerts: string[];
  }[];
}): string {
  const lines: string[] = [];
  lines.push(`1. HỒ SƠ KỸ THUẬT XE (${ctx.plateMaskedOrCode}): ${ctx.makeModelYear || 'Chưa cập nhật dòng xe'}`);
  lines.push(`   • ODO ghi nhận gần nhất: ${ctx.odometerKm !== null ? `${ctx.odometerKm.toLocaleString('vi-VN')} km` : 'Chưa ghi số km'}`);
  lines.push(`   • Tổng số lần vào xưởng: ${ctx.orders.length} lệnh sửa chữa`);

  if (ctx.orders.length > 0) {
    lines.push('\n2. LỊCH SỬ BẢO DƯỠNG & SỬA CHỮA GẦN ĐÂY:');
    for (const o of ctx.orders.slice(0, 4)) {
      const kmText = o.km !== null ? ` (${o.km.toLocaleString('vi-VN')} km)` : '';
      const itemSummary = o.items.length ? o.items.slice(0, 4).join(', ') : 'Chưa kê hạng mục';
      lines.push(`   • ${o.code} [${o.date}]${kmText}: ${itemSummary}`);
    }
  } else {
    lines.push('\n2. LỊCH SỬ BẢO DƯỠNG: Xe lần đầu tiếp nhận trên hệ thống, chưa có lịch sử RO trước đó.');
  }

  const allReplace = [...new Set(ctx.orders.flatMap((o) => o.replaceAlerts))];
  const allAttention = [...new Set(ctx.orders.flatMap((o) => o.attentionAlerts))];
  if (allReplace.length || allAttention.length) {
    lines.push('\n3. LƯU Ý TỪ PHIẾU KIỂM TRA ĐIỆN TỬ TRƯỚC ĐÓ:');
    if (allReplace.length) lines.push(`   • Cần thay thế: ${allReplace.join(', ')}`);
    if (allAttention.length) lines.push(`   • Cần theo dõi: ${allAttention.join(', ')}`);
  }

  lines.push('\n4. KHUYẾN NGHỊ TIẾP ĐÓN KỲ NÀY:');
  if (ctx.odometerKm !== null) {
    const nextMilestone = (Math.floor(ctx.odometerKm / 5000) + 1) * 5000;
    const isMajor = nextMilestone % 20000 === 0;
    lines.push(
      `   • Mốc ODO sắp tới: ~${nextMilestone.toLocaleString('vi-VN')} km (${isMajor ? 'Bảo dưỡng cấp trung/lớn: kiểm tra dầu máy, lọc gió, phanh, dung dịch' : 'Bảo dưỡng định kỳ 5.000 km: dầu động cơ, đảo lốp, kiểm tra an toàn'}).`,
    );
  } else {
    lines.push('   • Đề nghị cố vấn dịch vụ ghi nhận ODO thực tế và lập Phiếu kiểm tra xe điện tử 4 góc.');
  }

  if (ctx.registrationDaysLeft !== null && ctx.registrationDaysLeft <= 30) {
    lines.push(
      `   • Cảnh báo đăng kiểm: ${ctx.registrationDaysLeft < 0 ? `Đã quá hạn ${Math.abs(ctx.registrationDaysLeft)} ngày` : `Còn ${ctx.registrationDaysLeft} ngày hết hạn`} — ưu tiên kiểm tra phanh, đèn, khí thải.`,
    );
  }
  if (ctx.insuranceDaysLeft !== null && ctx.insuranceDaysLeft <= 30) {
    lines.push(
      `   • Cảnh báo bảo hiểm: ${ctx.insuranceDaysLeft < 0 ? `Đã hết hạn ${Math.abs(ctx.insuranceDaysLeft)} ngày` : `Còn ${ctx.insuranceDaysLeft} ngày`} — nhắc khách gia hạn.`,
    );
  }

  return lines.join('\n');
}
