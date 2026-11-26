'use client';

import { Alert, Badge, Button, Card, Dialog, Field, Input, Select, Spinner, Tabs } from '@cardiy/ui';
import {
  CarFront,
  CheckCircle2,
  EyeOff,
  FileCheck2,
  ImagePlus,
  KeyRound,
  Pencil,
  Plus,
  ReceiptText,
  RotateCcw,
  Search,
  Send,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime } from '@/lib/orders';
import {
  fmtVnd,
  FUEL_LABEL,
  RENTAL_CONTRACT_UI,
  RENTAL_LISTING_UI,
  TRANSMISSION_LABEL,
  type RentalContractDetail,
  type RentalVehicleItem,
} from '@/lib/rentals';

export function RentalWorkspace({ mode }: { mode: 'PARTNER' | 'GARAGE' }) {
  const { me, can } = useAuth();
  const canManage =
    mode === 'PARTNER'
      ? can('partner.request.manage') || can('partner.listing.manage')
      : can('rental.manage');

  const [section, setSection] = useState<'contracts' | 'fleet'>('contracts');
  const [contractFilter, setContractFilter] = useState<'OPEN' | 'DONE' | 'ALL'>('OPEN');
  const [branchFilter, setBranchFilter] = useState('');
  const [q, setQ] = useState('');
  const [contracts, setContracts] = useState<{ counts: Record<string, number>; items: RentalContractDetail[] } | null>(null);
  const [fleet, setFleet] = useState<{
    counts: Record<string, number>;
    branches: { id: string; code: string; name: string }[];
    items: RentalVehicleItem[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Hộp thoại thêm / sửa xe cho thuê
  const [vehModalOpen, setVehModalOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<RentalVehicleItem | null>(null);
  const [vehForm, setVehForm] = useState({
    title: '',
    plateNo: '',
    make: '',
    model: '',
    year: '2023',
    seats: '5',
    transmission: 'TU_DONG' as 'TU_DONG' | 'SO_SAN',
    fuel: 'XANG' as 'XANG' | 'DAU' | 'DIEN' | 'HYBRID',
    ownerType: 'GARAGE' as 'GARAGE' | 'CONSIGN',
    dailyPrice: '800000',
    deposit: '5000000',
    kmLimitPerDay: '300',
    overKmFee: '5000',
    branchId: '',
    province: '',
    pickupAddress: '',
    terms: 'CCCD gắn chip + GPLX hạng B1/B2 còn hạn',
    description: '',
    imageFileIds: [] as string[],
  });

  // Các hộp thoại xử lý hợp đồng theo S8
  const [verifyTarget, setVerifyTarget] = useState<RentalContractDetail | null>(null);
  const [kycIdCard, setKycIdCard] = useState('');
  const [kycLicense, setKycLicense] = useState('');
  const [kycNote, setKycNote] = useState('');

  const [cancelTarget, setCancelTarget] = useState<RentalContractDetail | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const [depositTarget, setDepositTarget] = useState<RentalContractDetail | null>(null);
  const [depositPaid, setDepositPaid] = useState('');
  const [depositNote, setDepositNote] = useState('');

  const [handoverTarget, setHandoverTarget] = useState<RentalContractDetail | null>(null);
  const [handoverKm, setHandoverKm] = useState('');
  const [handoverFuel, setHandoverFuel] = useState('80');
  const [handoverNote, setHandoverNote] = useState('');
  const [handoverImages, setHandoverImages] = useState<string[]>([]);

  const [returnTarget, setReturnTarget] = useState<RentalContractDetail | null>(null);
  const [returnKm, setReturnKm] = useState('');
  const [returnFuel, setReturnFuel] = useState('80');
  const [returnExtra, setReturnExtra] = useState('');
  const [returnNote, setReturnNote] = useState('');
  const [returnImages, setReturnImages] = useState<string[]>([]);

  const [settleTarget, setSettleTarget] = useState<RentalContractDetail | null>(null);
  const [settleExtra, setSettleExtra] = useState('0');
  const [settleDiscount, setSettleDiscount] = useState('0');
  const [settleMethod, setSettleMethod] = useState<'TIEN_MAT' | 'CHUYEN_KHOAN' | 'THE'>('CHUYEN_KHOAN');
  const [settleNote, setSettleNote] = useState('');

  const loadAll = useCallback(async () => {
    try {
      const cQs = new URLSearchParams({ status: contractFilter });
      const vQs = new URLSearchParams();
      if (branchFilter) {
        cQs.set('branchId', branchFilter);
        vQs.set('branchId', branchFilter);
      }
      if (q.trim()) {
        cQs.set('q', q.trim());
        vQs.set('q', q.trim());
      }
      const [cData, fData] = await Promise.all([
        api<{ counts: Record<string, number>; items: RentalContractDetail[] }>(`/rentals/contracts?${cQs}`),
        api<{ counts: Record<string, number>; branches: { id: string; code: string; name: string }[]; items: RentalVehicleItem[] }>(
          `/rentals/vehicles?${vQs}`,
        ),
      ]);
      setContracts(cData);
      setFleet(fData);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không tải được dữ liệu thuê xe');
    }
  }, [contractFilter, branchFilter, q]);

  useEffect(() => {
    const t = setTimeout(() => void loadAll(), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [loadAll, q]);

  async function runAction(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await loadAll();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Thao tác thất bại');
    } finally {
      setBusy(null);
    }
  }

  async function uploadPhotoToList(e: React.ChangeEvent<HTMLInputElement>, append: (id: string) => void) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy('upload');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api<{ id: string }>('/files', { form });
      append(res.id);
    } catch (ex) {
      setError(ex instanceof ApiError ? ex.message : 'Tải ảnh thất bại');
    } finally {
      setBusy(null);
    }
  }

  function openNewVehicle() {
    setEditingVehicle(null);
    setVehForm({
      title: '',
      plateNo: '',
      make: '',
      model: '',
      year: '2023',
      seats: '5',
      transmission: 'TU_DONG',
      fuel: 'XANG',
      ownerType: 'GARAGE',
      dailyPrice: '800000',
      deposit: '5000000',
      kmLimitPerDay: '300',
      overKmFee: '5000',
      branchId: fleet?.branches[0]?.id ?? '',
      province: '',
      pickupAddress: '',
      terms: 'CCCD gắn chip + GPLX hạng B1/B2 còn hạn',
      description: '',
      imageFileIds: [],
    });
    setVehModalOpen(true);
  }

  function openEditVehicle(v: RentalVehicleItem) {
    setEditingVehicle(v);
    setVehForm({
      title: v.title,
      plateNo: v.plateNo,
      make: v.make,
      model: v.model,
      year: String(v.year),
      seats: String(v.seats),
      transmission: v.transmission,
      fuel: v.fuel,
      ownerType: v.ownerType,
      dailyPrice: String(v.dailyPrice),
      deposit: String(v.deposit),
      kmLimitPerDay: String(v.kmLimitPerDay),
      overKmFee: String(v.overKmFee),
      branchId: v.branch?.id ?? '',
      province: v.province ?? '',
      pickupAddress: v.pickupAddress ?? '',
      terms: v.terms ?? '',
      description: v.description ?? '',
      imageFileIds: v.images.map((i) => i.id),
    });
    setVehModalOpen(true);
  }

  async function saveVehicle() {
    const body = {
      title: vehForm.title,
      plateNo: vehForm.plateNo,
      make: vehForm.make,
      model: vehForm.model,
      year: Number(vehForm.year),
      seats: Number(vehForm.seats),
      transmission: vehForm.transmission,
      fuel: vehForm.fuel,
      ownerType: vehForm.ownerType,
      dailyPrice: Number(vehForm.dailyPrice),
      deposit: Number(vehForm.deposit),
      kmLimitPerDay: Number(vehForm.kmLimitPerDay),
      overKmFee: Number(vehForm.overKmFee),
      branchId: mode === 'GARAGE' ? vehForm.branchId || null : null,
      province: vehForm.province || null,
      pickupAddress: vehForm.pickupAddress || null,
      terms: vehForm.terms || null,
      description: vehForm.description || null,
      imageFileIds: vehForm.imageFileIds,
    };
    await runAction('save-vehicle', async () => {
      if (editingVehicle) {
        await api(`/rentals/vehicles/${editingVehicle.id}`, { method: 'PUT', body });
      } else {
        await api('/rentals/vehicles', { body });
      }
      setVehModalOpen(false);
    });
  }

  return (
    <div className="space-y-4" data-testid="rental-workspace">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          tabs={[
            { value: 'contracts', label: `Hợp đồng thuê xe${contracts ? ` (${contracts.items.length})` : ''}` },
            { value: 'fleet', label: `Đội xe cho thuê${fleet ? ` (${fleet.items.length})` : ''}` },
          ]}
          value={section}
          onChange={(v) => setSection(v)}
        />

        <div className="flex flex-wrap items-center gap-2">
          {mode === 'GARAGE' && (me?.branches.length ?? 0) > 1 && (
            <Select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="w-auto rounded-full bg-white/85" aria-label="Lọc chi nhánh">
              <option value="">Tất cả chi nhánh</option>
              {me!.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          )}
          <div className="relative w-56">
            <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Mã, tên khách, biển số…" className="rounded-full bg-white/85 pl-10" aria-label="Tìm kiếm thuê xe" />
          </div>
          {section === 'fleet' && canManage && (
            <Button onClick={openNewVehicle} data-testid="rental-add-vehicle">
              <Plus className="h-4 w-4" /> Thêm xe cho thuê
            </Button>
          )}
        </div>
      </div>

      {error && <Alert>{error}</Alert>}

      {section === 'contracts' ? (
        <div className="space-y-3">
          <Tabs
            tabs={[
              { value: 'OPEN', label: 'Đang xử lý' },
              { value: 'DONE', label: 'Đã quyết toán / Huỷ' },
              { value: 'ALL', label: 'Tất cả' },
            ]}
            value={contractFilter}
            onChange={(v) => setContractFilter(v)}
          />

          {!contracts ? (
            <Spinner className="h-6 w-6 text-brand-600" />
          ) : !contracts.items.length ? (
            <Card className="p-10 text-center text-sm text-slate-500">Không có hợp đồng thuê xe nào trong mục này.</Card>
          ) : (
            <ul className="space-y-3" data-testid="rental-contract-list">
              {contracts.items.map((c) => {
                const st = RENTAL_CONTRACT_UI[c.status];
                return (
                  <li key={c.id}>
                    <Card className="p-5 space-y-3" data-testid="rental-contract-card">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-lg font-bold">{c.code}</span>
                            <Badge tone={st.tone}>{st.label}</Badge>
                            <span className="font-medium text-slate-800">{c.vehicle.title}</span>
                            <span className="font-mono text-xs text-slate-500">({c.vehicle.plateNo})</span>
                          </div>
                          <div className="mt-1 text-sm text-slate-700">
                            Khách thuê: <b>{c.customerName}</b> · {c.phone}
                            {c.idCardNo ? ` · CCCD: ${c.idCardNo}` : ''}
                            {c.driverLicenseNo ? ` · GPLX: ${c.driverLicenseNo}` : ''}
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500">
                            Nhận: <b>{fmtDateTime(c.startAt)}</b> → Trả: <b>{fmtDateTime(c.endAt)}</b> ({c.rentalDays} ngày)
                          </div>
                        </div>

                        <div className="text-right text-sm">
                          <div>
                            Tiền thuê gốc: <b className="tabular-nums">{fmtVnd(c.baseTotal)}</b>
                          </div>
                          <div className="text-xs text-slate-500">
                            Cọc đã thu: <b>{fmtVnd(c.depositPaid)}</b> / {fmtVnd(c.depositRequired)}
                          </div>
                          {c.finalTotal !== null && (
                            <div className="font-semibold text-emerald-700">
                              Chốt quyết toán: {fmtVnd(c.finalTotal)}
                              {c.depositRefund ? ` · Hoàn cọc ${fmtVnd(c.depositRefund)}` : ''}
                            </div>
                          )}
                          {c.cashEntry && (
                            <div className="font-mono text-xs text-indigo-700" data-testid="rental-cash-entry">
                              Phiếu thu sổ quỹ: {c.cashEntry.code}
                            </div>
                          )}
                        </div>
                      </div>

                      {(c.handover.at || c.returned.at) && (
                        <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-2xl bg-slate-50 px-4 py-2.5 text-xs text-slate-600">
                          {c.handover.at && (
                            <span>
                              Giao xe: <b>{c.handover.km?.toLocaleString('vi-VN')} km</b> ({c.handover.fuel}% nhiên liệu)
                            </span>
                          )}
                          {c.returned.at && (
                            <span>
                              Trả xe: <b>{c.returned.km?.toLocaleString('vi-VN')} km</b> ({c.returned.fuel}% nhiên liệu)
                              {c.extraFee > 0 ? ` · Phụ phí: ${fmtVnd(c.extraFee)}` : ''}
                            </span>
                          )}
                        </div>
                      )}

                      {canManage && (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          {c.status === 'DAT_TRUOC' && (
                            <>
                              <Button
                                onClick={() => {
                                  setVerifyTarget(c);
                                  setKycIdCard(c.idCardNo ?? '');
                                  setKycLicense(c.driverLicenseNo ?? '');
                                  setKycNote('');
                                }}
                                disabled={busy === c.id}
                                data-testid="rental-verify-btn"
                              >
                                <FileCheck2 className="h-4 w-4" /> Xác minh GPLX & CCCD
                              </Button>
                              <Button
                                variant="outline"
                                onClick={() => {
                                  setCancelTarget(c);
                                  setCancelReason('');
                                }}
                                disabled={busy === c.id}
                                data-testid="rental-reject-btn"
                              >
                                <XCircle className="h-4 w-4" /> Huỷ đơn
                              </Button>
                            </>
                          )}

                          {c.status === 'DA_XAC_MINH' && (
                            <Button
                              onClick={() => {
                                setDepositTarget(c);
                                setDepositPaid(String(c.depositRequired));
                                setDepositNote('');
                              }}
                              disabled={busy === c.id}
                              data-testid="rental-deposit-btn"
                            >
                              <ReceiptText className="h-4 w-4" /> Ký hợp đồng & nhận cọc
                            </Button>
                          )}

                          {c.status === 'DA_KY_COC' && (
                            <Button
                              onClick={() => {
                                setHandoverTarget(c);
                                setHandoverKm('25000');
                                setHandoverFuel('80');
                                setHandoverNote('');
                                setHandoverImages([]);
                              }}
                              disabled={busy === c.id}
                              data-testid="rental-handover-btn"
                            >
                              <KeyRound className="h-4 w-4" /> Bàn giao xe
                            </Button>
                          )}

                          {(c.status === 'DANG_THUE' || c.status === 'QUA_HAN') && (
                            <Button
                              onClick={() => {
                                setReturnTarget(c);
                                setReturnKm(String((c.handover.km ?? 25000) + 150));
                                setReturnFuel(String(c.handover.fuel ?? 80));
                                setReturnExtra('');
                                setReturnNote('');
                                setReturnImages([]);
                              }}
                              disabled={busy === c.id}
                              data-testid="rental-return-btn"
                            >
                              <RotateCcw className="h-4 w-4" /> Nhận trả xe
                            </Button>
                          )}

                          {c.status === 'DA_TRA_XE' && (
                            <Button
                              className="bg-emerald-600 hover:bg-emerald-700"
                              onClick={() => {
                                setSettleTarget(c);
                                setSettleExtra(String(c.extraFee));
                                setSettleDiscount(String(c.discount));
                                setSettleMethod('CHUYEN_KHOAN');
                                setSettleNote(c.sellerNote ?? '');
                              }}
                              disabled={busy === c.id}
                              data-testid="rental-settle-btn"
                            >
                              <CheckCircle2 className="h-4 w-4" /> Quyết toán hợp đồng
                            </Button>
                          )}
                        </div>
                      )}
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : !fleet ? (
        <Spinner className="h-6 w-6 text-brand-600" />
      ) : !fleet.items.length ? (
        <Card className="p-10 text-center text-sm text-slate-500">Chưa có xe nào trong đội xe cho thuê. Bấm &ldquo;Thêm xe cho thuê&rdquo; để bắt đầu.</Card>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2" data-testid="rental-fleet-list">
          {fleet.items.map((v) => {
            const st = RENTAL_LISTING_UI[v.status];
            return (
              <li key={v.id}>
                <Card className="p-4 space-y-3" data-testid="rental-fleet-card">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-xs text-slate-500">{v.code}</span>
                        <Badge tone={st.tone}>{st.label}</Badge>
                        {v.ownerType === 'CONSIGN' && <Badge tone="lav">Xe ký gửi</Badge>}
                      </div>
                      <h3 className="mt-1 font-semibold text-slate-900">{v.title}</h3>
                      <div className="text-xs text-slate-500">
                        Biển số: <b className="font-mono">{v.plateNo}</b> · {v.seats} chỗ · {TRANSMISSION_LABEL[v.transmission]} · {FUEL_LABEL[v.fuel]}
                        {v.branch ? ` · ${v.branch.code}` : ''}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-emerald-700">{fmtVnd(v.dailyPrice)}/ngày</div>
                      <div className="text-xs text-slate-500">Cọc {fmtVnd(v.deposit)}</div>
                    </div>
                  </div>

                  {v.reviewNote && (
                    <div className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
                      <b>Ghi chú kiểm duyệt:</b> {v.reviewNote}
                    </div>
                  )}

                  {canManage && (
                    <div className="flex flex-wrap gap-2">
                      {(v.status === 'NHAP' || v.status === 'BI_TU_CHOI') && (
                        <Button
                          onClick={() => runAction(v.id, () => api(`/rentals/vehicles/${v.id}/submit`, { body: {} }))}
                          disabled={busy === v.id}
                          data-testid="rental-submit-vehicle"
                        >
                          <Send className="h-4 w-4" /> {mode === 'GARAGE' ? 'Mở cho thuê trên sàn' : 'Gửi sàn duyệt'}
                        </Button>
                      )}
                      {v.status === 'DANG_CHO_THUE' && (
                        <Button
                          variant="outline"
                          onClick={() => runAction(v.id, () => api(`/rentals/vehicles/${v.id}/hide`, { body: {} }))}
                          disabled={busy === v.id}
                        >
                          <EyeOff className="h-4 w-4" /> Tạm ẩn
                        </Button>
                      )}
                      {v.status === 'TAM_AN' && (
                        <Button
                          onClick={() => runAction(v.id, () => api(`/rentals/vehicles/${v.id}/show`, { body: {} }))}
                          disabled={busy === v.id}
                        >
                          <CarFront className="h-4 w-4" /> Mở lại
                        </Button>
                      )}
                      {v.status !== 'BI_GO' && (
                        <Button variant="outline" onClick={() => openEditVehicle(v)}>
                          <Pencil className="h-4 w-4" /> Sửa
                        </Button>
                      )}
                      {(v.status === 'NHAP' || v.status === 'BI_TU_CHOI') && (
                        <Button
                          variant="ghost"
                          onClick={() => runAction(v.id, () => api(`/rentals/vehicles/${v.id}/delete`, { body: {} }))}
                          disabled={busy === v.id}
                        >
                          <Trash2 className="h-4 w-4 text-rose-600" />
                        </Button>
                      )}
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {/* Hộp thoại thêm / sửa xe cho thuê */}
      <Dialog
        open={vehModalOpen}
        onClose={() => setVehModalOpen(false)}
        title={editingVehicle ? `Sửa xe cho thuê · ${editingVehicle.code}` : 'Thêm xe vào đội xe cho thuê'}
        wide
        footer={
          <>
            <Button variant="outline" onClick={() => setVehModalOpen(false)}>
              Huỷ
            </Button>
            <Button onClick={saveVehicle} disabled={!!busy} data-testid="rental-save-vehicle">
              Lưu xe cho thuê
            </Button>
          </>
        }
      >
        <div className="space-y-3.5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tiêu đề hiển thị *">
              {(id) => (
                <Input
                  id={id}
                  value={vehForm.title}
                  onChange={(e) => setVehForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="VD: Honda CR-V L 2023 · Tự động · 7 chỗ"
                />
              )}
            </Field>
            <Field label="Biển số xe *">
              {(id) => <Input id={id} value={vehForm.plateNo} onChange={(e) => setVehForm((f) => ({ ...f, plateNo: e.target.value }))} placeholder="30K-123.45" />}
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Hãng xe *">
              {(id) => <Input id={id} value={vehForm.make} onChange={(e) => setVehForm((f) => ({ ...f, make: e.target.value }))} placeholder="Honda" />}
            </Field>
            <Field label="Dòng xe *">
              {(id) => <Input id={id} value={vehForm.model} onChange={(e) => setVehForm((f) => ({ ...f, model: e.target.value }))} placeholder="CR-V" />}
            </Field>
            <Field label="Năm SX *">
              {(id) => <Input id={id} type="number" value={vehForm.year} onChange={(e) => setVehForm((f) => ({ ...f, year: e.target.value }))} />}
            </Field>
            <Field label="Số chỗ">
              {(id) => <Input id={id} type="number" value={vehForm.seats} onChange={(e) => setVehForm((f) => ({ ...f, seats: e.target.value }))} />}
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Hộp số">
              {(id) => (
                <Select id={id} value={vehForm.transmission} onChange={(e) => setVehForm((f) => ({ ...f, transmission: e.target.value as 'TU_DONG' | 'SO_SAN' }))}>
                  <option value="TU_DONG">Số tự động</option>
                  <option value="SO_SAN">Số sàn</option>
                </Select>
              )}
            </Field>
            <Field label="Nhiên liệu">
              {(id) => (
                <Select id={id} value={vehForm.fuel} onChange={(e) => setVehForm((f) => ({ ...f, fuel: e.target.value as 'XANG' | 'DAU' | 'DIEN' | 'HYBRID' }))}>
                  <option value="XANG">Xăng</option>
                  <option value="DAU">Dầu Diesel</option>
                  <option value="DIEN">Xe điện</option>
                  <option value="HYBRID">Hybrid</option>
                </Select>
              )}
            </Field>
            <Field label="Nguồn xe">
              {(id) => (
                <Select id={id} value={vehForm.ownerType} onChange={(e) => setVehForm((f) => ({ ...f, ownerType: e.target.value as 'GARAGE' | 'CONSIGN' }))}>
                  <option value="GARAGE">Xe của garage</option>
                  <option value="CONSIGN">Xe ký gửi</option>
                </Select>
              )}
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Giá thuê / ngày (đ) *">
              {(id) => <Input id={id} type="number" step={50000} value={vehForm.dailyPrice} onChange={(e) => setVehForm((f) => ({ ...f, dailyPrice: e.target.value }))} />}
            </Field>
            <Field label="Tiền cọc (đ) *">
              {(id) => <Input id={id} type="number" step={500000} value={vehForm.deposit} onChange={(e) => setVehForm((f) => ({ ...f, deposit: e.target.value }))} />}
            </Field>
            <Field label="Giới hạn km/ngày">
              {(id) => <Input id={id} type="number" value={vehForm.kmLimitPerDay} onChange={(e) => setVehForm((f) => ({ ...f, kmLimitPerDay: e.target.value }))} />}
            </Field>
            <Field label="Phí vượt km (đ/km)">
              {(id) => <Input id={id} type="number" step={1000} value={vehForm.overKmFee} onChange={(e) => setVehForm((f) => ({ ...f, overKmFee: e.target.value }))} />}
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tỉnh / thành phố">
              {(id) => <Input id={id} value={vehForm.province} onChange={(e) => setVehForm((f) => ({ ...f, province: e.target.value }))} placeholder="Hà Nội" />}
            </Field>
            <Field label="Địa điểm nhận xe">
              {(id) => <Input id={id} value={vehForm.pickupAddress} onChange={(e) => setVehForm((f) => ({ ...f, pickupAddress: e.target.value }))} placeholder="Địa chỉ nhận & trả xe" />}
            </Field>
          </div>
          {mode === 'GARAGE' && (fleet?.branches.length ?? 0) > 0 && (
            <Field label="Chi nhánh quản lý xe">
              {(id) => (
                <Select id={id} value={vehForm.branchId} onChange={(e) => setVehForm((f) => ({ ...f, branchId: e.target.value }))}>
                  {fleet!.branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} · {b.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label="Điều kiện thuê">
            {(id) => <Input id={id} value={vehForm.terms} onChange={(e) => setVehForm((f) => ({ ...f, terms: e.target.value }))} />}
          </Field>
          <Field label="Mô tả thêm">
            {(id) => <Input id={id} value={vehForm.description} onChange={(e) => setVehForm((f) => ({ ...f, description: e.target.value }))} placeholder="Cam hành trình, bảo hiểm thân vỏ…" />}
          </Field>
          <div>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">
              <ImagePlus className="h-4 w-4" /> Tải ảnh xe ({vehForm.imageFileIds.length}/8)
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => void uploadPhotoToList(e, (fid) => setVehForm((f) => ({ ...f, imageFileIds: [...f.imageFileIds, fid].slice(0, 8) })))}
              />
            </label>
          </div>
        </div>
      </Dialog>

      {/* 1. Xác minh GPLX + CCCD (DAT_TRUOC -> DA_XAC_MINH) */}
      <Dialog
        open={!!verifyTarget}
        onClose={() => setVerifyTarget(null)}
        title={verifyTarget ? `Xác minh giấy tờ · ${verifyTarget.code}` : 'Xác minh giấy tờ'}
        footer={
          <>
            <Button variant="outline" onClick={() => setVerifyTarget(null)}>
              Huỷ
            </Button>
            <Button
              onClick={() =>
                verifyTarget &&
                runAction(verifyTarget.id, async () => {
                  await api(`/rentals/contracts/${verifyTarget.id}/verify`, {
                    body: { idCardNo: kycIdCard, driverLicenseNo: kycLicense, kycNote: kycNote || null },
                  });
                  setVerifyTarget(null);
                })
              }
              disabled={!!busy}
              data-testid="rental-verify-confirm"
            >
              Xác nhận đạt giấy tờ
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Số CCCD đã đối chiếu *">
            {(id) => <Input id={id} value={kycIdCard} onChange={(e) => setKycIdCard(e.target.value)} placeholder="07909..." />}
          </Field>
          <Field label="Số GPLX & hạng bằng *">
            {(id) => <Input id={id} value={kycLicense} onChange={(e) => setKycLicense(e.target.value)} placeholder="790123456 (Hạng B2)" />}
          </Field>
          <Field label="Ghi chú xác minh">
            {(id) => <Input id={id} value={kycNote} onChange={(e) => setKycNote(e.target.value)} placeholder="Đã đối chiếu bản gốc hợp lệ" />}
          </Field>
        </div>
      </Dialog>

      {/* Huỷ đơn (DAT_TRUOC -> HUY) */}
      <Dialog
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        title={cancelTarget ? `Huỷ đơn đặt thuê · ${cancelTarget.code}` : 'Huỷ đơn'}
        footer={
          <>
            <Button variant="outline" onClick={() => setCancelTarget(null)}>
              Đóng
            </Button>
            <Button
              className="bg-rose-600 hover:bg-rose-700"
              onClick={() =>
                cancelTarget &&
                runAction(cancelTarget.id, async () => {
                  await api(`/rentals/contracts/${cancelTarget.id}/cancel`, { body: { reason: cancelReason } });
                  setCancelTarget(null);
                })
              }
              disabled={!!busy}
              data-testid="rental-reject-confirm"
            >
              Xác nhận huỷ
            </Button>
          </>
        }
      >
        <Field label="Lý do huỷ đơn *">
          {(id) => <Input id={id} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Khách không đủ giấy tờ / không liên lạc được…" />}
        </Field>
      </Dialog>

      {/* 2. Ký hợp đồng & nhận cọc (DA_XAC_MINH -> DA_KY_COC) */}
      <Dialog
        open={!!depositTarget}
        onClose={() => setDepositTarget(null)}
        title={depositTarget ? `Ký hợp đồng & nhận cọc · ${depositTarget.code}` : 'Ký hợp đồng'}
        footer={
          <>
            <Button variant="outline" onClick={() => setDepositTarget(null)}>
              Huỷ
            </Button>
            <Button
              onClick={() =>
                depositTarget &&
                runAction(depositTarget.id, async () => {
                  await api(`/rentals/contracts/${depositTarget.id}/deposit`, {
                    body: { depositPaid: Number(depositPaid), sellerNote: depositNote || null },
                  });
                  setDepositTarget(null);
                })
              }
              disabled={!!busy}
              data-testid="rental-deposit-confirm"
            >
              Xác nhận đã ký & nhận cọc
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Số tiền đặt cọc đã nhận trực tiếp (đồng) *">
            {(id) => <Input id={id} type="number" min={0} step={500000} value={depositPaid} onChange={(e) => setDepositPaid(e.target.value)} />}
          </Field>
          <Field label="Ghi chú hợp đồng">
            {(id) => <Input id={id} value={depositNote} onChange={(e) => setDepositNote(e.target.value)} placeholder="Đã ký hợp đồng giấy & nhận cọc chuyển khoản" />}
          </Field>
        </div>
      </Dialog>

      {/* 3. Bàn giao xe (DA_KY_COC -> DANG_THUE) */}
      <Dialog
        open={!!handoverTarget}
        onClose={() => setHandoverTarget(null)}
        title={handoverTarget ? `Biên bản bàn giao xe · ${handoverTarget.code}` : 'Bàn giao xe'}
        footer={
          <>
            <Button variant="outline" onClick={() => setHandoverTarget(null)}>
              Huỷ
            </Button>
            <Button
              onClick={() =>
                handoverTarget &&
                runAction(handoverTarget.id, async () => {
                  await api(`/rentals/contracts/${handoverTarget.id}/handover`, {
                    body: {
                      handoverKm: Number(handoverKm),
                      handoverFuel: Number(handoverFuel),
                      handoverImageIds: handoverImages,
                      handoverNote: handoverNote || null,
                    },
                  });
                  setHandoverTarget(null);
                })
              }
              disabled={!!busy}
              data-testid="rental-handover-confirm"
            >
              Xác nhận giao xe cho khách
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Số km công-tơ-mét lúc giao *">
              {(id) => <Input id={id} type="number" min={0} value={handoverKm} onChange={(e) => setHandoverKm(e.target.value)} />}
            </Field>
            <Field label="Mức nhiên liệu / pin (%) *">
              {(id) => <Input id={id} type="number" min={0} max={100} value={handoverFuel} onChange={(e) => setHandoverFuel(e.target.value)} />}
            </Field>
          </div>
          <Field label="Tình trạng ngoại thất / đồ theo xe">
            {(id) => <Input id={id} value={handoverNote} onChange={(e) => setHandoverNote(e.target.value)} placeholder="Đủ lốp dự phòng, đăng kiểm, không trầy xước mới" />}
          </Field>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">
            <ImagePlus className="h-4 w-4" /> Ảnh 8 góc trước khi giao ({handoverImages.length}/8)
            <input type="file" accept="image/*" className="hidden" onChange={(e) => void uploadPhotoToList(e, (fid) => setHandoverImages((xs) => [...xs, fid].slice(0, 8)))} />
          </label>
        </div>
      </Dialog>

      {/* 4. Nhận trả xe (DANG_THUE | QUA_HAN -> DA_TRA_XE) */}
      <Dialog
        open={!!returnTarget}
        onClose={() => setReturnTarget(null)}
        title={returnTarget ? `Biên bản nhận trả xe · ${returnTarget.code}` : 'Nhận trả xe'}
        footer={
          <>
            <Button variant="outline" onClick={() => setReturnTarget(null)}>
              Huỷ
            </Button>
            <Button
              onClick={() =>
                returnTarget &&
                runAction(returnTarget.id, async () => {
                  await api(`/rentals/contracts/${returnTarget.id}/return`, {
                    body: {
                      returnKm: Number(returnKm),
                      returnFuel: Number(returnFuel),
                      returnImageIds: returnImages,
                      extraFee: returnExtra.trim() !== '' ? Number(returnExtra) : null,
                      returnNote: returnNote || null,
                    },
                  });
                  setReturnTarget(null);
                })
              }
              disabled={!!busy}
              data-testid="rental-return-confirm"
            >
              Ghi nhận đã nhận lại xe
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {returnTarget && (
            <p className="text-xs text-slate-500">
              Lúc giao: <b>{returnTarget.handover.km?.toLocaleString('vi-VN')} km</b> · Nhiên liệu <b>{returnTarget.handover.fuel}%</b> · Định mức{' '}
              <b>{returnTarget.rentalDays * returnTarget.vehicle.kmLimitPerDay} km</b> ({returnTarget.rentalDays} ngày)
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Số km lúc trả *">
              {(id) => <Input id={id} type="number" min={0} value={returnKm} onChange={(e) => setReturnKm(e.target.value)} />}
            </Field>
            <Field label="Mức nhiên liệu lúc trả (%) *">
              {(id) => <Input id={id} type="number" min={0} max={100} value={returnFuel} onChange={(e) => setReturnFuel(e.target.value)} />}
            </Field>
          </div>
          <Field label="Phụ phí phát sinh (để trống = tự tính theo km vượt)">
            {(id) => <Input id={id} type="number" min={0} step={50000} value={returnExtra} onChange={(e) => setReturnExtra(e.target.value)} placeholder="Tự tính vượt km nếu để trống" />}
          </Field>
          <Field label="Ghi chú kiểm tra xe lúc trả">
            {(id) => <Input id={id} value={returnNote} onChange={(e) => setReturnNote(e.target.value)} placeholder="Xe sạch, không phát sinh va quẹt" />}
          </Field>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">
            <ImagePlus className="h-4 w-4" /> Ảnh đối chiếu lúc trả ({returnImages.length}/8)
            <input type="file" accept="image/*" className="hidden" onChange={(e) => void uploadPhotoToList(e, (fid) => setReturnImages((xs) => [...xs, fid].slice(0, 8)))} />
          </label>
        </div>
      </Dialog>

      {/* 5. Quyết toán hợp đồng (DA_TRA_XE -> DA_QUYET_TOAN) */}
      <Dialog
        open={!!settleTarget}
        onClose={() => setSettleTarget(null)}
        title={settleTarget ? `Quyết toán hợp đồng · ${settleTarget.code}` : 'Quyết toán'}
        footer={
          <>
            <Button variant="outline" onClick={() => setSettleTarget(null)}>
              Huỷ
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={() =>
                settleTarget &&
                runAction(settleTarget.id, async () => {
                  await api(`/rentals/contracts/${settleTarget.id}/settle`, {
                    body: {
                      extraFee: Number(settleExtra),
                      discount: Number(settleDiscount),
                      paymentMethod: settleMethod,
                      sellerNote: settleNote || null,
                    },
                  });
                  setSettleTarget(null);
                  setContractFilter('DONE');
                })
              }
              disabled={!!busy}
              data-testid="rental-settle-confirm"
            >
              Xác nhận quyết toán
            </Button>
          </>
        }
      >
        {settleTarget && (
          <div className="space-y-3.5">
            {(() => {
              const total = Math.max(0, settleTarget.baseTotal + Number(settleExtra || 0) - Number(settleDiscount || 0));
              const refund = Math.max(0, settleTarget.depositPaid - total);
              const collect = Math.max(0, total - settleTarget.depositPaid);
              return (
                <div className="rounded-2xl bg-emerald-50 p-3.5 text-sm space-y-1">
                  <div>
                    Tiền thuê gốc: <b>{fmtVnd(settleTarget.baseTotal)}</b> · Đã nhận cọc: <b>{fmtVnd(settleTarget.depositPaid)}</b>
                  </div>
                  <div className="font-semibold text-emerald-900">
                    Tổng tiền thuê chốt: {fmtVnd(total)} ·{' '}
                    {refund > 0 ? `Hoàn cọc lại khách: ${fmtVnd(refund)}` : collect > 0 ? `Thu thêm của khách: ${fmtVnd(collect)}` : 'Khớp tiền cọc'}
                  </div>
                  {mode === 'GARAGE' && <div className="text-xs text-emerald-700">Hệ thống sẽ tự động ghi phiếu thu sổ quỹ chi nhánh ({fmtVnd(total)}).</div>}
                </div>
              );
            })()}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Phụ phí phát sinh (đồng)">
                {(id) => <Input id={id} type="number" min={0} step={50000} value={settleExtra} onChange={(e) => setSettleExtra(e.target.value)} />}
              </Field>
              <Field label="Giảm giá / hỗ trợ (đồng)">
                {(id) => <Input id={id} type="number" min={0} step={50000} value={settleDiscount} onChange={(e) => setSettleDiscount(e.target.value)} />}
              </Field>
            </div>
            <Field label="Hình thức thanh toán / tất toán">
              {(id) => (
                <Select id={id} value={settleMethod} onChange={(e) => setSettleMethod(e.target.value as 'TIEN_MAT' | 'CHUYEN_KHOAN' | 'THE')}>
                  <option value="CHUYEN_KHOAN">Chuyển khoản</option>
                  <option value="TIEN_MAT">Tiền mặt</option>
                  <option value="THE">Quẹt thẻ</option>
                </Select>
              )}
            </Field>
            <Field label="Ghi chú quyết toán">
              {(id) => <Input id={id} value={settleNote} onChange={(e) => setSettleNote(e.target.value)} placeholder="Đã hoàn lại cọc chuyển khoản cho khách" />}
            </Field>
          </div>
        )}
      </Dialog>
    </div>
  );
}
