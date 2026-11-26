'use client';

import { Alert, Badge, Button, Card, Dialog, Field, Input, Select, Spinner, Tabs } from '@cardiy/ui';
import { Bookmark, ChevronRight, ClipboardCheck, FileText, ImagePlus, MessageSquare, Plus, Send, ShieldCheck, Tag } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { ownerApi } from '@/lib/owner';
import {
  APPRAISAL_STATUS_UI,
  BODY_STYLE_LABEL,
  defaultInspectionDateTime,
  fmtCarPrice,
  fmtVnd,
  localInputToIso,
  ownerUploadUsedCarPhoto,
  publicUsedCarGet,
  TRANSMISSION_LABEL,
  USED_CAR_LISTING_UI,
  VIEWING_STATUS_UI,
  type AppraisalGarageItem,
  type UsedCarListingItem,
  type UsedCarThreadItem,
} from '@/lib/used-cars';

interface MyVehicleOption {
  id: string;
  plateNo: string;
  vin: string | null;
  make: string;
  model: string;
  year: number;
  mileageKm: number;
  color: string | null;
}

/** A2.09 Xe cũ trên App chủ xe: Tin đăng của tôi + Đặt kiểm định, Tin đã lưu, Hội thoại */
export default function OwnerUsedCarsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<'mine' | 'browse' | 'threads'>('mine');
  const [savedOnly, setSavedOnly] = useState(false);

  const [myListings, setMyListings] = useState<UsedCarListingItem[] | null>(null);
  const [myVehicles, setMyVehicles] = useState<MyVehicleOption[]>([]);
  const [garages, setGarages] = useState<AppraisalGarageItem[]>([]);
  const [marketCars, setMarketCars] = useState<UsedCarListingItem[] | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [threads, setThreads] = useState<UsedCarThreadItem[] | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Hộp thoại đăng bán xe của tôi
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    vehicleId: '',
    title: '',
    plateNo: '',
    vin: '',
    make: '',
    model: '',
    year: '2022',
    mileageKm: '25000',
    bodyStyle: 'SUV_CUV',
    transmission: 'TU_DONG' as 'TU_DONG' | 'SO_SAN',
    fuel: 'XANG' as 'XANG' | 'DAU' | 'DIEN' | 'HYBRID',
    exteriorColor: 'Trắng',
    price: '680000000',
    province: 'Hà Nội',
    addressText: '',
    description: '',
    imageFileIds: [] as string[],
    docFileIds: [] as string[],
  });

  // Hộp thoại đặt lịch kiểm định xe cũ tại garage
  const [bookTarget, setBookTarget] = useState<UsedCarListingItem | null>(null);
  const [selectedGarage, setSelectedGarage] = useState('');
  const [scheduledLocal, setScheduledLocal] = useState(defaultInspectionDateTime());
  const [bookNote, setBookNote] = useState('');

  // Hộp thoại hỏi mua / hẹn xem xe trên app
  const [inquireTarget, setInquireTarget] = useState<UsedCarListingItem | null>(null);
  const [inquireMsg, setInquireMsg] = useState('Chào bạn, xe còn không? Mình muốn hẹn qua xem xe.');
  const [inquireViewing, setInquireViewing] = useState(defaultInspectionDateTime());

  const loadMine = useCallback(async () => {
    const [ls, vs, gs, ths, svs] = await Promise.all([
      ownerApi<UsedCarListingItem[]>('/used-cars/listings'),
      ownerApi<MyVehicleOption[]>('/used-cars/my-vehicles'),
      publicUsedCarGet<AppraisalGarageItem[]>('/garages'),
      ownerApi<UsedCarThreadItem[]>('/used-cars/threads'),
      ownerApi<UsedCarListingItem[]>('/used-cars/saves'),
    ]);
    setMyListings(ls);
    setMyVehicles(vs);
    setGarages(gs);
    setThreads(ths);
    setSavedIds(new Set(svs.map((s) => s.id)));
  }, []);

  const loadBrowse = useCallback(async () => {
    const res = await publicUsedCarGet<{ items: UsedCarListingItem[] }>('');
    setMarketCars(res.items);
  }, []);

  useEffect(() => {
    void loadMine();
  }, [loadMine]);

  useEffect(() => {
    if (tab === 'browse') void loadBrowse();
  }, [tab, loadBrowse]);

  function fillFromVehicle(vid: string) {
    const v = myVehicles.find((x) => x.id === vid);
    if (!v) {
      setForm((f) => ({ ...f, vehicleId: '' }));
      return;
    }
    setForm((f) => ({
      ...f,
      vehicleId: v.id,
      plateNo: v.plateNo,
      vin: v.vin ?? '',
      make: v.make || f.make,
      model: v.model || f.model,
      year: String(v.year || f.year),
      mileageKm: String(v.mileageKm || f.mileageKm),
      exteriorColor: v.color || f.exteriorColor,
      title: `${v.make} ${v.model} ${v.year}`.trim(),
    }));
  }

  async function uploadOwnerFile(e: React.ChangeEvent<HTMLInputElement>, append: (id: string) => void) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy('upload');
    try {
      const res = await ownerUploadUsedCarPhoto(file);
      append(res.id);
    } catch (ex) {
      setError(ex instanceof ApiError ? ex.message : 'Tải ảnh thất bại');
    } finally {
      setBusy(null);
    }
  }

  async function submitCreate() {
    setBusy('create');
    setError(null);
    try {
      await ownerApi('/used-cars/listings', {
        body: {
          vehicleId: form.vehicleId || null,
          title: form.title,
          plateNo: form.plateNo || null,
          vin: form.vin || null,
          make: form.make,
          model: form.model,
          year: Number(form.year),
          mileageKm: Number(form.mileageKm),
          bodyStyle: form.bodyStyle,
          transmission: form.transmission,
          fuel: form.fuel,
          exteriorColor: form.exteriorColor || null,
          price: Number(form.price),
          negotiable: true,
          province: form.province,
          addressText: form.addressText || null,
          description: form.description || null,
          imageFileIds: form.imageFileIds,
          docFileIds: form.docFileIds,
        },
      });
      setCreateOpen(false);
      await loadMine();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Đăng tin thất bại');
    } finally {
      setBusy(null);
    }
  }

  async function submitBookAppraisal() {
    if (!bookTarget || !selectedGarage) return;
    setBusy('book-ap');
    setError(null);
    try {
      await ownerApi(`/used-cars/listings/${bookTarget.id}/appraisals`, {
        body: {
          tenantId: selectedGarage,
          scheduledAt: localInputToIso(scheduledLocal),
          note: bookNote || null,
        },
      });
      setBookTarget(null);
      await loadMine();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Đặt lịch kiểm định thất bại');
    } finally {
      setBusy(null);
    }
  }

  async function toggleSave(listingId: string) {
    const res = await ownerApi<{ saved: boolean }>(`/used-cars/saves/${listingId}`, { body: {} });
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (res.saved) next.add(listingId);
      else next.delete(listingId);
      return next;
    });
  }

  async function submitOwnerInquiry() {
    if (!inquireTarget) return;
    setBusy('inquire');
    setError(null);
    try {
      const res = await ownerApi<{ threadId: string }>(`/used-cars/listings/${inquireTarget.id}/inquiries`, {
        body: {
          message: inquireMsg,
          viewingAt: inquireViewing ? localInputToIso(inquireViewing) : null,
        },
      });
      setInquireTarget(null);
      router.push(`/app/xe-cu/hoi-thoai/${res.threadId}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Gửi tin nhắn thất bại');
    } finally {
      setBusy(null);
    }
  }

  const displayedBrowse = (marketCars ?? []).filter((c) => !savedOnly || savedIds.has(c.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Mua bán Xe cũ</h1>
        <Tabs
          tabs={[
            { value: 'mine', label: 'Tin của tôi' },
            { value: 'browse', label: `Tìm & Lưu (${savedIds.size})` },
            { value: 'threads', label: `Chat${threads?.length ? ` (${threads.length})` : ''}` },
          ]}
          value={tab}
          onChange={(v) => setTab(v)}
        />
      </div>

      {error && <Alert>{error}</Alert>}

      {tab === 'mine' && (
        <div className="space-y-3">
          <Button className="w-full justify-center" onClick={() => setCreateOpen(true)} data-testid="owner-new-used-car-btn">
            <Plus className="h-4 w-4" /> Đăng tin bán xe của tôi
          </Button>

          {!myListings ? (
            <Spinner className="h-6 w-6 text-brand-600" />
          ) : !myListings.length ? (
            <Card className="p-6 text-center text-sm text-slate-500">
              Bạn chưa đăng tin bán xe cũ nào. Bạn có thể đăng bán và đặt dịch vụ kiểm định tại garage để bán nhanh hơn.
            </Card>
          ) : (
            <ul className="space-y-3" data-testid="owner-used-car-list">
              {myListings.map((l) => {
                const st = USED_CAR_LISTING_UI[l.status];
                const latestAp = l.appraisals?.[0];
                return (
                  <li key={l.id}>
                    <Card className="p-4 space-y-3" data-testid="owner-used-car-card">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono text-xs text-slate-500">{l.code}</span>
                            <Badge tone={st.tone}>{st.label}</Badge>
                            {l.hasVerifiedBadge && (
                              <Badge tone="mint">
                                <ShieldCheck className="h-3 w-3" /> Đã kiểm định
                              </Badge>
                            )}
                          </div>
                          <div className="mt-1 font-semibold text-slate-900">{l.title}</div>
                          <div className="text-xs text-slate-500">
                            {l.year} · {l.mileageKm.toLocaleString('vi-VN')} km · {l.province}
                          </div>
                        </div>
                        <div className="text-right font-bold text-emerald-700">{fmtCarPrice(l.price)}</div>
                      </div>

                      {latestAp && (
                        <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-700">
                          Kiểm định <b>{latestAp.code}</b> tại <b>{latestAp.garage.name}</b>:{' '}
                          <Badge tone={APPRAISAL_STATUS_UI[latestAp.status].tone}>{APPRAISAL_STATUS_UI[latestAp.status].label}</Badge>
                          {latestAp.score !== null ? ` · ${latestAp.score}/100 điểm` : ''}
                        </div>
                      )}

                      {l.reviewNote && (
                        <div className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
                          <b>Ghi chú từ sàn:</b> {l.reviewNote}
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2">
                        {(l.status === 'NHAP' || l.status === 'BI_TU_CHOI') && (
                          <Button
                            onClick={async () => {
                              await ownerApi(`/used-cars/listings/${l.id}/submit`, { body: {} });
                              await loadMine();
                            }}
                            data-testid="owner-submit-used-car"
                          >
                            <Send className="h-4 w-4" /> Gửi sàn duyệt
                          </Button>
                        )}
                        {!l.hasVerifiedBadge && l.status !== 'DA_BAN' && l.status !== 'BI_GO' && (
                          <Button
                            variant="outline"
                            onClick={() => {
                              setBookTarget(l);
                              setSelectedGarage(garages[0]?.tenantId ?? '');
                              setBookNote('');
                            }}
                            data-testid="owner-book-appraisal-btn"
                          >
                            <ClipboardCheck className="h-4 w-4" /> Đặt kiểm định
                          </Button>
                        )}
                        {['DANG_BAN', 'TAM_AN', 'HET_HAN'].includes(l.status) && (
                          <Button
                            variant="outline"
                            onClick={async () => {
                              await ownerApi(`/used-cars/listings/${l.id}/sold`, { body: {} });
                              await loadMine();
                            }}
                            data-testid="owner-mark-sold-btn"
                          >
                            <Tag className="h-4 w-4" /> Đã bán
                          </Button>
                        )}
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {tab === 'browse' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">Bấm biểu tượng lưu tin để theo dõi xe yêu thích</span>
            <label className="inline-flex items-center gap-1.5 font-semibold text-brand-700">
              <input type="checkbox" checked={savedOnly} onChange={(e) => setSavedOnly(e.target.checked)} data-testid="owner-saved-only-toggle" />
              Tin đã lưu ({savedIds.size})
            </label>
          </div>

          {!marketCars ? (
            <Spinner className="h-6 w-6 text-brand-600" />
          ) : !displayedBrowse.length ? (
            <Card className="p-6 text-center text-sm text-slate-500">Chưa có tin bán xe nào trong mục này.</Card>
          ) : (
            <ul className="space-y-2.5" data-testid="owner-browse-used-cars">
              {displayedBrowse.map((c) => {
                const isSaved = savedIds.has(c.id);
                return (
                  <li key={c.id}>
                    <Card className="p-4 space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5">
                            {c.hasVerifiedBadge && (
                              <Badge tone="mint">
                                <ShieldCheck className="h-3 w-3" /> Đã kiểm định
                              </Badge>
                            )}
                            <span className="text-xs text-slate-400">{c.province}</span>
                          </div>
                          <Link href={`/cho/xe-cu/${c.id}`} className="mt-1 block font-semibold text-slate-900 hover:text-brand-700">
                            {c.title}
                          </Link>
                          <div className="text-xs text-slate-500">
                            {c.year} · {c.mileageKm.toLocaleString('vi-VN')} km · {TRANSMISSION_LABEL[c.transmission]}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-emerald-700">{fmtCarPrice(c.price)}</div>
                          <button
                            type="button"
                            onClick={() => void toggleSave(c.id)}
                            className={`mt-1 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${isSaved ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-600'}`}
                            data-testid="owner-toggle-save"
                          >
                            <Bookmark className="h-3.5 w-3.5" /> {isSaved ? 'Đã lưu' : 'Lưu tin'}
                          </button>
                        </div>
                      </div>

                      <Button
                        variant="outline"
                        className="w-full justify-center"
                        onClick={() => {
                          setInquireTarget(c);
                          setInquireMsg('Chào bạn, xe còn không? Mình muốn hẹn qua xem xe.');
                        }}
                        data-testid="owner-inquire-btn"
                      >
                        <MessageSquare className="h-4 w-4" /> Chat & Hẹn xem xe
                      </Button>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {tab === 'threads' && (
        <div>
          {!threads ? (
            <Spinner className="h-6 w-6 text-brand-600" />
          ) : !threads.length ? (
            <Card className="p-6 text-center text-sm text-slate-500">Chưa có cuộc trò chuyện mua bán xe nào.</Card>
          ) : (
            <ul className="space-y-2.5" data-testid="owner-thread-list">
              {threads.map((t) => {
                const vst = VIEWING_STATUS_UI[t.viewingStatus] ?? VIEWING_STATUS_UI.NONE;
                const last = t.messages[t.messages.length - 1];
                return (
                  <li key={t.id}>
                    <Link href={`/app/xe-cu/hoi-thoai/${t.id}`} className="block">
                      <Card className="flex items-center justify-between gap-2 p-4">
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-1.5">
                            <Badge tone={t.myRole === 'SELLER' ? 'lav' : 'sky'}>
                              {t.myRole === 'SELLER' ? 'Khách hỏi mua' : 'Tôi hỏi mua'}
                            </Badge>
                            {t.viewingStatus !== 'NONE' && <Badge tone={vst.tone}>{vst.label}</Badge>}
                          </div>
                          <div className="truncate text-sm font-semibold text-slate-900">{t.listing.title}</div>
                          {last && (
                            <div className="truncate text-xs text-slate-500">
                              {last.senderName}: {last.content}
                            </div>
                          )}
                        </div>
                        <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" />
                      </Card>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Hộp thoại đăng tin bán xe của chủ xe */}
      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Đăng tin bán xe cũ của tôi"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Huỷ
            </Button>
            <Button onClick={submitCreate} disabled={!!busy} data-testid="owner-save-used-car">
              Lưu bản nháp
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {myVehicles.length > 0 && (
            <Field label="Điền nhanh từ xe trong Garage của tôi">
              {(id) => (
                <Select id={id} value={form.vehicleId} onChange={(e) => fillFromVehicle(e.target.value)}>
                  <option value="">-- Nhập thủ công --</option>
                  {myVehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.plateNo} · {v.make} {v.model} ({v.year})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label="Tiêu đề tin đăng *">
            {(id) => <Input id={id} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="VD: Mazda CX-5 2023 chính chủ" />}
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Hãng xe *">
              {(id) => <Input id={id} value={form.make} onChange={(e) => setForm((f) => ({ ...f, make: e.target.value }))} />}
            </Field>
            <Field label="Dòng xe *">
              {(id) => <Input id={id} value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} />}
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Năm SX *">
              {(id) => <Input id={id} type="number" value={form.year} onChange={(e) => setForm((f) => ({ ...f, year: e.target.value }))} />}
            </Field>
            <Field label="ODO (km) *">
              {(id) => <Input id={id} type="number" value={form.mileageKm} onChange={(e) => setForm((f) => ({ ...f, mileageKm: e.target.value }))} />}
            </Field>
            <Field label="Biển số">
              {(id) => <Input id={id} value={form.plateNo} onChange={(e) => setForm((f) => ({ ...f, plateNo: e.target.value }))} />}
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Giá bán (đồng) *">
              {(id) => <Input id={id} type="number" step={5000000} value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} />}
            </Field>
            <Field label="Tỉnh / thành *">
              {(id) => <Input id={id} value={form.province} onChange={(e) => setForm((f) => ({ ...f, province: e.target.value }))} />}
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Kiểu dáng">
              {(id) => (
                <Select id={id} value={form.bodyStyle} onChange={(e) => setForm((f) => ({ ...f, bodyStyle: e.target.value }))}>
                  {Object.entries(BODY_STYLE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Hộp số">
              {(id) => (
                <Select id={id} value={form.transmission} onChange={(e) => setForm((f) => ({ ...f, transmission: e.target.value as 'TU_DONG' | 'SO_SAN' }))}>
                  <option value="TU_DONG">Số tự động</option>
                  <option value="SO_SAN">Số sàn</option>
                </Select>
              )}
            </Field>
          </div>
          <Field label="Mô tả tình trạng xe">
            {(id) => <Input id={id} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />}
          </Field>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium">
              <ImagePlus className="h-3.5 w-3.5" /> Ảnh xe ({form.imageFileIds.length})
              <input type="file" accept="image/*" className="hidden" onChange={(e) => void uploadOwnerFile(e, (fid) => setForm((f) => ({ ...f, imageFileIds: [...f.imageFileIds, fid] })))} />
            </label>
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800">
              <FileText className="h-3.5 w-3.5" /> Ảnh cà vẹt ({form.docFileIds.length})
              <input type="file" accept="image/*" className="hidden" onChange={(e) => void uploadOwnerFile(e, (fid) => setForm((f) => ({ ...f, docFileIds: [...f.docFileIds, fid] })))} />
            </label>
          </div>
        </div>
      </Dialog>

      {/* Hộp thoại đặt lịch kiểm định tại garage */}
      <Dialog
        open={!!bookTarget}
        onClose={() => setBookTarget(null)}
        title="Đặt dịch vụ Kiểm định xe cũ tại Garage"
        footer={
          <>
            <Button variant="outline" onClick={() => setBookTarget(null)}>
              Huỷ
            </Button>
            <Button onClick={submitBookAppraisal} disabled={!!busy || !selectedGarage} data-testid="owner-book-appraisal-confirm">
              Xác nhận đặt kiểm định
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-slate-600">
            Phí kiểm định thanh toán trực tiếp tại garage. Khi đạt chuẩn, báo cáo 150 điểm & huy hiệu <b>Đã kiểm định</b> tự động gắn lên tin đăng của bạn.
          </p>
          <Field label="Chọn garage thực hiện kiểm định *">
            {(id) => (
              <Select id={id} value={selectedGarage} onChange={(e) => setSelectedGarage(e.target.value)}>
                {garages.map((g) => (
                  <option key={g.tenantId} value={g.tenantId}>
                    {g.name} ({g.province || 'Toàn quốc'}) · Phí {fmtVnd(g.fee)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Ngày giờ mang xe tới kiểm định *">
            {(id) => <Input id={id} type="datetime-local" value={scheduledLocal} onChange={(e) => setScheduledLocal(e.target.value)} />}
          </Field>
          <Field label="Ghi chú cho garage">
            {(id) => <Input id={id} value={bookNote} onChange={(e) => setBookNote(e.target.value)} placeholder="VD: Nhờ kiểm tra kỹ khung gầm & chẩn đoán OBD" />}
          </Field>
        </div>
      </Dialog>

      {/* Hộp thoại hỏi mua / hẹn xem xe */}
      <Dialog
        open={!!inquireTarget}
        onClose={() => setInquireTarget(null)}
        title={inquireTarget ? `Hỏi mua: ${inquireTarget.title}` : 'Chat hỏi xe'}
        footer={
          <>
            <Button variant="outline" onClick={() => setInquireTarget(null)}>
              Huỷ
            </Button>
            <Button onClick={submitOwnerInquiry} disabled={!!busy} data-testid="owner-inquire-confirm">
              Gửi tin nhắn
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Đề xuất ngày giờ xem xe">
            {(id) => <Input id={id} type="datetime-local" value={inquireViewing} onChange={(e) => setInquireViewing(e.target.value)} />}
          </Field>
          <Field label="Nội dung nhắn người bán *">
            {(id) => <Input id={id} value={inquireMsg} onChange={(e) => setInquireMsg(e.target.value)} />}
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
