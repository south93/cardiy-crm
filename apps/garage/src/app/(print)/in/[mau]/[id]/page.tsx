'use client';

import { Printer } from 'lucide-react';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/crm';
import { fmtDateTime, methodLabel, type ItemKind, type PaymentMethod } from '@/lib/orders';

type Form = 'tiep-nhan' | 'bao-gia' | 'hoa-don';
const FORMS: { value: Form; label: string; title: string }[] = [
  { value: 'tiep-nhan', label: 'Phiếu tiếp nhận', title: 'PHIẾU TIẾP NHẬN XE' },
  { value: 'bao-gia', label: 'Báo giá', title: 'BẢNG BÁO GIÁ SỬA CHỮA' },
  { value: 'hoa-don', label: 'Hoá đơn', title: 'HOÁ ĐƠN BÁN HÀNG' },
];

interface PrintData {
  form: Form;
  printedAt: string;
  totalInWords: string | null;
  dueInWords: string | null;
  qr: { dataUrl: string; amount: number; bankName: string; accountNo: string; accountName: string; note: string } | null;
  settings: {
    tenantName: string;
    tenantTaxCode: string | null;
    displayName: string;
    hotline: string;
    email: string;
    website: string;
    quoteValidDays: number;
    receiveTerms: string;
    quoteNote: string;
    invoiceNote: string;
  };
  order: {
    code: string;
    statusLabel: string;
    branch: { name: string; address: string | null; phone: string | null };
    customer: { code: string; name: string; phone: string | null };
    vehicle: { plate: string; make: string | null; model: string | null; year: number | null } | null;
    odometerKm: number | null;
    request: string | null;
    note: string | null;
    createdBy: string | null;
    technician: { name: string } | null;
    receivedAt: string;
    promisedAt: string | null;
    deliveredAt: string | null;
    items: { id: string; kind: ItemKind; name: string; unit: string | null; quantity: string; unitPrice: number | null; discount: number | null; amount: number | null }[];
    subtotal: number | null;
    orderDiscount: number | null;
    total: number | null;
    paid: number | null;
    due: number | null;
    payments: { id: string; amount: number; method: PaymentMethod; paidAt: string; voidedAt: string | null }[];
  };
}

const n = (v: number | null | undefined) => (v ?? 0).toLocaleString('vi-VN');

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-28 shrink-0 text-slate-500">{label}</span>
      <span className="min-w-0 font-medium">{children || '—'}</span>
    </div>
  );
}

function Sign({ who, note }: { who: string; note: string }) {
  return (
    <div className="text-center">
      <div className="font-semibold">{who}</div>
      <div className="text-xs italic text-slate-500">{note}</div>
      <div className="h-20" />
    </div>
  );
}

