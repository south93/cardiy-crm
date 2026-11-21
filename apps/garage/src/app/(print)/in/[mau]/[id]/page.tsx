'use client';

import { Printer } from 'lucide-react';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Fragment, Suspense, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/crm';
import { fmtDateTime, methodLabel, type ItemKind, type PaymentMethod } from '@/lib/orders';

type Form = 'kiem-tra' | 'bao-gia' | 'hoa-don';
type Variant = 'lop' | 'gam' | 'ca-hai';

interface Item {
  id: string;
  kind: ItemKind;
  name: string;
  unit: string | null;
  quantity: string;
  unitPrice: number | null;
  discount: number | null;
  amount: number | null;
  vatRate: number;
  section: string | null;
}
interface PrintData {
  form: Form;
  printedAt: string;
  totalInWords: string | null;
  dueInWords: string | null;
  logoUrl: string | null;
  linkQr: string | null;
  taxBank: string;
  customerPaid?: number;
  customerDue?: number;
  insuranceDue?: number;
  qr: { dataUrl: string; amount: number; bankName: string; accountNo: string; accountName: string; note: string } | null;
  settings: {
    tenantName: string;
    displayName: string;
    hotline: string;
    website: string;
    quoteValidDays: number;
    invoiceNote: string;
    slogan?: string;
    tagline?: string;
    banner?: string;
    qrCaption?: string;
    warrantyTire?: string;
    warrantyUnderbody?: string;
    signNote?: string;
    inspectionNote?: string;
  };
  order: {
    code: string;
    branch: { name: string; address: string | null; phone: string | null };
    customer: { code: string; name: string; phone: string | null; type: 'PERSON' | 'COMPANY'; address: string | null; representative: string | null };
    vehicle: { plate: string; make: string | null; model: string | null; year: number | null; color: string | null; fuel: string | null; transmission: string | null; vin: string | null; tireSize: string | null } | null;
    odometerKm: number | null;
    request: string | null;
    note: string | null;
    advisor: { name: string; phone: string | null } | null;
    technician: { name: string } | null;
    createdBy: string | null;
    receivedAt: string;
    promisedAt: string | null;
    deliveredAt: string | null;
    items: Item[];
    subtotal: number | null;
    orderDiscount: number | null;
    vatTotal: number | null;
    total: number | null;
    insuranceAmount: number | null;
    customerPays: number | null;
    paid: number | null;
    due: number | null;
    payments: { id: string; amount: number; method: PaymentMethod; paidAt: string; voidedAt: string | null }[];
  };
}

const FORMS: { value: Form; label: string }[] = [
  { value: 'kiem-tra', label: 'Phiếu kiểm tra xe' },
  { value: 'bao-gia', label: 'Phiếu dịch vụ & bảo hành' },
  { value: 'hoa-don', label: 'Hoá đơn' },
];

const n = (v: number | null | undefined) => (v ? v.toLocaleString('vi-VN') : '0');
const qty = (q: string) => Number(q).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
const gross = (i: Item) => (i.amount ?? 0) + (i.discount ?? 0);
const ckPct = (i: Item) => {
  const g = gross(i);
  if (!g || !i.discount) return '0';
  return (Math.round((i.discount / g) * 1000) / 10).toLocaleString('vi-VN');
};

/** Nội dung soạn trong Cài đặt: ## tiêu đề, > ô công thức, – gạch đầu dòng, **đậm** */
function RichText({ text }: { text: string }) {
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/).map((p, i) => (p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : <Fragment key={i}>{p}</Fragment>));
  return (
    <div className="space-y-0.5">
      {text.split('\n').map((l, i) => {
        if (l.startsWith('## ')) return <div key={i} className="mb-0.5 text-[11px] font-bold uppercase text-[#1d4f9c]">{l.slice(3)}</div>;
        if (l.startsWith('> ')) return <div key={i} className="border-l-2 border-amber-400 bg-sky-50 px-1.5 py-0.5 italic">{inline(l.slice(2))}</div>;
        if (l.startsWith('✓')) return <div key={i} className="font-semibold text-emerald-700">{inline(l)}</div>;
        if (l.startsWith('– ') || l.startsWith('- ')) return <div key={i} className="pl-2.5 -indent-2.5">{inline(l)}</div>;
        return <div key={i}>{inline(l)}</div>;
      })}
    </div>
  );
}

function BrandHeader({ d }: { d: PrintData }) {
  const s = d.settings;
  return (
    <header className="flex items-center gap-3 border-b-2 border-[#1d4f9c] pb-1.5">
      <div className="w-[53mm] shrink-0">
        {d.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={d.logoUrl} alt="" className="max-h-[14mm] max-w-[53mm] object-contain" data-testid="print-logo" />
        ) : (
          <div className="text-[20px] font-black italic uppercase leading-none text-[#1d4f9c]" data-testid="print-garage">
            {s.displayName || s.tenantName}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1 text-center">
        {s.slogan && <div className="text-[17px] font-extrabold italic leading-tight text-[#1d4f9c]">{s.slogan}</div>}
        {s.tagline && <div className="text-[10px] text-slate-600">{s.tagline}</div>}
        <div className="text-[10px] text-slate-700">
          {s.hotline && (
            <>
              Hotline: <b className="text-[#1d4f9c]">{s.hotline}</b>
            </>
          )}
          {s.hotline && s.website && <span className="mx-1.5 text-slate-400">|</span>}
          {s.website && <b className="text-[#1d4f9c]">{s.website}</b>}
        </div>
      </div>
      <div className="w-[19mm] shrink-0 text-center">
        {d.linkQr && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={d.linkQr} alt="" className="mx-auto h-[16mm] w-[16mm]" />
            <div className="mt-0.5 text-[7px] font-bold text-[#1d4f9c]">{s.qrCaption}</div>
          </>
        )}
      </div>
    </header>
  );
}

