'use client';

import { Alert, Badge, Button, Card, Field, Input, Spinner } from '@cardiy/ui';
import { ArrowLeft, Car, MapPin, MessageSquare, Phone, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppraisalReportCard } from '@/components/appraisal-report-card';
import { ApiError } from '@/lib/api';
import {
  BODY_STYLE_LABEL,
  defaultInspectionDateTime,
  fmtCarPrice,
  fmtVnd,
  FUEL_LABEL,
  localInputToIso,
  publicUsedCarGet,
  publicUsedCarPost,
  TRANSMISSION_LABEL,
  type UsedCarListingItem,
} from '@/lib/used-cars';

/** A1.07 Chi tiết xe cũ + Báo cáo kiểm định kỹ thuật + Chat / Hẹn xem xe với người bán */
export default function PublicUsedCarDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [car, setCar] = useState<UsedCarListingItem | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [viewingLocal, setViewingLocal] = useState(defaultInspectionDateTime());
  const [message, setMessage] = useState('Chào anh/chị, xe còn không ạ? Mình muốn hẹn qua xem xe trực tiếp.');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    publicUsedCarGet<UsedCarListingItem>(`/${id}`)
      .then(setCar)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Không tìm thấy tin bán xe'));
  }, [id]);

  async function submitInquiry(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await publicUsedCarPost<{ trackUrl: string }>(`/${id}/inquiries`, {
        name,
        phone,
        message,
        viewingAt: viewingLocal ? localInputToIso(viewingLocal) : null,
      });
      router.push(res.trackUrl);
    } catch (ex) {
      setError(ex instanceof ApiError ? ex.message : 'Gửi tin nhắn thất bại');
    } finally {
      setSubmitting(false);
    }
  }

  if (error && !car) return <Alert>{error}</Alert>;
  if (!car) return <Spinner className="h-6 w-6 text-brand-600" />;

  return (
    <div className="space-y-4">
      <Link href="/cho/xe-cu" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" /> Quay lại danh sách xe cũ
      </Link>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-5 lg:col-span-3">
          <Card className="overflow-hidden p-0">
            <div className="relative grid h-72 place-items-center bg-slate-100 text-slate-400">
              {car.images[0]?.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={car.images[0].url} alt={car.title} className="h-72 w-full object-cover" />
              ) : (
                <Car className="h-16 w-16" />
              )}
              {car.hasVerifiedBadge && (
                <span
                  className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow"
                  data-testid="detail-verified-badge"
                >
                  <ShieldCheck className="h-4 w-4" /> Xe Đã kiểm định đạt chuẩn
                </span>
              )}
            </div>

            <div className="space-y-4 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-mono text-slate-400">Mã tin: {car.code}</div>
                  <h1 className="mt-0.5 text-2xl font-bold text-slate-900" data-testid="used-car-detail-title">
                    {car.title}
                  </h1>
                  <div className="mt-1 flex items-center gap-1 text-sm text-slate-500">
                    <MapPin className="h-4 w-4" /> {car.addressText ? `${car.addressText}, ${car.province}` : car.province}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-extrabold text-emerald-700">{fmtCarPrice(car.price)}</div>
                  <div className="text-xs text-slate-500">
                    ({fmtVnd(car.price)}){car.negotiable ? ' · Có thương lượng' : ''}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-4 text-sm sm:grid-cols-4">
                <div>
                  <div className="text-xs text-slate-500">Hãng / Dòng</div>
                  <div className="font-semibold">
                    {car.make} {car.model}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Năm sản xuất</div>
                  <div className="font-semibold">{car.year}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Số ODO đã đi</div>
                  <div className="font-semibold">{car.mileageKm.toLocaleString('vi-VN')} km</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Hộp số / Nhiên liệu</div>
                  <div className="font-semibold">
                    {TRANSMISSION_LABEL[car.transmission]} · {FUEL_LABEL[car.fuel]}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Kiểu dáng / Số chỗ</div>
                  <div className="font-semibold">
                    {BODY_STYLE_LABEL[car.bodyStyle] ?? car.bodyStyle} · {car.seats} chỗ
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Màu ngoại thất</div>
                  <div className="font-semibold">{car.exteriorColor || '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Số đời chủ</div>
                  <div className="font-semibold">{car.ownersCount} chủ</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Biển số</div>
                  <div className="font-mono font-semibold">{car.plateNo || '—'}</div>
                </div>
              </div>

              {car.description && (
                <div>
                  <h2 className="text-sm font-semibold text-slate-800">Mô tả của người bán</h2>
                  <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{car.description}</p>
                </div>
              )}
            </div>
          </Card>

          {car.appraisalReport ? (
            <AppraisalReportCard report={car.appraisalReport} />
          ) : (
            <Card className="p-4 text-sm text-slate-600">
              <Badge tone="slate">Tin thường</Badge>{' '}
              <span className="ml-1">Xe chưa đính kèm báo cáo kiểm định kỹ thuật. Bạn nên hẹn mang xe tới garage đối tác trên sàn để kiểm định trước khi giao dịch.</span>
            </Card>
          )}
        </div>

        <aside className="lg:col-span-2 space-y-4">
          <Card className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-slate-500">{car.sellerType === 'GARAGE' ? 'Đăng bán bởi Garage' : 'Đăng bán bởi Chủ xe'}</div>
                <div className="text-base font-bold text-slate-900">
                  {car.sellerShop?.slug ? (
                    <Link href={`/cho/garage/${car.sellerShop.slug}`} className="hover:text-brand-700 hover:underline">
                      {car.sellerShop.name}
                    </Link>
                  ) : (
                    car.contactName
                  )}
                </div>
              </div>
              <a
                href={`tel:${car.contactPhone}`}
                className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                <Phone className="h-4 w-4" /> {car.contactPhone}
              </a>
            </div>
          </Card>

          <Card className="sticky top-20 p-5">
            <h2 className="text-lg font-semibold text-slate-900">Chat hỏi xe & Hẹn xem xe</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Gửi tin nhắn trực tiếp tới người bán kèm lịch hẹn xem xe. Hệ thống tạo phòng chat riêng để bạn theo dõi phản hồi.
            </p>

            <form onSubmit={submitInquiry} className="mt-4 space-y-3.5" data-testid="public-used-car-inquiry-form">
              {error && <Alert>{error}</Alert>}

              <Field label="Họ và tên của bạn *">
                {(fid) => <Input id={fid} required value={name} onChange={(e) => setName(e.target.value)} placeholder="Trần Minh Tuấn" />}
              </Field>
              <Field label="Số điện thoại liên hệ *">
                {(fid) => <Input id={fid} required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0912345678" />}
              </Field>
              <Field label="Đề xuất ngày giờ xem xe">
                {(fid) => <Input id={fid} type="datetime-local" value={viewingLocal} onChange={(e) => setViewingLocal(e.target.value)} />}
              </Field>
              <Field label="Nội dung nhắn người bán *">
                {(fid) => <Input id={fid} required value={message} onChange={(e) => setMessage(e.target.value)} />}
              </Field>

              <Button type="submit" disabled={submitting} className="w-full justify-center py-2.5 text-base" data-testid="used-car-inquiry-submit">
                <MessageSquare className="h-4 w-4" /> {submitting ? 'Đang gửi…' : 'Gửi tin nhắn & Hẹn xem xe'}
              </Button>
            </form>
          </Card>
        </aside>
      </div>
    </div>
  );
}
