'use client';

import { Alert, Button, Card, CardTitle, Checkbox, Field, Input, Spinner } from '@cardiy/ui';
import { CheckCircle2, CircleAlert, ImagePlus, MapPin, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { DAY_NAMES, defaultHours, fullWeek, parseLatLng, uploadImage, type OpeningDay, type ShopInfo } from '@/lib/marketplace';

type Form = {
  name: string;
  slug: string;
  intro: string;
  phone: string;
  address: string;
  province: string;
  coords: string;
  hours: OpeningDay[];
  returnPolicy: string;
  warrantyPolicy: string;
  cancelPolicy: string;
  logo: { id: string; url: string | null } | null;
  cover: { id: string; url: string | null } | null;
};

function toForm(i: ShopInfo): Form {
  const s = i.shop;
  return {
    name: s.name ?? '',
    slug: s.slug ?? '',
    intro: s.intro ?? '',
    phone: s.phone ?? '',
    address: s.address ?? '',
    province: s.province ?? '',
    coords: s.lat != null && s.lng != null ? `${s.lat}, ${s.lng}` : '',
    hours: s.openingHours.length ? fullWeek(s.openingHours) : defaultHours(),
    returnPolicy: s.returnPolicy ?? '',
    warrantyPolicy: s.warrantyPolicy ?? '',
    cancelPolicy: s.cancelPolicy ?? '',
    logo: s.logoFileId ? { id: s.logoFileId, url: s.logoUrl } : null,
    cover: s.coverFileId ? { id: s.coverFileId, url: s.coverUrl } : null,
  };
}

const area = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100';

function ImageSlot({ label, value, onChange, wide }: { label: string; value: Form['logo']; onChange: (v: Form['logo']) => void; wide?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div>
      <div className="mb-1.5 text-sm font-medium text-slate-700">{label}</div>
      <div className={`relative grid place-items-center overflow-hidden rounded-2xl border border-dashed border-slate-300 bg-slate-50 ${wide ? 'h-28 w-full' : 'h-28 w-28'}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {value?.url ? <img src={value.url} alt={label} className="h-full w-full object-cover" /> : busy ? <Spinner /> : <ImagePlus className="h-6 w-6 text-slate-400" />}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-label={label}
          className="absolute inset-0 cursor-pointer opacity-0"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            setBusy(true);
            setErr(null);
            try {
              onChange(await uploadImage(f));
            } catch (x) {
              setErr(x instanceof ApiError ? x.message : 'Không tải được ảnh');
            } finally {
              setBusy(false);
            }
          }}
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={`Bỏ ${label}`}
            className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-white/90 text-slate-600 shadow"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {err && <p className="mt-1 text-xs text-rose-700">{err}</p>}
    </div>
  );
}

/** A7.10 / A3.50 Hồ sơ gian hàng trên sàn */
export function ShopProfile() {
  const [info, setInfo] = useState<ShopInfo | null>(null);
  const [f, setF] = useState<Form | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<ShopInfo>('/shop').then((i) => (setInfo(i), setF(toForm(i))));
  }, []);
  if (!info || !f)
    return (
      <div className="grid place-items-center p-16">
        <Spinner className="h-6 w-6 text-brand-600" />
      </div>
    );

  const set = (k: keyof Form) => (e: { target: { value: string } }) => (setF({ ...f, [k]: e.target.value }), setMsg(null));
  const setDay = (day: number, patch: Partial<OpeningDay>) => setF({ ...f, hours: f.hours.map((d) => (d.day === day ? { ...d, ...patch } : d)) });
  const coords = f.coords.trim() ? parseLatLng(f.coords) : null;

  const save = async () => {
    setError(null);
    setMsg(null);
    if (f.coords.trim() && !coords) return setError('Toạ độ chưa đúng. Dán dạng "10.9625, 106.8862" hoặc link Google Maps.');
    setBusy(true);
    try {
      const r = await api<ShopInfo>('/shop', {
        method: 'PUT',
        body: {
          name: f.name,
          slug: f.slug,
          intro: f.intro,
          phone: f.phone,
          address: f.address,
          province: f.province,
          lat: coords?.lat ?? null,
          lng: coords?.lng ?? null,
          openingHours: f.hours.map((d) => (d.closed ? { ...d, open: '', close: '' } : d)),
          returnPolicy: f.returnPolicy,
          warrantyPolicy: f.warrantyPolicy,
          cancelPolicy: f.cancelPolicy,
          logoFileId: f.logo?.id ?? null,
          coverFileId: f.cover?.id ?? null,
        },
      });
      setInfo(r);
      setF(toForm(r));
      setMsg('Đã lưu hồ sơ gian hàng.');
    } catch (e) {
      setError(e instanceof ApiError ? (e.errors?.[0]?.message ?? e.message) : 'Không lưu được');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-5" data-testid="shop-readiness">
        {info.missing.length ? (
          <div className="flex gap-3">
            <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-peach-700" />
            <div>
              <div className="font-semibold">Gian hàng chưa hiện trên sàn. Còn thiếu:</div>
              <ul className="mt-1 list-disc pl-5 text-sm text-slate-600">
                {info.missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 text-mint-700">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-semibold">Gian hàng đủ điều kiện hiện trên sàn · {info.liveOffers} tin đang bán</span>
          </div>
        )}
      </Card>

      <Card className="space-y-4 p-5">
        <CardTitle>Thông tin gian hàng</CardTitle>
        <div className="grid gap-4 md:grid-cols-[auto_1fr]">
          <ImageSlot label="Logo" value={f.logo} onChange={(logo) => setF({ ...f, logo })} />
          <ImageSlot label="Ảnh bìa" value={f.cover} onChange={(cover) => setF({ ...f, cover })} wide />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tên gian hàng">{(id) => <Input id={id} value={f.name} onChange={set('name')} />}</Field>
          <Field label="Đường dẫn gian hàng" hint={f.slug ? `cardiy.vn/garage/${f.slug}` : 'Để trống: tự tạo từ tên gian hàng'}>
            {(id) => <Input id={id} value={f.slug} onChange={set('slug')} placeholder="vd: minh-phat-auto" />}
          </Field>
          <Field label="Số điện thoại / hotline">{(id) => <Input id={id} inputMode="tel" value={f.phone} onChange={set('phone')} />}</Field>
          <Field label="Tỉnh / thành phố">{(id) => <Input id={id} value={f.province} onChange={set('province')} />}</Field>
          <Field label="Địa chỉ" className="sm:col-span-2">
            {(id) => <Input id={id} value={f.address} onChange={set('address')} />}
          </Field>
          <Field
            label="Vị trí trên bản đồ"
            className="sm:col-span-2"
            error={f.coords.trim() && !coords ? 'Chưa đọc được toạ độ' : null}
            hint={
              <>
                Mở Google Maps, nhấn giữ vào vị trí garage, sao chép toạ độ (hoặc link) rồi dán vào đây.
                {coords && (
                  <a
                    href={`https://www.google.com/maps?q=${coords.lat},${coords.lng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-1 inline-flex items-center gap-0.5 font-medium text-brand-700 hover:underline"
                  >
                    <MapPin className="h-3 w-3" /> Xem trên bản đồ
                  </a>
                )}
              </>
            }
          >
            {(id) => <Input id={id} value={f.coords} onChange={set('coords')} placeholder="10.9625, 106.8862" />}
          </Field>
          <Field label="Giới thiệu" className="sm:col-span-2">
            {(id) => <textarea id={id} rows={3} value={f.intro} onChange={set('intro')} className={area} placeholder="Thế mạnh, số khoang sửa, hãng xe chuyên…" />}
          </Field>
        </div>
      </Card>

      <Card className="p-5">
        <CardTitle>Giờ mở cửa</CardTitle>
        <div className="mt-3 divide-y divide-slate-100" data-testid="opening-hours">
          {f.hours.map((d) => (
            <div key={d.day} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="w-20 font-medium">{DAY_NAMES[d.day]}</span>
              <Checkbox label="Nghỉ" checked={d.closed} onChange={(e) => setDay(d.day, e.target.checked ? { closed: true } : { closed: false, open: d.open || '07:30', close: d.close || '17:30' })} />
              {!d.closed && (
                <>
                  <Input type="time" value={d.open} onChange={(e) => setDay(d.day, { open: e.target.value })} className="w-32" aria-label={`Mở cửa ${DAY_NAMES[d.day]}`} />
                  <span className="text-slate-400">–</span>
                  <Input type="time" value={d.close} onChange={(e) => setDay(d.day, { close: e.target.value })} className="w-32" aria-label={`Đóng cửa ${DAY_NAMES[d.day]}`} />
                </>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <CardTitle>Chính sách (khách xem trước khi đặt)</CardTitle>
        <Field label="Bảo hành">
          {(id) => <textarea id={id} rows={2} value={f.warrantyPolicy} onChange={set('warrantyPolicy')} className={area} placeholder="Bảo hành lắp đặt 3 tháng, lốp theo chính sách hãng…" />}
        </Field>
        <Field label="Đổi trả">{(id) => <textarea id={id} rows={2} value={f.returnPolicy} onChange={set('returnPolicy')} className={area} />}</Field>
        <Field label="Huỷ lịch / huỷ đơn">{(id) => <textarea id={id} rows={2} value={f.cancelPolicy} onChange={set('cancelPolicy')} className={area} />}</Field>
      </Card>

      {error && <Alert>{error}</Alert>}
      {msg && <Alert tone="mint">{msg}</Alert>}
      <div className="flex justify-end">
        <Button onClick={() => void save()} disabled={busy} data-testid="save-shop">
          {busy && <Spinner />}
          Lưu hồ sơ gian hàng
        </Button>
      </div>
    </div>
  );
}