function Line({ label, children, className = '' }: { label: string; children?: ReactNode; className?: string }) {
  return (
    <div className={`flex items-end gap-1.5 ${className}`}>
      <span className="shrink-0 font-semibold">{label}</span>
      <span className="min-h-[15px] min-w-0 flex-1 border-b border-dotted border-slate-400 px-0.5 leading-tight">{children}</span>
    </div>
  );
}

function Signs({ cols, date }: { cols: { who: string; name?: string | null }[]; date?: string }) {
  const dt = date ? new Date(date) : new Date();
  return (
    <section className="mt-2">
      {date !== undefined && (
        <div className="text-right text-[11px] italic text-slate-600">
          Ngày <b className="px-1 not-italic">{dt.getDate()}</b> tháng <b className="px-1 not-italic">{dt.getMonth() + 1}</b> năm <b className="px-1 not-italic">{dt.getFullYear()}</b>
        </div>
      )}
      <div className={`grid gap-4 grid-cols-${cols.length}`} style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}>
        {cols.map((c) => (
          <div key={c.who} className="text-center">
            <div className="text-[11px] font-bold uppercase">{c.who}</div>
            <div className="text-[9px] italic text-slate-500">(Ký, ghi rõ họ tên)</div>
            <div className="h-14" />
            <div className="border-t border-dotted border-slate-400 pt-0.5 text-[11px] font-medium">{c.name ?? ''}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------- Phiếu dịch vụ & bảo hành / Hoá đơn ----------------
function ServiceSheet({ d, variant, invoice }: { d: PrintData; variant: 'lop' | 'gam'; invoice?: boolean }) {
  const { order: o, settings: s } = d;
  const company = o.customer.type === 'COMPANY';
  const items = o.items;
  const sections = [...new Set(items.map((i) => i.section ?? ''))];
  const sectioned = sections.some(Boolean);
  const pad = Math.max(0, 6 - items.length);
  const grossTotal = items.reduce((x, i) => x + gross(i), 0);
  const ckTotal = items.reduce((x, i) => x + (i.discount ?? 0), 0) + (o.orderDiscount ?? 0);
  const preTax = (o.subtotal ?? 0) - (o.orderDiscount ?? 0);
  const terms = invoice ? s.invoiceNote : variant === 'lop' ? s.warrantyTire : s.warrantyUnderbody;
  let stt = 0;
  const row = (i: Item) => (
    <tr key={i.id}>
      <td className="border border-slate-300 px-1 py-[3px] text-center">{++stt}</td>
      <td className="border border-slate-300 px-1.5 py-[3px]">{i.name}</td>
      <td className="border border-slate-300 px-1 py-[3px] text-center">{i.unit}</td>
      <td className="border border-slate-300 px-1 py-[3px] text-center">{qty(i.quantity)}</td>
      <td className="border border-slate-300 px-1.5 py-[3px] text-right">{n(i.unitPrice)}</td>
      <td className="border border-slate-300 px-1 py-[3px] text-right">{ckPct(i)}</td>
      <td className="border border-slate-300 px-1.5 py-[3px] text-right font-medium">{n(i.amount)}</td>
      <td className="border border-slate-300 px-1 py-[3px] text-right">{i.vatRate}</td>
    </tr>
  );
  const blank = (k: number) => (
    <tr key={`b${k}`}>
      <td className="border border-slate-300 px-1 py-[3px] text-center text-slate-400">{++stt}</td>
      {Array.from({ length: 7 }, (_, j) => (
        <td key={j} className="border border-slate-300 py-[3px]">
          &nbsp;
        </td>
      ))}
    </tr>
  );

  return (
    <div className="print-page" data-testid="print-sheet">
      <BrandHeader d={d} />
      <div className="relative mt-1.5 text-center">
        <h1 className="text-[19px] font-extrabold tracking-wide" data-testid="print-title">
          {invoice ? 'HOÁ ĐƠN BÁN HÀNG' : 'PHIẾU DỊCH VỤ VÀ BẢO HÀNH'}
        </h1>
        <div className="absolute right-0 top-1 text-[11px]">
          <b className="text-[#1d4f9c]">No.</b>{' '}
          <b className="border-b border-dotted border-slate-400 text-[#c2410c]" data-testid="print-code">
            {invoice ? o.code : `BG-${o.code}`}
          </b>
        </div>
      </div>

      <section className="mt-1 grid grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
        <Line label={invoice ? 'Ngày lập:' : 'Ngày báo giá:'}>{fmtDate(d.printedAt)}</Line>
        <Line label="Cố vấn dịch vụ:">{o.advisor?.name}</Line>
        {invoice ? <Line label="Ngày giao xe:">{fmtDateTime(o.deliveredAt)}</Line> : <Line label="Hiệu lực báo giá:">{s.quoteValidDays} ngày kể từ ngày báo giá</Line>}
        <Line label="Điện thoại CVDV:">{o.advisor?.phone}</Line>
        <Line label="Chi nhánh:">{o.branch.name}</Line>
        <Line label="MST · STK:">{d.taxBank}</Line>
      </section>

      <section className="mt-1.5 grid grid-cols-2 border border-slate-800 text-[11px]">
        <div className="space-y-1 border-r border-slate-800 p-2">
          <Line label="Tên khách hàng:">{company ? (o.customer.representative ?? '') : o.customer.name}</Line>
          <Line label="Đơn vị:">{company ? o.customer.name : ''}</Line>
          <Line label="Điện thoại:">{o.customer.phone}</Line>
          <Line label="Địa chỉ:">{o.customer.address}</Line>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 p-2">
          <Line label="Biển số:">
            <b>{o.vehicle?.plate}</b>
          </Line>
          <Line label="Dung tích:" />
          <Line label="Loại xe:">{o.vehicle?.make}</Line>
          <Line label="Số km:">{o.odometerKm !== null ? o.odometerKm.toLocaleString('vi-VN') : ''}</Line>
          <Line label="Kiểu xe:">{o.vehicle?.model}</Line>
          <Line label="Màu xe:">{o.vehicle?.color}</Line>
          <Line label="Năm SX:">{o.vehicle?.year}</Line>
          <Line label="Khác:">{[o.vehicle?.fuel, o.vehicle?.transmission].filter(Boolean).join(', ')}</Line>
        </div>
      </section>

      <table className="mt-1.5 w-full border-collapse text-[10.5px]" data-testid="print-items">
        <thead>
          <tr className="bg-[#e8eefa] text-[10px] font-bold uppercase">
            <th className="w-7 border border-slate-300 py-1">STT</th>
            <th className="border border-slate-300 py-1">Tên vật tư / dịch vụ</th>
            <th className="w-10 border border-slate-300 py-1">ĐVT</th>
            <th className="w-9 border border-slate-300 py-1">SL</th>
            <th className="w-[22mm] border border-slate-300 py-1">Đơn giá</th>
            <th className="w-10 border border-slate-300 py-1">CK %</th>
            <th className="w-[24mm] border border-slate-300 py-1">Thành tiền</th>
            <th className="w-10 border border-slate-300 py-1">% Thuế</th>
          </tr>
        </thead>
        <tbody>
          {sectioned
            ? sections.map((sec) => {
                const its = items.filter((i) => (i.section ?? '') === sec);
                return (
                  <Fragment key={sec || '_'}>
                    <tr>
                      <td colSpan={8} className="border border-slate-300 bg-slate-50 px-1.5 py-[3px] font-bold text-[#1d4f9c]">
                        {sec || 'Khác'}
                      </td>
                    </tr>
                    {its.map(row)}
                    <tr>
                      <td colSpan={6} className="border border-slate-300 px-1.5 py-[3px] text-right italic">
                        Cộng phần {sec ? sec.replace(/^phần\s+/i, '') : ''}
                      </td>
                      <td className="border border-slate-300 px-1.5 py-[3px] text-right font-semibold">{n(its.reduce((x, i) => x + (i.amount ?? 0), 0))}</td>
                      <td className="border border-slate-300" />
                    </tr>
                  </Fragment>
                );
              })
            : items.map(row)}
          {Array.from({ length: pad }, (_, k) => blank(k))}
          <tr className="bg-amber-50 font-bold">
            <td colSpan={6} className="border border-slate-300 px-1.5 py-1 text-right">
              TỔNG CỘNG TIỀN HÀNG (chưa thuế)
            </td>
            <td className="border border-slate-300 px-1.5 py-1 text-right">{n(o.subtotal)}</td>
            <td className="border border-slate-300" />
          </tr>
        </tbody>
      </table>

      <section className="mt-1.5 grid grid-cols-[1fr_66mm] border border-slate-800 text-[10px]">
        <div className="border-r border-slate-800 p-2 leading-snug" data-testid="print-terms">
          {terms ? <RichText text={terms} /> : null}
          {invoice && d.qr && (
            <div className="mt-2 flex items-start gap-2 rounded border border-slate-300 p-1.5" data-testid="print-qr">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={d.qr.dataUrl} alt="Mã VietQR chuyển khoản" className="h-[24mm] w-[24mm]" />
              <div>
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
        <table className="w-full border-collapse text-[11px]" data-testid="print-totals">
          <tbody>
            {[
              ['Tổng tiền hàng', n(grossTotal)],
              ['Tổng chiết khấu', n(ckTotal)],
              ['Cộng (chưa thuế)', n(preTax)],
              ['Thuế VAT', n(o.vatTotal)],
            ].map(([k, v]) => (
              <tr key={k}>
                <td className="border-b border-r border-slate-300 bg-[#f3f6fc] px-1.5 py-[3px] text-right">{k}</td>
                <td className="border-b border-slate-300 px-1.5 py-[3px] text-right font-semibold">{v}</td>
              </tr>
            ))}
            <tr className="bg-amber-50">
              <td className="border-b border-r border-slate-300 px-1.5 py-1 text-right text-[13px] font-extrabold">TỔNG CỘNG</td>
              <td className="border-b border-slate-300 px-1.5 py-1 text-right text-[13px] font-extrabold">{n(o.total)}</td>
            </tr>
            <tr>
              <td className="border-b border-r border-slate-300 px-1.5 py-[3px] text-right">Trong đó – Bảo hiểm TT</td>
              <td className="border-b border-slate-300 px-1.5 py-[3px] text-right">{n(o.insuranceAmount)}</td>
            </tr>
            <tr>
              <td className="border-r border-slate-300 px-1.5 py-[3px] text-right font-semibold">Khách hàng thanh toán</td>
              <td className="px-1.5 py-[3px] text-right font-bold" data-testid="print-customer-pays">
                {n(o.customerPays)}
              </td>
            </tr>
            {invoice && (
              <>
                <tr>
                  <td className="border-t border-r border-slate-300 px-1.5 py-[3px] text-right">Khách đã thanh toán</td>
                  <td className="border-t border-slate-300 px-1.5 py-[3px] text-right">{n(d.customerPaid)}</td>
                </tr>
                <tr>
                  <td className="border-t border-r border-slate-300 px-1.5 py-[3px] text-right font-semibold">Khách còn phải trả</td>
                  <td className="border-t border-slate-300 px-1.5 py-[3px] text-right font-bold text-rose-700" data-testid="print-customer-due">
                    {n(d.customerDue)}
                  </td>
                </tr>
                {!!d.insuranceDue && (
                  <tr>
                    <td className="border-t border-r border-slate-300 px-1.5 py-[3px] text-right">Bảo hiểm chưa chuyển</td>
                    <td className="border-t border-slate-300 px-1.5 py-[3px] text-right">{n(d.insuranceDue)}</td>
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
        <div className="col-span-2 border-t border-slate-800 px-2 py-1 text-[11px]" data-testid="print-words">
          <b>Số tiền bằng chữ:</b> <i>{d.totalInWords}</i>
          {d.dueInWords && <i> — khách còn phải trả: {d.dueInWords.charAt(0).toLowerCase() + d.dueInWords.slice(1)}</i>}
        </div>
      </section>
      {invoice && o.payments.some((p) => !p.voidedAt) && (
        <p className="mt-1 text-[10px] text-slate-600">
          Đã thanh toán:{' '}
          {o.payments
            .filter((p) => !p.voidedAt)
            .map((p) => `${n(p.amount)} đ (${methodLabel(p.method)}, ${fmtDate(p.paidAt)})`)
            .join('; ')}
        </p>
      )}
      {o.note && (
        <p className="mt-1 text-[10.5px]">
          <b>Ghi chú:</b> {o.note}
        </p>
      )}

      {s.banner && <div className="mt-2 border-t-2 border-amber-400 bg-[#1d4f9c] py-1 text-center text-[10px] font-bold uppercase text-white">{`${(s.displayName || s.tenantName).toUpperCase()}: ${s.banner}`}</div>}
      <Signs
        date={d.printedAt}
        cols={[
          { who: invoice ? 'Thu ngân' : 'Cố vấn dịch vụ', name: invoice ? null : o.advisor?.name },
          { who: 'Kỹ thuật viên', name: o.technician?.name },
          { who: 'Khách hàng', name: company ? (o.customer.representative ?? o.customer.name) : o.customer.name },
        ]}
      />
      {s.signNote && <p className="mt-1 border-t border-dotted border-slate-300 pt-1 text-center text-[9px] italic text-slate-500">{s.signNote}</p>}
      {invoice && <p className="text-center text-[9px] italic text-slate-500">Phiếu này không thay thế hoá đơn GTGT.</p>}
    </div>
  );
}

// ---------------- Phiếu kiểm tra xe (2 trang) ----------------
const Box = ({ tone }: { tone?: 'g' | 'y' | 'r' }) => (
  <span className={`inline-block h-[11px] w-[11px] shrink-0 rounded-[2px] border ${tone === 'g' ? 'border-emerald-600' : tone === 'y' ? 'border-amber-500' : tone === 'r' ? 'border-rose-600' : 'border-slate-500'}`} />
);
const Chips = () => (
  <span className="inline-flex gap-[3px]">
    <span className="h-[8px] w-[14px] rounded-sm bg-emerald-200" />
    <span className="h-[8px] w-[14px] rounded-sm bg-amber-200" />
    <span className="h-[8px] w-[14px] rounded-sm bg-rose-200" />
  </span>
);
const Dots = ({ unit }: { unit?: string }) => (
  <span className="flex flex-1 items-end gap-1">
    <span className="h-3 flex-1 border-b border-dotted border-slate-400" />
    {unit && <span>{unit}</span>}
  </span>
);
const Side = ({ label }: { label: string }) => (
  <div className="flex w-[7mm] shrink-0 items-center justify-center bg-[#1d4f9c]">
    <span className="-rotate-90 whitespace-nowrap text-[9px] font-bold uppercase text-white">{label}</span>
  </div>
);

function Tyre({ name }: { name: string }) {
  return (
    <div className="rounded border border-slate-300 p-1.5">
      <div className="mb-1 text-[10px] font-bold text-[#1d4f9c]">◎ {name}</div>
      <div className="space-y-[3px]">
        <div className="flex items-center justify-between gap-2">
          <span>Mòn / Lão hóa / Xì hơi / Phù</span>
          <Chips />
        </div>
        <div className="flex items-end gap-1">
          <span>Hãng / Quy cách</span>
          <Dots />
        </div>
        <div className="flex items-end gap-1">
          <span>Áp suất lốp</span>
          <Dots unit="Bar" />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span>Hư hỏng van</span>
          <Chips />
        </div>
        <div className="flex items-end gap-1">
          <span>Độ sâu gai</span>
          <Dots unit="mm" />
        </div>
      </div>
    </div>
  );
}

const SAFETY_L = ['Lốp xe', 'Gạt mưa', 'Nước rửa kính', 'Má phanh', 'Đĩa phanh', 'Dầu phanh', 'Dầu động cơ'];
const SAFETY_R = ['Lọc dầu động cơ', 'Nước làm mát', 'Ắc quy', 'Lọc gió động cơ', 'Lọc gió điều hòa', 'Góc đặt bánh xe'];
const UNDER_FRONT = ['Phuộc trước', 'Tăm bông phuộc', 'Chụp bụi phuộc', 'Chụp bụi láp', 'Chụp bụi thước lái', 'Bạc đạn bánh', 'Rotuyn thanh giằng', 'Rotuyn lái trong', 'Rotuyn lái ngoài', 'Rotuyn trụ trên', 'Rotuyn trụ dưới', 'Cao su càng A lớn – dưới', 'Cao su càng A nhỏ – dưới'];
const UNDER_FRONT2 = ['Cao su càng A lớn – trên', 'Cao su càng A nhỏ – trên', 'Cao su cung D'];
const UNDER_REAR = ['Phuộc sau', 'Tăm bông phuộc', 'Chụp bụi phuộc', 'Bạc đạn bánh', 'Rotuyn thanh giằng', 'Cao su cung D', 'Cao su chữ Y', 'Cao su thanh giằng dọc'];
const FINAL = ['Hoàn thành sửa chữa, siết đủ lực', 'Lốp bình thường, áp suất về chuẩn', 'Hệ thống phanh bình thường', 'Gạt mưa bình thường', 'Hệ thống đèn bình thường', 'Dầu / dung dịch đủ, đã reset bảo dưỡng', 'Ắc quy khỏe, đấu nối chắc', 'Giảm xóc, chụp bụi không hư', 'Giá đỡ, gầm, cao su giằng không hư', 'Không bỏ sót ốp, phụ kiện táp-lô', 'Không bỏ quên dụng cụ trên xe'];

function SafetyTable({ rows }: { rows: string[] }) {
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="bg-[#e8eefa] text-[8.5px] font-bold text-[#1d4f9c]">
          <th className="border border-slate-300 px-1 py-0.5 text-left">HẠNG MỤC</th>
          <th className="w-9 border border-slate-300">TỐT</th>
          <th className="w-9 border border-slate-300">CHÚ Ý</th>
          <th className="w-11 border border-slate-300">THAY THẾ</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r}>
            <td className="border border-slate-300 px-1 py-[2.5px]">{r}</td>
            {['g', 'y', 'r'].map((t) => (
              <td key={t} className="border border-slate-300 text-center">
                <Box />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function UnderTable({ title, rows, sub }: { title: string; rows: string[]; sub?: { title: string; rows: string[] } }) {
  const tri = (
    <span className="inline-flex gap-[2px]">
      <Box tone="g" />
      <Box tone="y" />
      <Box tone="r" />
    </span>
  );
  const body = (rs: string[]) =>
    rs.map((r, i) => (
      <tr key={r + i}>
        <td className="border border-slate-300 px-1 py-[2px]">{r}</td>
        <td className="border border-slate-300 text-center">{tri}</td>
        <td className="border border-slate-300 text-center">{tri}</td>
      </tr>
    ));
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="bg-[#e8eefa] text-[8.5px] font-bold text-[#1d4f9c]">
          <th className="border border-slate-300 py-0.5">{title}</th>
          <th className="w-[16mm] border border-slate-300">TRÁI</th>
          <th className="w-[16mm] border border-slate-300">PHẢI</th>
        </tr>
      </thead>
      <tbody>
        {body(rows)}
        {sub && (
          <>
            <tr>
              <td colSpan={3} className="border border-slate-300 bg-[#e8eefa] py-0.5 text-center text-[8.5px] font-bold text-[#1d4f9c]">
                {sub.title}
              </td>
            </tr>
            {body(sub.rows)}
          </>
        )}
      </tbody>
    </table>
  );
}

function RepairTable({ rows, min, money }: { rows: Item[]; min: number; money: boolean }) {
  const blanks = Math.max(0, min - rows.length);
  const total = rows.reduce((x, i) => x + (i.amount ?? 0), 0);
  return (
    <table className="w-full border-collapse text-[10px]">
      <thead>
        <tr className="bg-[#1d4f9c] text-[9px] font-bold text-white">
          <th className="w-9 border border-slate-300 py-1">STT</th>
          <th className="border border-slate-300 py-1">HẠNG MỤC</th>
          <th className="w-10 border border-slate-300 py-1">SL</th>
          <th className="w-[22mm] border border-slate-300 py-1">ĐƠN GIÁ</th>
          <th className="w-[24mm] border border-slate-300 py-1">THÀNH TIỀN</th>
          <th className="w-[20mm] border border-slate-300 py-1">XÁC NHẬN</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((i, k) => (
          <tr key={i.id} className="h-[7mm]">
            <td className="border border-slate-300 text-center">{String(k + 1).padStart(2, '0')}</td>
            <td className="border border-slate-300 px-1.5">{i.name}</td>
            <td className="border border-slate-300 text-center">{qty(i.quantity)}</td>
            <td className="border border-slate-300 px-1 text-right">{money ? n(i.unitPrice) : ''}</td>
            <td className="border border-slate-300 px-1 text-right">{money ? n(i.amount) : ''}</td>
            <td className="border border-slate-300" />
          </tr>
        ))}
        {Array.from({ length: blanks }, (_, k) => (
          <tr key={`b${k}`} className="h-[7mm]">
            <td className="border border-slate-300 text-center text-slate-400">{String(rows.length + k + 1).padStart(2, '0')}</td>
            <td className="border border-slate-300" />
            <td className="border border-slate-300" />
            <td className="border border-slate-300" />
            <td className="border border-slate-300" />
            <td className="border border-slate-300" />
          </tr>
        ))}
        <tr className="bg-amber-50">
          <td colSpan={4} className="border border-slate-300 px-1.5 py-1 text-right font-bold text-[#1d4f9c]">
            TỔNG TIỀN:
          </td>
          <td className="border border-slate-300 px-1 text-right font-bold">{money && rows.length ? n(total) : ''}</td>
          <td className="border border-slate-300" />
        </tr>
      </tbody>
    </table>
  );
}

function Bar({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="w-[105mm] bg-[#1d4f9c] px-2.5 py-1 text-[10px] font-bold uppercase text-white">{children}</div>
      {right}
    </div>
  );
}

function InspectionSheet({ d }: { d: PrintData }) {
  const { order: o, settings: s } = d;
  const v = o.vehicle;
  const money = o.total !== null;
  const logo = d.logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={d.logoUrl} alt="" className="max-h-[12mm] max-w-[48mm] object-contain" />
  ) : (
    <div className="text-[18px] font-black italic uppercase leading-none text-[#1d4f9c]">{s.displayName || s.tenantName}</div>
  );
  return (
    <>
      {/* ---------- Trang 1 ---------- */}
      <div className="print-page relative overflow-hidden text-[9.5px] leading-tight" data-testid="print-sheet">
        <div className="absolute right-0 top-0 h-0 w-0 border-l-[18mm] border-t-[18mm] border-l-transparent border-t-[#1d4f9c]" />
        <header className="flex items-start gap-4">
          <div className="flex items-start gap-3">
            {logo}
            {d.linkQr && (
              <div className="text-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={d.linkQr} alt="" className="mx-auto h-[13mm] w-[13mm]" />
                <div className="text-[6.5px] font-bold text-[#1d4f9c]">{s.qrCaption}</div>
              </div>
            )}
          </div>
          <div className="flex-1 text-center">
            <div className="text-[10px]">
              <b className="text-rose-600">No.</b> <b className="border-b border-slate-400 px-6" data-testid="print-code">{o.code}</b>
            </div>
            <h1 className="text-[20px] font-extrabold text-[#1d4f9c]" data-testid="print-title">
              PHIẾU KIỂM TRA XE
            </h1>
            <div className="text-[8.5px] text-slate-500">Quý khách vui lòng nhận phiếu sửa chữa in từ hệ thống tại quầy</div>
          </div>
          <div className="w-[16mm]" />
        </header>

        <section className="mt-2 grid grid-cols-[1.2fr_1fr_1.1fr_0.9fr_1fr] gap-x-3 gap-y-1.5">
          <Line label="Tên khách hàng:">{o.customer.name}</Line>
          <Line label="Điện thoại:">{o.customer.phone}</Line>
          <Line label="Dòng xe:">{v?.model}</Line>
          <Line label="Số km đã chạy:">{o.odometerKm !== null ? o.odometerKm.toLocaleString('vi-VN') : ''}</Line>
          <Line label="Ngày vào xưởng:">{fmtDate(o.receivedAt)}</Line>
          <Line label="Biển số xe:">
            <b>{v?.plate}</b>
          </Line>
          <Line label="Cấp bảo dưỡng:" />
          <Line label="Hãng xe:">{v?.make}</Line>
          <Line label="Nhiên liệu:">{v?.fuel}</Line>
          <Line label="Hộp số:">{v?.transmission}</Line>
          <Line label="Đời xe:">{v?.year}</Line>
          <Line label="Số khung (VIN):" className="col-span-2">
            {v?.vin}
          </Line>
          <Line label="Size lốp:">{v?.tireSize}</Line>
          <Line label="Ngày ĐK lần đầu:" />
        </section>

        <div className="mt-2 flex text-[10px] font-bold text-white">
          <div className="flex-1 bg-[#1d4f9c] px-2.5 py-1">HẠNG MỤC KIỂM TRA</div>
          <div className="ml-1 w-[25mm] bg-emerald-600 py-1 text-center">TỐT</div>
          <div className="ml-1 w-[25mm] bg-amber-500 py-1 text-center">CHÚ Ý</div>
          <div className="ml-1 w-[25mm] bg-rose-600 py-1 text-center">THAY THẾ</div>
        </div>

        <section className="mt-1.5 flex border border-[#1d4f9c]">
          <Side label="" />
          <div className="flex-1 p-2">
            <div className="flex flex-wrap items-center gap-3 font-bold text-[#1d4f9c]">
              YÊU CẦU CỦA KHÁCH HÀNG:
              {['Thay lốp', 'Vá lốp', 'Bảo dưỡng', 'Rửa xe', 'Khác'].map((x) => (
                <span key={x} className="flex items-center gap-1 font-normal text-slate-700">
                  <Box /> {x}
                </span>
              ))}
            </div>
            <div className="mt-1 min-h-[13mm] whitespace-pre-line border-b border-dotted border-slate-400 pb-1 text-[10px]" data-testid="print-request">
              {o.request}
            </div>
            <div className="h-4 border-b border-dotted border-slate-400" />
          </div>
        </section>

        <section className="mt-1.5 flex border border-[#1d4f9c]">
          <Side label="Kiểm tra lốp xe" />
          <div className="grid flex-1 grid-cols-[1fr_1.15fr_1fr] gap-2 p-2">
            <div className="space-y-2">
              <div className="font-bold">Kiểm tra lốp xe (thay theo 3 năm / 60.000 km)</div>
              <Tyre name="Trước trái" />
              <Tyre name="Sau trái" />
            </div>
            <div>
              <div className="font-bold">Kiểm tra chức năng gạt mưa</div>
              <div className="flex items-center justify-between">
                <span>Vệt gạt nước</span>
                <Chips />
              </div>
              <div className="flex items-center justify-between">
                <span>Lưỡi gạt (cao su lão hóa, nứt)</span>
                <Chips />
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/print/so-do-xe.png" alt="Sơ đồ thân xe" className="mt-1 w-full" />
              <div className="mt-0.5 text-center text-[8.5px]">▼ Móp lõm &nbsp; ▲ Trầy xước &nbsp; ◆ Đá văng &nbsp; ● Sơn lại</div>
              <div className="mt-1 flex items-end gap-1 rounded border border-slate-300 p-1.5 font-bold">
                Áp suất lốp dự phòng <Dots unit="Bar" />
              </div>
            </div>
            <div className="space-y-2 pt-[14px]">
              <Tyre name="Trước phải" />
              <Tyre name="Sau phải" />
            </div>
          </div>
        </section>

        <section className="mt-1.5 flex border border-[#1d4f9c]">
          <Side label="Kiểm tra an toàn xe" />
          <div className="grid flex-1 grid-cols-2 gap-2 p-2">
            <SafetyTable rows={SAFETY_L} />
            <SafetyTable rows={SAFETY_R} />
          </div>
        </section>

        <section className="mt-1.5 flex border border-[#1d4f9c]">
          <Side label="Kiểm tra gầm xe (24)" />
          <div className="flex-1 p-2">
            <div className="grid grid-cols-2 gap-2">
              <UnderTable title="GẦM TRƯỚC (trái – phải)" rows={UNDER_FRONT} />
              <UnderTable title="GẦM TRƯỚC (tiếp)" rows={UNDER_FRONT2} sub={{ title: 'GẦM SAU (trái – phải)', rows: UNDER_REAR }} />
            </div>
            <div className="mt-0.5 text-[8px] text-slate-500">Mỗi bên có 3 ô, tick theo thứ tự: ô 1 = TỐT (xanh lá) · ô 2 = CHÚ Ý (vàng) · ô 3 = THAY THẾ (đỏ)</div>
          </div>
        </section>

        <div className="mt-1.5 flex items-end gap-1 font-bold">
          Khuyến nghị của kỹ thuật viên: <Dots />
        </div>
        <section className="mt-1.5 grid grid-cols-3 gap-3">
          {[
            ['KỸ THUẬT VIÊN', o.technician?.name],
            ['CỐ VẤN DỊCH VỤ', o.advisor?.name],
            ['KHÁCH HÀNG', o.customer.name],
          ].map(([w, name]) => (
            <div key={w} className="rounded border border-[#1d4f9c] p-1.5 text-center">
              <div className="text-[10px] font-bold text-[#1d4f9c]">{w}</div>
              <div className="text-[8px] italic text-slate-500">(ký, ghi rõ họ tên)</div>
              <div className="h-[12mm]" />
              <div className="border-t border-dotted border-slate-400 text-[9.5px]">{name}</div>
            </div>
          ))}
        </section>
      </div>

      {/* ---------- Trang 2 ---------- */}
      <div className="print-page text-[9.5px] leading-tight">
        <header className="flex items-start justify-between">
          {logo}
          <div className="text-right">
            <div className="text-[11px] text-slate-600">PHIẾU KIỂM TRA XE — TRANG 2/2</div>
            <div className="mt-1 text-[10px]">
              <b className="text-slate-500">Biển số xe</b> <b className="border-b border-dotted border-slate-400 px-3">{v?.plate}</b> <b className="text-slate-500">No.</b> <b>{o.code}</b>
            </div>
          </div>
        </header>
        <div className="mt-2">
          <Bar right={<Line label="Dự kiến hoàn thành:" className="w-[70mm]">{fmtDateTime(o.promisedAt)}</Line>}>Hạng mục sửa chữa</Bar>
        </div>
        <div className="mt-1" data-testid="print-items">
          <RepairTable rows={o.items} min={6} money={money} />
        </div>
        <p className="mt-1.5 rounded border border-slate-300 p-2 text-[8.5px] leading-snug text-slate-600">{s.inspectionNote}</p>
        <div className="mt-1.5 grid grid-cols-2 gap-6 font-bold">
          <div className="flex items-end gap-1">
            Nhân viên sửa chữa: <Dots />
          </div>
          <div className="flex items-end gap-1">
            Khách hàng xác nhận: <Dots />
          </div>
        </div>

        <div className="mt-2.5">
          <Bar>Hạng mục đề xuất từ kiểm tra an toàn</Bar>
        </div>
        <div className="mt-1 space-y-3 border border-slate-300 p-2">
          <div className="h-2.5 border-b border-dotted border-slate-400" />
          <div className="h-2.5 border-b border-dotted border-slate-400" />
          <div className="h-2.5 border-b border-dotted border-slate-400" />
        </div>

        <div className="mt-2.5">
          <Bar right={<Line label="Dự kiến hoàn thành:" className="w-[70mm]" />}>Hạng mục sửa chữa phát sinh</Bar>
        </div>
        <div className="mt-1">
          <RepairTable rows={[]} min={10} money={false} />
        </div>
        <div className="mt-0.5 text-[8px] text-slate-500">Cột XÁC NHẬN — I: Kiểm tra và xử lí theo tình trạng · A: Vệ sinh hoặc căn chỉnh · R: Thay thế</div>
        <div className="mt-1.5 grid grid-cols-2 gap-6 font-bold">
          <div className="flex items-end gap-1">
            Nhân viên sửa chữa: <Dots />
          </div>
          <div className="flex items-end gap-1">
            Khách hàng xác nhận: <Dots />
          </div>
        </div>

        <div className="mt-2.5">
          <Bar
            right={
              <span className="flex gap-3 text-[9px]">
                <span className="flex items-center gap-1 text-emerald-700">
                  <Box tone="g" /> ĐẠT
                </span>
                <span className="flex items-center gap-1 text-rose-600">
                  <Box tone="r" /> KHÔNG ĐẠT
                </span>
              </span>
            }
          >
            Hạng mục kiểm tra cuối
          </Bar>
        </div>
        <div className="mt-1 grid grid-cols-3 gap-x-4 gap-y-1.5 border border-slate-300 p-2">
          {FINAL.map((f) => (
            <div key={f} className="flex items-center justify-between gap-2">
              <span>{f}</span>
              <span className="flex gap-1">
                <Box tone="g" />
                <Box tone="r" />
              </span>
            </div>
          ))}
          <div>Khác: ......................................</div>
        </div>
        <div className="ml-auto mt-2 flex w-[110mm] items-end gap-1 font-bold">
          Nhân viên kiểm tra cuối: <Dots />
        </div>
        <div className="mt-1 text-[8px] text-slate-500">Ghi chú: Hạng mục kiểm tra cuối được thực hiện tùy theo nội dung kiểm tra xe, bảo dưỡng hoặc sửa chữa đã chọn.</div>
      </div>
    </>
  );
}

function PrintView() {
  const { mau, id } = useParams<{ mau: string; id: string }>();
  const params = useSearchParams();
  const { status, can } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [data, setData] = useState<PrintData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form: Form = mau === 'tiep-nhan' ? 'kiem-tra' : (mau as Form);
  const variant = (['lop', 'gam', 'ca-hai'].includes(params.get('bh') ?? '') ? params.get('bh') : 'lop') as Variant;

  useEffect(() => {
    if (status === 'anon') router.replace(`/dang-nhap?next=${encodeURIComponent(pathname)}`);
    if (status !== 'authed') return;
    setData(null);
    setError(null);
    api<PrintData>(`/orders/${id}/print?form=${form}`).then(
      (x) => {
        setData(x);
        document.title = `${FORMS.find((f) => f.value === x.form)?.label} ${x.order.code}`;
      },
      (e) => setError(e instanceof ApiError ? e.message : 'Không tải được phiếu'),
    );
  }, [status, id, form, router, pathname]);

  const money = can('ro.manage') || can('payment.collect') || can('finance.view');
  return (
    <div className="min-h-screen bg-slate-100">
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
        <Link href={`/don-hang/${id}`} className="text-sm text-slate-500 hover:text-brand-600">
          ← Về đơn hàng
        </Link>
        <div className="mx-2 flex flex-wrap gap-1">
          {FORMS.filter((f) => f.value === 'kiem-tra' || money).map((f) => (
            <Link key={f.value} href={`/in/${f.value}/${id}`} className={`rounded-full px-3 py-1.5 text-sm ${f.value === form ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
              {f.label}
            </Link>
          ))}
        </div>
        {form === 'bao-gia' && (
          <div className="flex gap-1 rounded-full bg-slate-100 p-1 text-sm" aria-label="Điều khoản bảo hành">
            {(
              [
                ['lop', 'Bảo hành lốp'],
                ['gam', 'Bảo hành gầm'],
                ['ca-hai', 'In cả 2 mẫu'],
              ] as const
            ).map(([v, label]) => (
              <Link key={v} href={`/in/bao-gia/${id}?bh=${v}`} className={`rounded-full px-3 py-1 ${variant === v ? 'bg-white font-medium shadow-sm' : 'text-slate-600'}`}>
                {label}
              </Link>
            ))}
          </div>
        )}
        <div className="flex-1" />
        <button type="button" onClick={() => window.print()} disabled={!data} className="inline-flex items-center gap-2 rounded-full bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50" data-testid="print-button">
          <Printer className="h-4 w-4" />
          In / Lưu PDF
        </button>
      </div>
      {error && <p className="no-print p-8 text-center text-rose-600">{error}</p>}
      {data && data.form === 'kiem-tra' && <InspectionSheet d={data} />}
      {data && data.form === 'bao-gia' && (
        <>
          {variant !== 'gam' && <ServiceSheet d={data} variant="lop" />}
          {variant !== 'lop' && <ServiceSheet d={data} variant="gam" />}
        </>
      )}
      {data && data.form === 'hoa-don' && <ServiceSheet d={data} variant="lop" invoice />}
    </div>
  );
}

export default function PrintPage() {
  return (
    <Suspense>
      <PrintView />
    </Suspense>
  );
}
