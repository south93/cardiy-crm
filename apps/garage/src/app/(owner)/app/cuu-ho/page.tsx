'use client';

import { Alert, Badge, Button, Card, Field, Input, Select, Spinner } from '@cardiy/ui';
import { ArrowLeft, ChevronRight, ImagePlus, LifeBuoy, LocateFixed, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { convertImageToWebp } from '@/lib/image-webp';
import { fmtDateTime } from '@/lib/orders';
import { ownerApi } from '@/lib/owner';
import { SOS_ISSUES, SOS_STATUS_UI, type SosDetail, type SosIssueType } from '@/lib/sos';

interface SosVehicleOpt {
  id: string;
  plate: string;
  info: string | null;
}

/** A2.10 Màn hình SOS trên App chủ xe */
export default function OwnerSosPage() {
  const router = useRouter();
  const [vehicles, setVehicles] = useState<SosVehicleOpt[] | null>(null);
  const [history, setHistory] = useState<SosDetail[]>([]);
  const [vehicleId, setVehicleId] = useState('');
  const [plateNo, setPlateNo] = useState('');
  const [vehicleInfo, setVehicleInfo] = useState('');
  const [lat, setLat] = useState('11.53');
  const [lng, setLng] = useState('106.88');
  const [addressText, setAddressText] = useState('');
  const [issueType, setIssueType] = useState<SosIssueType>('HET_BINH');
  const [description, setDescription] = useState('');
  const [images, setImages] = useState<{ id: string; name: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      ownerApi<SosVehicleOpt[]>('/sos/vehicles'),
      ownerApi<{ items: SosDetail[] }>('/sos'),
    ]).then(([vs, list]) => {
      setVehicles(vs);
      if (vs[0]) setVehicleId(vs[0].id);
      setHistory(list.items);
    });
  }, []);

  function detectLocation() {
    if (!navigator.geolocation) {
      setError('Trình duyệt không hỗ trợ GPS, vui lòng nhập địa điểm bên dưới.');
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
        setError('Không lấy được GPS tự động. Bạn có thể nhập tay vị trí.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (images.length >= 4) {
      setError('Tối đa 4 ảnh sự cố');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const webpFile = await convertImageToWebp(file);
      const form = new FormData();
      form.append('file', webpFile);
      const uploaded = await ownerApi<{ id: string; name: string }>('/sos/upload', { form });
      setImages((prev) => [...prev, { id: uploaded.id, name: uploaded.name }]);
    } catch (ex) {
      setError(ex instanceof ApiError ? ex.message : 'Tải ảnh thất bại');
    } finally {
      setUploading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await ownerApi<{ id: string }>('/sos', {
        body: {
          vehicleId: vehicleId || null,
          plateNo: vehicleId ? null : plateNo || null,
          vehicleInfo: vehicleId ? null : vehicleInfo || null,
          lat: Number(lat),
          lng: Number(lng),
          addressText: addressText || null,
          issueType,
          description: description || null,
          imageFileIds: images.map((i) => i.id),
        },
      });
      router.push(`/app/cuu-ho/${res.id}`);
    } catch (ex) {
      setError(ex instanceof ApiError ? ex.message : 'Không gửi được yêu cầu cứu hộ');
    } finally {
      setSubmitting(false);
    }
  }

  if (!vehicles) return <Spinner className="h-6 w-6 text-brand-600" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/app" className="rounded-full p-1.5 text-slate-600 hover:bg-white">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-xl font-semibold text-rose-700">Cứu hộ khẩn cấp SOS</h1>
      </div>

      <Card className="p-4">
        <form onSubmit={submit} className="space-y-3.5" data-testid="owner-sos-form">
          {error && <Alert>{error}</Alert>}

          {vehicles.length > 0 && (
            <Field label="Chọn xe gặp sự cố">
              {(id) => (
                <Select id={id} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.plate} {v.info ? `· ${v.info}` : ''}
                    </option>
                  ))}
                  <option value="">Xe khác (nhập biển số tay)</option>
                </Select>
              )}
            </Field>
          )}

          {!vehicleId && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Biển số xe">
                {(id) => <Input id={id} value={plateNo} onChange={(e) => setPlateNo(e.target.value)} placeholder="93A-123.45" />}
              </Field>
              <Field label="Dòng xe">
                {(id) => <Input id={id} value={vehicleInfo} onChange={(e) => setVehicleInfo(e.target.value)} placeholder="Mazda CX-5" />}
              </Field>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 rounded-2xl bg-slate-50 p-3">
            <span className="text-xs text-slate-600">Toạ độ GPS hiện tại</span>
            <Button type="button" variant="outline" onClick={detectLocation} disabled={locating}>
              <LocateFixed className="h-4 w-4" /> {locating ? 'Đang định vị…' : 'Lấy GPS'}
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Vĩ độ">
              {(id) => <Input id={id} type="number" step="any" required value={lat} onChange={(e) => setLat(e.target.value)} />}
            </Field>
            <Field label="Kinh độ">
              {(id) => <Input id={id} type="number" step="any" required value={lng} onChange={(e) => setLng(e.target.value)} />}
            </Field>
          </div>

          <Field label="Địa điểm / mốc đường">
            {(id) => <Input id={id} value={addressText} onChange={(e) => setAddressText(e.target.value)} placeholder="VD: Ngã tư Đồng Xoài, hướng QL14…" />}
          </Field>

          <Field label="Loại sự cố">
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

          <Field label="Mô tả tình trạng">
            {(id) => <Input id={id} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Mô tả thêm để đội cứu hộ chuẩn bị đồ nghề…" />}
          </Field>

          <div className="space-y-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">
              <ImagePlus className="h-4 w-4" />
              {uploading ? 'Đang tải ảnh…' : 'Đính kèm ảnh hiện trường'}
              <input type="file" accept="image/*" onChange={onPickFile} disabled={uploading} className="hidden" />
            </label>
            {images.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {images.map((img) => (
                  <li key={img.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs">
                    <span className="max-w-[140px] truncate">{img.name}</span>
                    <button type="button" onClick={() => setImages((xs) => xs.filter((x) => x.id !== img.id))} aria-label="Xoá ảnh">
                      <X className="h-3.5 w-3.5 text-slate-500" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Button type="submit" disabled={submitting} className="w-full justify-center bg-rose-600 py-3 text-base hover:bg-rose-700" data-testid="owner-sos-submit">
            <LifeBuoy className="h-5 w-5" /> {submitting ? 'Đang phát tín hiệu…' : 'Gửi tín hiệu SOS ngay'}
          </Button>
        </form>
      </Card>

      {history.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-600">Lịch sử cứu hộ của bạn</h2>
          <ul className="space-y-2" data-testid="owner-sos-history">
            {history.map((h) => (
              <li key={h.id}>
                <Link href={`/app/cuu-ho/${h.id}`} className="block">
                  <Card className="flex items-center justify-between gap-2 p-3.5">
                    <div>
                      <div className="font-mono text-sm font-semibold">{h.code}</div>
                      <div className="text-xs text-slate-500">
                        {h.issueLabel} · {fmtDateTime(h.createdAt)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Badge tone={SOS_STATUS_UI[h.status].tone}>{SOS_STATUS_UI[h.status].label}</Badge>
                      <ChevronRight className="h-4 w-4 text-slate-400" />
                    </div>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
