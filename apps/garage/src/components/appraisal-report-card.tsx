'use client';

import { Badge, Card } from '@cardiy/ui';
import { CheckCircle2, ShieldAlert, ShieldCheck, XCircle } from 'lucide-react';
import Link from 'next/link';
import { fmtDateTime } from '@/lib/orders';
import { APPRAISAL_GRADE_UI, type ChecklistItemStatus, type UsedCarAppraisalItem } from '@/lib/used-cars';

const CHECKLIST_STATUS_UI: Record<ChecklistItemStatus, { label: string; cls: string }> = {
  TOT: { label: 'Tốt', cls: 'bg-emerald-100 text-emerald-800' },
  LUU_Y: { label: 'Lưu ý', cls: 'bg-amber-100 text-amber-800' },
  KHONG_DAT: { label: 'Không đạt', cls: 'bg-rose-100 text-rose-800' },
};

export function AppraisalReportCard({ report }: { report: UsedCarAppraisalItem }) {
  const gradeUi = report.grade ? APPRAISAL_GRADE_UI[report.grade] : { label: 'Đã kiểm định', tone: 'mint' as const };

  return (
    <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50/60 to-white p-5 space-y-4" data-testid="used-car-appraisal-report">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white">
              <ShieldCheck className="h-4 w-4" /> Báo cáo kiểm định kỹ thuật
            </span>
            <Badge tone={gradeUi.tone}>{gradeUi.label}</Badge>
            <span className="font-mono text-xs text-slate-500">#{report.code}</span>
          </div>
          <p className="mt-1.5 text-sm text-slate-700">
            Đơn vị kiểm định:{' '}
            <b>
              {report.garage.slug ? (
                <Link href={`/cho/garage/${report.garage.slug}`} className="text-brand-700 hover:underline">
                  {report.garage.name}
                </Link>
              ) : (
                report.garage.name
              )}
            </b>
            {report.completedAt ? ` · Ngày kiểm định: ${fmtDateTime(report.completedAt)}` : ''}
            {report.inspectedMileageKm != null ? ` · ODO đối chiếu: ${report.inspectedMileageKm.toLocaleString('vi-VN')} km` : ''}
          </p>
        </div>

        {report.score !== null && (
          <div className="rounded-2xl bg-white px-4 py-2 text-center shadow-sm border border-emerald-100" data-testid="appraisal-score-box">
            <div className="text-2xl font-extrabold text-emerald-700 tabular-nums">{report.score}/100</div>
            <div className="text-[11px] font-medium text-slate-500">Điểm kỹ thuật</div>
          </div>
        )}
      </div>

      <div className="grid gap-2.5 sm:grid-cols-3 text-xs">
        {[
          { ok: report.noMajorAccident, okText: 'Không đâm đụng khung gầm', failText: 'Có dấu hiệu va chạm khung gầm' },
          { ok: report.noFloodDamage, okText: 'Không thuỷ kích / ngập nước', failText: 'Có dấu hiệu ngập nước / thuỷ kích' },
          { ok: report.validDocuments, okText: 'Số khung, số máy & giấy tờ hợp lệ', failText: 'Giấy tờ cần đối chiếu lại' },
        ].map((flag) => (
          <div
            key={flag.okText}
            className={`flex items-center gap-2 rounded-xl px-3 py-2 font-medium ${flag.ok ? 'bg-emerald-100/70 text-emerald-900' : 'bg-rose-100 text-rose-900'}`}
          >
            {flag.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <XCircle className="h-4 w-4 shrink-0 text-rose-600" />}
            <span>{flag.ok ? flag.okText : flag.failText}</span>
          </div>
        ))}
      </div>

      {report.summary && (
        <div className="rounded-2xl bg-white/90 border border-slate-200/80 px-4 py-3 text-sm text-slate-700">
          <b>Kết luận chuyên môn:</b> {report.summary}
        </div>
      )}

      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Chi tiết 6 nhóm hạng mục kiểm định</div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {report.checklist.map((item) => {
            const st = CHECKLIST_STATUS_UI[item.status] ?? CHECKLIST_STATUS_UI.TOT;
            return (
              <li key={item.key} className="rounded-xl border border-slate-200/80 bg-white p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-800">{item.group}</span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${st.cls}`}>{st.label}</span>
                </div>
                <div className="mt-0.5 text-xs text-slate-500">{item.label}</div>
                {item.note && (
                  <div className="mt-1 flex items-center gap-1 text-xs text-slate-700">
                    <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-slate-400" /> {item.note}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {report.reportImages.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {report.reportImages.map(
            (img) =>
              img.url && (
                <a key={img.id} href={img.url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-xl border border-slate-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt="Ảnh kiểm định" className="h-20 w-28 object-cover" />
                </a>
              ),
          )}
        </div>
      )}
    </Card>
  );
}
