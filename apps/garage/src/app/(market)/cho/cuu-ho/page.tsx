'use client';

import { Alert, Badge, Button, Card, Field, Input, Select, Spinner } from '@cardiy/ui';
import { LifeBuoy, LocateFixed, MapPin, Phone } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { fmtMoney, publicSosGet, publicSosPost, SOS_ISSUES, type PublicRescueGarage, type SosIssueType } from '@/lib/sos';

/** A1.09 Cứu hộ SOS trên web sàn công khai (không cần tài khoản) */
export default function PublicSosPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [plateNo, setPlateNo] = useState('');
  const [vehicleInfo, setVehicleInfo] = useState('');
  const [lat, setLat] = useState('11.53');
  const [lng, setLng] = useState('106.88');
  const [addressText, setAddressText] = useState('');
  const [issueType, setIssueType] = useState<SosIssueType>('HET_BINH');
  const [description, setDescription] = useState('');
  const [locating, setLocating] = useState(false);
  const [garages, setGarages] = useState<PublicRescueGarage[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadGarages = useCallback(async (la: string, ln: string) => {
    try {
      const qs = new URLSearchParams();
      if (la.trim() && ln.trim()) {
        qs.set('lat', la.trim());
        qs.set('lng', ln.trim());
      }
      setGarages(await publicSosGet<PublicRescueGarage[]>(`/garages${qs.size ? `?${qs}` : ''}`));
    } catch {
      setGarages([]);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void loadGarages(lat, lng), 250);
    return () => clearTimeout(t);
  }, [lat, lng, loadGarages]);

  function detectLocation() {
    if (!navigator.geolocation) {
      setError('Trình duyệt không hỗ trợ định vị GPS. Vui lòng nhập toạ độ hoặc địa chỉ.');
      return;
    }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        setLocating(false);
      },
      () => {
        setError('Không lấy được vị trí tự động. Vui lòng cho phép quyền vị trí hoặc nhập mô tả địa điểm.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await publicSosPost<{ id: string; token: string; trackUrl: string }>('', {
        name,
        phone,
        plateNo: plateNo || null,
        vehicleInfo: vehicleInfo || null,
        lat: Number(lat),
        lng: Number(lng),
        addressText: addressText || null,
        issueType,
        description: description || null,
      });
      router.push(res.trackUrl);
    } catch (ex) {
      setError(ex instanceof ApiError ? ex.message : 'Không gửi được yêu cầu cứu hộ');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="space-y-4 lg:col-span-3">
        <div className="rounded-3xl bg-gradient-to-br from-rose-600 to-rose-700 p-6 text-white">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-rose-100">
            <LifeBuoy className="h-4 w-4" /> Kết nối cứu hộ khẩn cấp
          </div>
          <h1 className="mt-1 text-2xl font-bold">Gọi cứu hộ ô tô gần bạn</h1>
          <p className="mt-1 text-sm text-rose-50/95">
            Sàn CARDIY gửi tín hiệu ngay tới các garage có đội cứu hộ đang trực trong bán kính phục vụ. Nếu sau 3 phút chưa có garage nhận trực tuyến, hệ thống hiện ngay hotline cứu hộ gần nhất để bạn gọi thẳng.
          </p>
        </div>

        <Card className="p-5">
          <form onSubmit={submit} className="space-y-4" data-testid="public-sos-form">
            {error && <Alert>{error}</Alert>}

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-50 p-3.5">
              <div className="text-sm">
                <div className="font-medium text-slate-800">Vị trí xe gặp sự cố</div>
                <div className="text-xs text-slate-500">Bấm định vị GPS hoặc nhập toạ độ & mô tả mốc đường để đội cứu hộ tìm nhanh</div>
              </div>
              <Button type="button" variant="outline" onClick={detectLocation} disabled={locating} data-testid="sos-detect-gps">
                <LocateFixed className="h-4 w-4" /> {locating ? 'Đang lấy GPS…' : 'Lấy vị trí GPS'}
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Vĩ độ (Lat)">
                {(id) => <Input id={id} type="number" step="any" required value={lat} onChange={(e) => setLat(e.target.value)} />}
              </Field>
              <Field label="Kinh độ (Lng)">
                {(id) => <Input id={id} type="number" step="any" required value={lng} onChange={(e) => setLng(e.target.value)} />}
              </Field>
            </div>

            <Field label="Địa chỉ / mốc đường dễ nhận biết">
              {(id) => (
                <Input
                  id={id}
                  value={addressText}
                  onChange={(e) => setAddressText(e.target.value)}
                  placeholder="VD: QL14 đoạn qua Đồng Xoài, cách ngã tư 200m…"
                />
              )}
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Họ và tên *">
                {(id) => <Input id={id} required value={name} onChange={(e) => setName(e.target.value)} placeholder="Nguyễn Văn A" />}
              </Field>
              <Field label="Số điện thoại liên hệ *">
                {(id) => <Input id={id} required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0912345678" />}
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Biển số xe">
                {(id) => <Input id={id} value={plateNo} onChange={(e) => setPlateNo(e.target.value)} placeholder="93A-123.45" />}
              </Field>
              <Field label="Hãng / dòng xe">
                {(id) => <Input id={id} value={vehicleInfo} onChange={(e) => setVehicleInfo(e.target.value)} placeholder="Toyota Vios 2021" />}
              </Field>
            </div>

            <Field label="Loại sự cố *">
              {(id) => (
                <Select id={id} value={issueType} onChange={(e) => setIssueType(e.target.value as SosIssueType)}>
                  {SOS_ISSUES.map((i) => (
                    <option key={i.value} value={i.value}>
                      {i.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field label="Mô tả chi tiết tình trạng xe">
              {(id) => (
                <Input
                  id={id}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="VD: Đề không lên điện, xe đỗ sát lề phải…"
                />
              )}
            </Field>

            <Button type="submit" disabled={submitting} className="w-full justify-center bg-rose-600 py-3 text-base hover:bg-rose-700" data-testid="sos-submit-btn">
              <LifeBuoy className="h-5 w-5" /> {submitting ? 'Đang phát tín hiệu SOS…' : 'Gửi yêu cầu cứu hộ khẩn cấp'}
            </Button>
          </form>
        </Card>
      </div>

      <aside className="space-y-3 lg:col-span-2">
        <h2 className="text-base font-semibold text-slate-800">Garage có dịch vụ cứu hộ trên sàn</h2>
        {!garages ? (
          <Spinner className="h-6 w-6 text-brand-600" />
        ) : !garages.length ? (
          <Card className="p-5 text-sm text-slate-500">Chưa có garage nào bật dịch vụ cứu hộ.</Card>
        ) : (
          <ul className="space-y-2.5" data-testid="public-sos-garages">
            {garages.map((g) => (
              <li key={g.tenantId}>
                <Card className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-slate-900">
                        {g.slug ? (
                          <Link href={`/cho/garage/${g.slug}`} className="hover:text-brand-700 hover:underline">
                            {g.name}
                          </Link>
                        ) : (
                          g.name
                        )}
                      </div>
                      {g.address && (
                        <div className="flex items-center gap-1 text-xs text-slate-500">
                          <MapPin className="h-3.5 w-3.5 shrink-0" /> {g.address}
                        </div>
                      )}
                    </div>
                    <Badge tone={g.onDuty ? 'mint' : 'slate'}>{g.onDuty ? 'Đang trực' : 'Tạm nghỉ'}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
                    <span>Bán kính {g.radiusKm} km</span>
                    {g.distanceKm !== null && (
                      <span className={g.inRange ? 'font-medium text-emerald-700' : 'text-amber-700'}>
                        Cách ~{g.distanceKm} km
                      </span>
                    )}
                    {g.basePrice > 0 && <span>Giá từ {fmtMoney(g.basePrice)}</span>}
                  </div>
                  {g.note && <p className="text-xs text-slate-500">{g.note}</p>}
                  {g.hotline && (
                    <div>
                      <a
                        href={`tel:${g.hotline}`}
                        className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                      >
                        <Phone className="h-3.5 w-3.5" /> Hotline {g.hotline}
                      </a>
                    </div>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