function Sheet({ d }: { d: PrintData }) {
  const { order: o, settings: s } = d;
  const form = FORMS.find((f) => f.value === d.form)!;
  const money = d.form !== 'tiep-nhan';
  const garage = s.displayName || s.tenantName;
  const validUntil = new Date(new Date(d.printedAt).getTime() + s.quoteValidDays * 86_400_000);
  const payments = o.payments.filter((p) => !p.voidedAt);

  return (
    <div className="print-sheet mx-auto my-6 w-[210mm] bg-white px-[12mm] py-[10mm] text-[13px] leading-snug text-slate-900 shadow-card" data-testid="print-sheet">
      {/* Đầu phiếu: garage + chi nhánh */}
      <header className="flex items-start justify-between gap-6 border-b-2 border-slate-800 pb-3">
        <div>
          <div className="text-lg font-bold uppercase" data-testid="print-garage">
            {garage}
          </div>
          <div>{o.branch.name}</div>
          {o.branch.address && <div className="text-slate-600">Đ/c: {o.branch.address}</div>}
          <div className="text-slate-600">
            {[o.branch.phone && `ĐT: ${o.branch.phone}`, s.hotline && `Hotline: ${s.hotline}`].filter(Boolean).join(' · ')}
          </div>
          {(s.email || s.website || s.tenantTaxCode) && (
            <div className="text-slate-600">{[s.tenantTaxCode && `MST: ${s.tenantTaxCode}`, s.email, s.website].filter(Boolean).join(' · ')}</div>
          )}
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500">Số phiếu</div>
          <div className="text-base font-bold" data-testid="print-code">
            {d.form === 'bao-gia' ? `BG-${o.code}` : o.code}
          </div>
          <div className="mt-1 text-xs text-slate-500">Ngày in: {fmtDateTime(d.printedAt)}</div>
        </div>
      </header>

      <h1 className="mt-4 text-center text-xl font-bold tracking-wide" data-testid="print-title">
        {form.title}
      </h1>
      {d.form === 'bao-gia' && <p className="text-center text-xs italic text-slate-500">Báo giá có hiệu lực đến hết ngày {fmtDate(validUntil.toISOString())}</p>}

      {/* Khách & xe */}
      <section className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg border border-slate-300 p-3">
        <Row label="Khách hàng">{o.customer.name}</Row>
        <Row label="Biển số">{o.vehicle ? <span className="font-mono">{o.vehicle.plate}</span> : 'Không có xe (bán lẻ)'}</Row>
        <Row label="Điện thoại">{o.customer.phone}</Row>
        <Row label="Xe">{o.vehicle ? [o.vehicle.make, o.vehicle.model, o.vehicle.year].filter(Boolean).join(' ') : null}</Row>
        <Row label="Mã khách">{o.customer.code}</Row>
        <Row label="Số km">{o.odometerKm !== null ? `${n(o.odometerKm)} km` : null}</Row>
        <Row label="Ngày nhận xe">{fmtDateTime(o.receivedAt)}</Row>
        <Row label={d.form === 'hoa-don' ? 'Ngày giao xe' : 'Hẹn giao'}>{fmtDateTime(d.form === 'hoa-don' ? o.deliveredAt : o.promisedAt)}</Row>
        <Row label="Người tạo">{o.createdBy}</Row>
        <Row label="KTV">{o.technician?.name}</Row>
      </section>

      {o.request && (
        <section className="mt-3">
          <div className="font-semibold">Khách yêu cầu / tình trạng xe</div>
          <p className="whitespace-pre-line">{o.request}</p>
        </section>
      )}

      {/* Phiếu tiếp nhận: kiểm tra xe khi nhận */}
      {d.form === 'tiep-nhan' && (
        <section className="mt-3 rounded-lg border border-slate-300 p-3">
          <div className="font-semibold">Tình trạng xe khi nhận</div>
          <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1.5">
            {['Trầy xước / móp méo thân vỏ', 'Nứt vỡ kính, đèn, gương', 'Đèn báo lỗi trên taplo', 'Đồ đạc có giá trị trong xe'].map((t) => (
              <div key={t} className="flex items-center gap-2">
                <span className="inline-block h-3.5 w-3.5 border border-slate-500" />
                {t}: <span className="flex-1 border-b border-dotted border-slate-400">&nbsp;</span>
              </div>
            ))}
            <div className="col-span-2 flex items-center gap-3">
              Mức nhiên liệu:
              {['E', '¼', '½', '¾', 'F'].map((x) => (
                <span key={x} className="flex items-center gap-1">
                  <span className="inline-block h-3.5 w-3.5 border border-slate-500" /> {x}
                </span>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Hạng mục */}
      {o.items.length > 0 && (
        <table className="mt-3 w-full border-collapse text-[12.5px]" data-testid="print-items">
          <thead>
            <tr className="bg-slate-100">
              <th className="border border-slate-300 px-1.5 py-1 text-center">STT</th>
              <th className="border border-slate-300 px-1.5 py-1 text-left">Hạng mục</th>
              <th className="border border-slate-300 px-1.5 py-1">ĐVT</th>
              <th className="border border-slate-300 px-1.5 py-1 text-right">SL</th>
              {money && <th className="border border-slate-300 px-1.5 py-1 text-right">Đơn giá</th>}
              {money && <th className="border border-slate-300 px-1.5 py-1 text-right">CK</th>}
              {money && <th className="border border-slate-300 px-1.5 py-1 text-right">Thành tiền</th>}
            </tr>
          </thead>
          <tbody>
            {o.items.map((i, idx) => (
              <tr key={i.id}>
                <td className="border border-slate-300 px-1.5 py-1 text-center">{idx + 1}</td>
                <td className="border border-slate-300 px-1.5 py-1">
                  {i.name}
                  <span className="text-slate-500"> · {i.kind === 'DICH_VU' ? 'Dịch vụ' : 'Phụ tùng'}</span>
                </td>
                <td className="border border-slate-300 px-1.5 py-1 text-center">{i.unit}</td>
                <td className="border border-slate-300 px-1.5 py-1 text-right">{Number(i.quantity).toLocaleString('vi-VN')}</td>
                {money && <td className="border border-slate-300 px-1.5 py-1 text-right">{n(i.unitPrice)}</td>}
                {money && <td className="border border-slate-300 px-1.5 py-1 text-right">{i.discount ? n(i.discount) : ''}</td>}
                {money && <td className="border border-slate-300 px-1.5 py-1 text-right font-medium">{n(i.amount)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Tổng tiền */}
      {money && (
        <section className="mt-3 flex items-start justify-between gap-6">
          <div className="flex-1">
            {d.qr && (
              <div className="flex items-start gap-3 rounded-lg border border-slate-300 p-2.5" data-testid="print-qr">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={d.qr.dataUrl} alt="Mã VietQR chuyển khoản" className="h-28 w-28" />
                <div className="text-xs">
                  <div className="font-semibold">Quét mã để chuyển khoản</div>
                  <div>{d.qr.bankName}</div>
                  <div>
                    STK: <b>{d.qr.accountNo}</b>
                  </div>
                  {d.qr.accountName && <div>Chủ TK: {d.qr.accountName}</div>}
                  <div>
                    Số tiền: <b>{n(d.qr.amount)} đ</b>
                  </div>
                  <div>Nội dung: {d.qr.note}</div>
                </div>
              </div>
            )}
          </div>
          <table className="w-72 text-[13px]" data-testid="print-totals">
            <tbody>
              <tr>
                <td className="py-0.5 text-slate-600">Tổng tiền</td>
                <td className="py-0.5 text-right">{n(o.subtotal)}</td>
              </tr>
              <tr>
                <td className="py-0.5 text-slate-600">Chiết khấu</td>
                <td className="py-0.5 text-right">{n(o.orderDiscount)}</td>
              </tr>
              <tr className="border-t border-slate-800 font-bold">
                <td className="py-1">Tổng sau CK</td>
                <td className="py-1 text-right">{n(o.total)} đ</td>
              </tr>
              {d.form === 'hoa-don' && (
                <>
                  <tr>
                    <td className="py-0.5 text-slate-600">Đã thanh toán</td>
                    <td className="py-0.5 text-right">{n(o.paid)}</td>
                  </tr>
                  <tr className="font-bold">
                    <td className="py-0.5">Còn phải thu</td>
                    <td className="py-0.5 text-right">{n(o.due)} đ</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </section>
      )}
      {money && d.totalInWords && (
        <p className="mt-2 italic" data-testid="print-words">
          Bằng chữ: {d.totalInWords}
          {d.dueInWords && `. Còn phải thu: ${d.dueInWords.charAt(0).toLowerCase()}${d.dueInWords.slice(1)}`}.
        </p>
      )}
      {d.form === 'hoa-don' && payments.length > 0 && (
        <p className="mt-1 text-xs text-slate-600">
          Đã thanh toán: {payments.map((p) => `${n(p.amount)} đ (${methodLabel(p.method)}, ${fmtDate(p.paidAt)})`).join('; ')}
        </p>
      )}

      {o.note && (
        <p className="mt-2">
          <b>Ghi chú:</b> {o.note}
        </p>
      )}

      {/* Điều khoản theo mẫu */}
      {(() => {
        const t = d.form === 'tiep-nhan' ? s.receiveTerms : d.form === 'bao-gia' ? s.quoteNote : s.invoiceNote;
        return t ? <p className="mt-3 whitespace-pre-line border-t border-dashed border-slate-300 pt-2 text-xs text-slate-600">{t}</p> : null;
      })()}

      <section className="mt-5 grid grid-cols-2 gap-6">
        {d.form === 'tiep-nhan' && (
          <>
            <Sign who="Khách hàng" note="(Ký, ghi rõ họ tên)" />
            <Sign who="Nhân viên tiếp nhận" note="(Ký, ghi rõ họ tên)" />
          </>
        )}
        {d.form === 'bao-gia' && (
          <>
            <Sign who="Khách hàng đồng ý" note="(Ký, ghi rõ họ tên)" />
            <Sign who="Người lập báo giá" note="(Ký, ghi rõ họ tên)" />
          </>
        )}
        {d.form === 'hoa-don' && (
          <>
            <Sign who="Khách hàng" note="(Đã nhận xe, ký tên)" />
            <Sign who="Thu ngân" note="(Ký, ghi rõ họ tên)" />
          </>
        )}
      </section>
      {d.form === 'hoa-don' && <p className="text-center text-xs italic text-slate-500">Cảm ơn quý khách! Phiếu này không thay thế hoá đơn GTGT.</p>}
    </div>
  );
}

export default function PrintPage() {
  const { mau, id } = useParams<{ mau: string; id: string }>();
  const { status, can } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [data, setData] = useState<PrintData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'anon') router.replace(`/dang-nhap?next=${encodeURIComponent(pathname)}`);
    if (status !== 'authed') return;
    setData(null);
    setError(null);
    api<PrintData>(`/orders/${id}/print?form=${mau}`).then(
      (d) => {
        setData(d);
        document.title = `${FORMS.find((f) => f.value === d.form)?.label} ${d.order.code}`;
      },
      (e) => setError(e instanceof ApiError ? e.message : 'Không tải được phiếu'),
    );
  }, [status, id, mau, router, pathname]);

  const money = can('ro.manage') || can('payment.collect') || can('finance.view');
  return (
    <div className="min-h-screen bg-slate-100">
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
        <Link href={`/don-hang/${id}`} className="text-sm text-slate-500 hover:text-brand-600">
          ← Về đơn hàng
        </Link>
        <div className="mx-2 flex gap-1">
          {FORMS.filter((f) => f.value === 'tiep-nhan' || money).map((f) => (
            <Link key={f.value} href={`/in/${f.value}/${id}`} className={`rounded-full px-3 py-1.5 text-sm ${f.value === mau ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
              {f.label}
            </Link>
          ))}
        </div>
        <div className="flex-1" />
        <button type="button" onClick={() => window.print()} disabled={!data} className="inline-flex items-center gap-2 rounded-full bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50" data-testid="print-button">
          <Printer className="h-4 w-4" />
          In / Lưu PDF
        </button>
      </div>
      {error && <p className="no-print p-8 text-center text-rose-600">{error}</p>}
      {data && <Sheet d={data} />}
    </div>
  );
}
