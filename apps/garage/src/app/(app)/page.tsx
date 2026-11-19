import { Badge, Card, CardTitle } from '@cardiy/ui';
import { Banknote, Car, CircleCheck, Clock, Smile, TrendingUp, UserPlus } from 'lucide-react';
import { SystemStatus } from '@/components/system-status';

const KPIS = [
  { title: 'Doanh thu tháng', value: '1,24 tỷ', note: '+17% tháng này', icon: Banknote, noteIcon: TrendingUp, noteClass: 'text-mint-700' },
  { title: 'Xe đang trong xưởng', value: '12', note: '3 xe chờ phụ tùng', icon: Car, noteIcon: Clock, noteClass: 'text-peach-700' },
  { title: 'Khách mới', value: '+86', note: 'tháng này', icon: UserPlus, noteIcon: TrendingUp, noteClass: 'text-mint-700' },
  { title: 'Mức hài lòng', value: '92%', note: '+3% tháng này', icon: Smile, noteIcon: TrendingUp, noteClass: 'text-mint-700' },
];

const ROADMAP = [
  { code: 'P0', name: 'Nền móng: khung hệ thống, đăng nhập, phân quyền', state: 'doing' },
  { code: 'P1', name: 'Vận hành garage: lệnh sửa chữa, kho, thu chi', state: 'todo' },
  { code: 'P2', name: 'App chủ xe: đặt lịch, duyệt báo giá', state: 'todo' },
  { code: 'P3', name: 'Sàn trung gian & đối tác garage', state: 'todo' },
  { code: 'P4', name: 'Cứu hộ, thuê xe, xe cũ, cộng đồng', state: 'todo' },
  { code: 'P5', name: 'Marketing & Trợ lý AI', state: 'todo' },
] as const;

export default function DashboardPage() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {KPIS.map(({ title, value, note, icon: Icon, noteIcon: NoteIcon, noteClass }) => (
          <Card key={title} className="p-5">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-700">{title}</span>
              <span className="grid h-9 w-9 place-items-center rounded-full border border-slate-100 bg-white">
                <Icon className="h-4 w-4 text-slate-500" />
              </span>
            </div>
            <div className="mt-4 text-[28px] font-semibold leading-none">{value}</div>
            <div className={`mt-2 flex items-center gap-1 text-xs ${noteClass}`}>
              <NoteIcon className="h-3.5 w-3.5" />
              {note}
            </div>
          </Card>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        <Badge tone="peach">Dữ liệu mẫu</Badge> Số liệu thật sẽ hiển thị từ vòng 1.5 khi có lệnh sửa chữa và thu chi.
      </p>

      <div className="grid gap-4 xl:grid-cols-3">
        <SystemStatus />
        <Card className="p-5 lg:p-6 xl:col-span-2">
          <CardTitle className="mb-4">Lộ trình xây dựng</CardTitle>
          <ol className="space-y-2.5">
            {ROADMAP.map((r) => (
              <li key={r.code} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3">
                <span
                  className={`grid h-9 w-9 place-items-center rounded-full text-xs font-semibold ${
                    r.state === 'doing' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {r.code}
                </span>
                <span className="flex-1 text-sm">{r.name}</span>
                {r.state === 'doing' ? (
                  <Badge tone="sky">
                    <CircleCheck className="h-3.5 w-3.5" />
                    Đang làm
                  </Badge>
                ) : (
                  <Badge tone="slate">Chưa bắt đầu</Badge>
                )}
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}
