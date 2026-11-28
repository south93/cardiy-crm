'use client';

import { Alert, Badge, Button, Card, CardTitle, Checkbox, Dialog, Field, Input, Select, Spinner } from '@cardiy/ui';
import { ArrowRightLeft, History, Plus, RotateCw, ShieldCheck, Trash2, Unplug, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ExportButton } from '@/components/export-button';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtKm } from '@/lib/crm';
import {
  MAINT_ALERT_UI,
  SERIAL_KINDS,
  SERIAL_POSITIONS,
  SERIAL_STATUS_UI,
  WARRANTY_STATE_UI,
  type MaintenanceRuleItem,
  type SerialDetailView,
  type SerialEventView,
  type SerialItemView,
  type SerialKind,
  type SerialTransitionAction,
  type VehicleMaintenanceItemView,
  type VehicleMaintenanceResponse,
} from '@/lib/fleet';
import { fmtDateTime } from '@/lib/orders';

const errMsg = (e: unknown, fallback: string) =>
  e instanceof ApiError ? (e.errors?.[0]?.message ?? e.message) : fallback;

const todayYmd = () => {
  const d = new Date(Date.now() + 7 * 3_600_000);
  return d.toISOString().slice(0, 10);
};

interface PickedVehicle {
  id: string;
  plate: string;
  make: string | null;
  model: string | null;
  odometerKm: number | null;
}

function VehicleSearchPicker({
  selected,
  excludeVehicleId,
  onSelect,
}: {
  selected: PickedVehicle | null;
  excludeVehicleId?: string | null;
  onSelect: (v: PickedVehicle | null) => void;
}) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<PickedVehicle[]>([]);

  useEffect(() => {
    if (selected || q.trim().length < 2) {
      setItems([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await api<{ items: PickedVehicle[] }>(`/vehicles?pageSize=8&q=${encodeURIComponent(q.trim())}`);
        setItems(res.items.filter((v) => v.id !== excludeVehicleId));
      } catch {
        setItems([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [q, selected, excludeVehicleId]);

  if (selected) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-brand-200 bg-brand-50/60 px-3 py-2 text-sm">
        <div>
          <span className="font-mono font-bold text-slate-900">{selected.plate}</span>
          <span className="ml-2 text-slate-600">{[selected.make, selected.model].filter(Boolean).join(' ')}</span>
          {selected.odometerKm !== null && <span className="ml-2 text-xs text-slate-500">({fmtKm(selected.odometerKm)})</span>}
        </div>
        <button type="button" onClick={() => onSelect(null)} className="text-xs font-medium text-brand-600 hover:underline">
          Đổi xe
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Nhập biển số xe (VD: 61A, 51G…) để chọn xe"
        data-testid="serial-vehicle-search"
      />
      {items.length > 0 && (
        <ul className="max-h-44 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 bg-white text-sm shadow-sm">
          {items.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => onSelect(v)}
                className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-brand-50"
                data-testid="serial-vehicle-option"
              >
                <span>
                  <b className="font-mono">{v.plate}</b>{' '}
                  <span className="text-slate-600">{[v.make, v.model].filter(Boolean).join(' ')}</span>
                </span>
                <span className="text-xs text-slate-400">{fmtKm(v.odometerKm)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SerialEventsTimeline({ events }: { events: SerialEventView[] }) {
  if (!events.length) return <p className="text-sm text-slate-500">Chưa có lịch sử thao tác.</p>;
  return (
    <ol className="space-y-2.5 text-sm" data-testid="serial-events-timeline">
      {events.map((ev) => (
        <li key={ev.id} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                tone={
                  ev.action === 'DOI_BAO_HANH'
                    ? 'rose'
                    : ev.action === 'CHUYEN_XE' || ev.action === 'DAO_VI_TRI'
                      ? 'peach'
                      : ev.action === 'LAP_MOI' || ev.action === 'LAP_LAI'
                        ? 'mint'
                        : 'slate'
                }
              >
                {ev.actionLabel}
              </Badge>
              {ev.fromVehicle && ev.toVehicle && ev.fromVehicle.id !== ev.toVehicle.id ? (
                <span className="font-mono text-xs font-semibold">
                  {ev.fromVehicle.plate} → {ev.toVehicle.plate}
                </span>
              ) : ev.toVehicle ? (
                <Link href={`/xe/${ev.toVehicle.id}`} className="font-mono text-xs font-semibold text-brand-600 hover:underline">
                  {ev.toVehicle.plate}
                </Link>
              ) : ev.fromVehicle ? (
                <Link href={`/xe/${ev.fromVehicle.id}`} className="font-mono text-xs font-semibold text-slate-600 hover:underline">
                  Từ xe {ev.fromVehicle.plate}
                </Link>
              ) : null}
              {(ev.fromPositionLabel || ev.toPositionLabel) && (
                <span className="text-xs text-slate-600">
                  {ev.fromPositionLabel && ev.toPositionLabel && ev.fromPosition !== ev.toPosition
                    ? `${ev.fromPositionLabel} → ${ev.toPositionLabel}`
                    : (ev.toPositionLabel ?? ev.fromPositionLabel)}
                </span>
              )}
            </div>
            <span className="text-xs text-slate-400">{fmtDateTime(ev.performedAt)}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
            {ev.odometerKm !== null && <span>Đồng hồ: {fmtKm(ev.odometerKm)}</span>}
            {ev.orderCode && ev.orderId && (
              <Link href={`/don-hang/${ev.orderId}`} className="text-brand-600 hover:underline">
                Đơn {ev.orderCode}
              </Link>
            )}
            {ev.actorName && <span>Thực hiện: {ev.actorName}</span>}
          </div>
          {ev.note && <div className="mt-1 text-xs text-slate-700">{ev.note}</div>}
        </li>
      ))}
    </ol>
  );
}

export function SerialCreateDialog({
  open,
  onClose,
  onCreated,
  fixedVehicle,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  fixedVehicle?: PickedVehicle | null;
}) {
  const [kind, setKind] = useState<SerialKind>('LOP');
  const [serialNo, setSerialNo] = useState('');
  const [productName, setProductName] = useState('');
  const [brand, setBrand] = useState('');
  const [dotOrMfg, setDotOrMfg] = useState('');
  const [mountNow, setMountNow] = useState(Boolean(fixedVehicle));
  const [vehicle, setVehicle] = useState<PickedVehicle | null>(fixedVehicle ?? null);
  const [position, setPosition] = useState('TRUOC_TRAI');
  const [installedAt, setInstalledAt] = useState(todayYmd());
  const [installedKm, setInstalledKm] = useState('');
  const [warrantyMonths, setWarrantyMonths] = useState('24');
  const [warrantyKm, setWarrantyKm] = useState('50000');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSerialNo('');
    setProductName('');
    setBrand('');
    setDotOrMfg('');
    setMountNow(Boolean(fixedVehicle));
    setVehicle(fixedVehicle ?? null);
    setInstalledAt(todayYmd());
    setInstalledKm(fixedVehicle?.odometerKm ? String(fixedVehicle.odometerKm) : '');
    setNote('');
    setError(null);
  }, [open, fixedVehicle]);

  useEffect(() => {
    const allowed = SERIAL_POSITIONS.filter((p) => p.kinds.includes(kind));
    if (!allowed.some((p) => p.code === position)) {
      setPosition(allowed[0]?.code ?? '');
    }
    if (kind === 'LOP') {
      setWarrantyMonths('36');
      setWarrantyKm('50000');
    } else if (kind === 'AC_QUY') {
      setWarrantyMonths('12');
      setWarrantyKm('30000');
    } else {
      setWarrantyMonths('24');
      setWarrantyKm('60000');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const positionsForKind = SERIAL_POSITIONS.filter((p) => p.kinds.includes(kind));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mountNow && !vehicle) {
      setError('Vui lòng chọn xe cần lắp sê-ri, hoặc bỏ chọn "Lắp trực tiếp lên xe" để nhập vào kho.');
      return;
    }
    setBusy(true);
    try {
      await api('/serials', {
        body: {
          kind,
          serialNo: serialNo.trim(),
          productName: productName.trim(),
          brand: brand.trim() || null,
          dotOrMfg: dotOrMfg.trim() || null,
          vehicleId: mountNow && vehicle ? vehicle.id : null,
          position: mountNow ? position || null : null,
          installedAt: mountNow ? installedAt : null,
          installedKm: mountNow && installedKm ? Number(installedKm.replace(/\D/g, '')) : null,
          warrantyMonths: warrantyMonths ? Number(warrantyMonths) : null,
          warrantyKm: warrantyKm ? Number(warrantyKm.replace(/\D/g, '')) : null,
          note: note.trim() || null,
        },
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(errMsg(err, 'Không lưu được số sê-ri'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Đăng ký Sê-ri & Bảo hành (Lốp / Ắc quy / Pin Lithium)"
      wide
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" form="create-serial-form" disabled={busy} data-testid="save-serial-btn">
            {busy && <Spinner />}
            Lưu Sê-ri
          </Button>
        </>
      }
    >
      <form id="create-serial-form" onSubmit={submit} className="space-y-3">
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Nhóm sản phẩm">
            {(id) => (
              <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as SerialKind)} data-testid="serial-kind-select">
                {SERIAL_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Số Sê-ri / Mã định danh" className="sm:col-span-2">
            {(id) => (
              <Input
                id={id}
                required
                value={serialNo}
                onChange={(e) => setSerialNo(e.target.value.toUpperCase())}
                placeholder="VD: MICH-20555R16-88901 hoặc VARTA-75D23L-0092"
                className="font-mono uppercase"
                data-testid="serial-no-input"
              />
            )}
          </Field>
          <Field label="Tên sản phẩm" className="sm:col-span-2">
            {(id) => (
              <Input
                id={id}
                required
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="VD: Lốp Michelin Primacy 4 205/55R16"
                data-testid="serial-product-input"
              />
            )}
          </Field>
          <Field label="Thương hiệu">
            {(id) => <Input id={id} value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Michelin, Varta, CATL…" />}
          </Field>
          <Field label={kind === 'LOP' ? 'Tuần/Năm SX (Mã DOT)' : 'Mã lô / Ngày SX'}>
            {(id) => <Input id={id} value={dotOrMfg} onChange={(e) => setDotOrMfg(e.target.value)} placeholder={kind === 'LOP' ? 'VD: DOT 4225' : 'VD: LOT-10/2026'} />}
          </Field>
          <Field label="Thời hạn bảo hành (tháng)">
            {(id) => <Input id={id} type="number" min={1} max={120} value={warrantyMonths} onChange={(e) => setWarrantyMonths(e.target.value)} />}
          </Field>
          <Field label="Giới hạn km bảo hành">
            {(id) => <Input id={id} inputMode="numeric" value={warrantyKm} onChange={(e) => setWarrantyKm(e.target.value)} placeholder="VD: 50000" />}
          </Field>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-3">
          {!fixedVehicle && (
            <Checkbox
              checked={mountNow}
              onChange={(e) => setMountNow(e.target.checked)}
              label={<span className="font-medium">Lắp trực tiếp lên xe của khách ngay (bỏ chọn nếu chỉ nhập lưu kho)</span>}
            />
          )}
          {mountNow && (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <div className="mb-1 text-xs font-medium text-slate-700">Xe đang sử dụng</div>
                {fixedVehicle ? (
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm font-semibold">
                    {fixedVehicle.plate} <span className="font-sans font-normal text-slate-500">{[fixedVehicle.make, fixedVehicle.model].filter(Boolean).join(' ')}</span>
                  </div>
                ) : (
                  <VehicleSearchPicker
                    selected={vehicle}
                    onSelect={(v) => {
                      setVehicle(v);
                      if (v?.odometerKm && !installedKm) setInstalledKm(String(v.odometerKm));
                    }}
                  />
                )}
              </div>
              <Field label="Vị trí lắp trên xe">
                {(id) => (
                  <Select id={id} value={position} onChange={(e) => setPosition(e.target.value)} data-testid="serial-position-select">
                    <option value="">— Không chỉ định —</option>
                    {positionsForKind.map((p) => (
                      <option key={p.code} value={p.code}>
                        {p.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Ngày lắp">
                {(id) => <Input id={id} type="date" value={installedAt} onChange={(e) => setInstalledAt(e.target.value)} />}
              </Field>
              <Field label="Số km tại thời điểm lắp">
                {(id) => (
                  <Input
                    id={id}
                    inputMode="numeric"
                    value={installedKm}
                    onChange={(e) => setInstalledKm(e.target.value)}
                    placeholder="VD: 35000"
                  />
                )}
              </Field>
            </div>
          )}
        </div>

        <Field label="Ghi chú thêm">
          {(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: Thay mới cả cặp cầu trước, cân bằng động" />}
        </Field>
      </form>
    </Dialog>
  );
}

export function SerialTransitionDialog({
  serial,
  initialAction,
  onClose,
  onDone,
}: {
  serial: SerialItemView | null;
  initialAction: SerialTransitionAction;
  onClose: () => void;
  onDone: () => void;
}) {
  const [action, setAction] = useState<SerialTransitionAction>(initialAction);
  const [targetVehicle, setTargetVehicle] = useState<PickedVehicle | null>(null);
  const [toPosition, setToPosition] = useState('');
  const [odometerKm, setOdometerKm] = useState('');
  const [replacementSerialNo, setReplacementSerialNo] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!serial) return;
    setAction(initialAction);
    setTargetVehicle(null);
    const allowed = SERIAL_POSITIONS.filter((p) => p.kinds.includes(serial.kind));
    setToPosition(serial.position ?? allowed[0]?.code ?? '');
    setOdometerKm(serial.vehicle?.odometerKm ? String(serial.vehicle.odometerKm) : '');
    setReplacementSerialNo('');
    setNote('');
    setError(null);
  }, [serial, initialAction]);

  if (!serial) return null;

  const positions = SERIAL_POSITIONS.filter((p) => p.kinds.includes(serial.kind));
  const needsVehicle = action === 'LAP_MOI' || action === 'LAP_LAI' || action === 'CHUYEN_XE';
  const needsPosition = needsVehicle || action === 'DAO_VI_TRI';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (needsVehicle && !targetVehicle) {
      setError('Vui lòng tìm và chọn xe nhận sê-ri.');
      return;
    }
    setBusy(true);
    try {
      await api(`/serials/${serial.id}/transition`, {
        body: {
          action,
          toVehicleId: needsVehicle ? targetVehicle?.id : null,
          toPosition: needsPosition ? toPosition || null : null,
          odometerKm: odometerKm ? Number(odometerKm.replace(/\D/g, '')) : null,
          replacementSerialNo: action === 'DOI_BAO_HANH' && replacementSerialNo.trim() ? replacementSerialNo.trim() : null,
          note: note.trim() || null,
        },
      });
      onDone();
      onClose();
    } catch (err) {
      setError(errMsg(err, 'Không thực hiện được thao tác sê-ri'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={Boolean(serial)}
      onClose={onClose}
      title={`Cập nhật vòng đời Sê-ri ${serial.serialNo}`}
      wide
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" form="transition-serial-form" disabled={busy} data-testid="confirm-serial-transition">
            {busy && <Spinner />}
            Xác nhận thực hiện
          </Button>
        </>
      }
    >
      <form id="transition-serial-form" onSubmit={submit} className="space-y-3">
        {error && <Alert>{error}</Alert>}
        <div className="rounded-2xl bg-slate-50 p-3 text-sm">
          <div className="font-semibold">
            {serial.productName} <span className="font-mono text-brand-700">({serial.serialNo})</span>
          </div>
          <div className="mt-0.5 text-xs text-slate-600">
            Hiện tại: <b>{serial.statusLabel}</b>
            {serial.vehicle && ` · Xe ${serial.vehicle.plate}`}
            {serial.positionLabel && ` · Vị trí: ${serial.positionLabel}`}
          </div>
        </div>

        <Field label="Thao tác nghiệp vụ">
          {(id) => (
            <Select
              id={id}
              value={action}
              onChange={(e) => setAction(e.target.value as SerialTransitionAction)}
              data-testid="serial-action-select"
            >
              {serial.status !== 'DANG_SU_DUNG' && (
                <option value={serial.installedAt ? 'LAP_LAI' : 'LAP_MOI'}>
                  {serial.installedAt ? 'Lắp lại lên xe' : 'Lắp mới lên xe'}
                </option>
              )}
              {serial.status === 'DANG_SU_DUNG' && (
                <>
                  <option value="DAO_VI_TRI">Đảo vị trí trên cùng xe (VD: đảo lốp trước ↔ sau)</option>
                  <option value="CHUYEN_XE">Chuyển sang xe khác</option>
                  <option value="THAO_RA">Tháo rời khỏi xe (cất kho / chờ lắp lại)</option>
                </>
              )}
              <option value="DOI_BAO_HANH">Thu hồi / Đổi bảo hành</option>
              <option value="LOAI_BO">Thanh lý / Ngừng sử dụng</option>
            </Select>
          )}
        </Field>

        {needsVehicle && (
          <div>
            <div className="mb-1 text-sm font-medium text-slate-700">
              {action === 'CHUYEN_XE' ? 'Chọn xe nhận chuyển sang' : 'Chọn xe lắp sản phẩm'}
            </div>
            <VehicleSearchPicker
              selected={targetVehicle}
              excludeVehicleId={action === 'CHUYEN_XE' ? serial.vehicle?.id : null}
              onSelect={(v) => {
                setTargetVehicle(v);
                if (v?.odometerKm) setOdometerKm(String(v.odometerKm));
              }}
            />
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {needsPosition && (
            <Field label="Vị trí lắp mới">
              {(id) => (
                <Select id={id} value={toPosition} onChange={(e) => setToPosition(e.target.value)} data-testid="transition-position-select">
                  <option value="">— Không chỉ định —</option>
                  {positions.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label="Số km đồng hồ tại thời điểm thao tác">
            {(id) => (
              <Input
                id={id}
                inputMode="numeric"
                value={odometerKm}
                onChange={(e) => setOdometerKm(e.target.value)}
                placeholder="VD: 45000"
              />
            )}
          </Field>
        </div>

        {action === 'DOI_BAO_HANH' && (
          <Field
            label="Số Sê-ri sản phẩm mới đổi bảo hành cho khách (tuỳ chọn)"
            hint="Nếu nhập, hệ thống tự động tạo sê-ri mới này và gắn thay vào đúng vị trí trên xe của khách"
          >
            {(id) => (
              <Input
                id={id}
                value={replacementSerialNo}
                onChange={(e) => setReplacementSerialNo(e.target.value.toUpperCase())}
                placeholder="VD: MICH-20555R16-99912"
                className="font-mono uppercase"
                data-testid="replacement-serial-input"
              />
            )}
          </Field>
        )}

        <Field label="Ghi chú / Lý do">
          {(id) => (
            <Input
              id={id}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="VD: Đảo lốp định kỳ 10.000 km / Chuyển bình sang xe tải nhỏ / Phồng hông bảo hành hãng"
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}

export function SerialHistoryDialog({ serialId, onClose }: { serialId: string | null; onClose: () => void }) {
  const [detail, setDetail] = useState<SerialDetailView | null>(null);
  useEffect(() => {
    if (!serialId) {
      setDetail(null);
      return;
    }
    api<SerialDetailView>(`/serials/${serialId}`).then(setDetail);
  }, [serialId]);

  return (
    <Dialog open={Boolean(serialId)} onClose={onClose} title={detail ? `Lịch sử Sê-ri ${detail.serialNo}` : 'Chi tiết Sê-ri'} wide>
      {!detail ? (
        <div className="p-6 text-center">
          <Spinner className="mx-auto text-brand-600" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-2 rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5 text-sm sm:grid-cols-2">
            <div>
              <div className="text-xs text-slate-500">Sản phẩm</div>
              <div className="font-semibold">{detail.productName}</div>
              <div className="text-xs text-slate-500">
                {detail.kindLabel}
                {detail.brand && ` · ${detail.brand}`}
                {detail.dotOrMfg && ` · ${detail.dotOrMfg}`}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Tình trạng bảo hành</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                <Badge tone={WARRANTY_STATE_UI[detail.warrantyState].tone}>
                  {WARRANTY_STATE_UI[detail.warrantyState].label}
                </Badge>
                <Badge tone={SERIAL_STATUS_UI[detail.status].tone}>{detail.statusLabel}</Badge>
              </div>
              <div className="mt-1 text-xs text-slate-600">{detail.warrantySummary}</div>
            </div>
          </div>
          <div>
            <h4 className="mb-2 text-sm font-semibold text-slate-700">Nhật ký lắp, đảo vị trí, tháo, chuyển xe & bảo hành</h4>
            <SerialEventsTimeline events={detail.events} />
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** Bảng Theo dõi sử dụng & Nhắc bảo dưỡng theo số km / thời gian ngay trong Hồ sơ xe (/xe/[id]) */
export function VehicleMaintenancePanel({
  vehicleId,
  plate,
  currentKm,
  reloadToken,
  onChanged,
}: {
  vehicleId: string;
  plate: string;
  currentKm: number | null;
  reloadToken?: number;
  onChanged?: () => void;
}) {
  const { can } = useAuth();
  const canEdit = can('vehicle.manage') || can('ro.manage') || can('ro.task.update');
  const [data, setData] = useState<VehicleMaintenanceResponse | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [openAdd, setOpenAdd] = useState(false);
  const [categoryCode, setCategoryCode] = useState('DAU_NHOT');
  const [itemName, setItemName] = useState('');
  const [installedAt, setInstalledAt] = useState(todayYmd());
  const [installedKm, setInstalledKm] = useState('');
  const [intervalKm, setIntervalKm] = useState('5000');
  const [intervalMonths, setIntervalMonths] = useState('6');
  const [remindBeforeKm, setRemindBeforeKm] = useState('500');
  const [remindBeforeDays, setRemindBeforeDays] = useState('15');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setData(await api<VehicleMaintenanceResponse>(`/maintenance/vehicles/${vehicleId}`));
  }, [vehicleId]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  const applyRule = (rule: MaintenanceRuleItem | undefined) => {
    if (!rule) return;
    setCategoryCode(rule.code);
    setItemName(rule.name);
    setIntervalKm(rule.intervalKm ? String(rule.intervalKm) : '');
    setIntervalMonths(rule.intervalMonths ? String(rule.intervalMonths) : '');
    setRemindBeforeKm(String(rule.remindBeforeKm));
    setRemindBeforeDays(String(rule.remindBeforeDays));
  };

  const startAdd = () => {
    const firstRule = data?.rules[0];
    setInstalledAt(todayYmd());
    setInstalledKm(currentKm !== null ? String(currentKm) : '');
    setNote('');
    setError(null);
    if (firstRule) applyRule(firstRule);
    setOpenAdd(true);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/maintenance/vehicles/${vehicleId}`, {
        body: {
          categoryCode,
          itemName: itemName.trim(),
          installedAt,
          installedKm: installedKm ? Number(installedKm.replace(/\D/g, '')) : null,
          intervalKm: intervalKm ? Number(intervalKm.replace(/\D/g, '')) : null,
          intervalMonths: intervalMonths ? Number(intervalMonths) : null,
          remindBeforeKm: Number(remindBeforeKm || 500),
          remindBeforeDays: Number(remindBeforeDays || 15),
          note: note.trim() || null,
        },
      });
      setOpenAdd(false);
      await load();
      onChanged?.();
    } catch (err) {
      setError(errMsg(err, 'Không lưu được mốc bảo dưỡng'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item: VehicleMaintenanceItemView) => {
    if (!window.confirm(`Xoá theo dõi hạng mục "${item.itemName}"?`)) return;
    await api(`/maintenance/vehicles/${vehicleId}/${item.id}`, { method: 'DELETE' });
    await load();
  };

  return (
    <Card className="p-4 lg:p-5" data-testid="vehicle-maintenance-panel">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Wrench className="h-4 w-4 text-brand-600" />
          <CardTitle>Theo dõi sử dụng & Nhắc bảo dưỡng (Km / Thời gian)</CardTitle>
        </div>
        <div className="flex items-center gap-2">
          {data && data.active.length > 0 && (
            <ExportButton
              filename={`bao-duong-${plate}`}
              sheetName="Theo dõi bảo dưỡng"
              testId="export-vehicle-maintenance"
              rows={[...data.active, ...data.history]}
              columns={[
                { header: 'Hạng mục', value: (i) => i.itemName },
                { header: 'Ngày lắp/thay', value: (i) => fmtDate(i.installedAt) },
                { header: 'Số km lúc thay', value: (i) => i.installedKm },
                { header: 'Km đã chạy từ lúc thay', value: (i) => i.kmDriven },
                { header: 'Chu kỳ km', value: (i) => i.intervalKm },
                { header: 'Chu kỳ tháng', value: (i) => i.intervalMonths },
                { header: 'Mốc km tiếp theo', value: (i) => i.nextDueKm },
                { header: 'Ngày đến hạn', value: (i) => (i.nextDueDate ? fmtDate(i.nextDueDate) : '') },
                { header: 'Cảnh báo', value: (i) => MAINT_ALERT_UI[i.alertState].label },
              ]}
            />
          )}
          {canEdit && (
            <Button variant="outline" onClick={startAdd} data-testid="add-maint-item">
              <Plus className="h-4 w-4" />
              Ghi nhận thay / Đặt nhắc
            </Button>
          )}
        </div>
      </div>

      {!data ? (
        <Spinner className="text-brand-600" />
      ) : data.active.length === 0 ? (
        <p className="rounded-2xl bg-slate-50 p-3.5 text-sm text-slate-500">
          Chưa có hạng mục nào đang theo dõi (lốp, dầu nhớt, ắc quy…). Khi giao đơn sửa chữa có thay dầu/lốp/ắc quy hệ thống sẽ tự động ghi nhận, hoặc bấm <b>Ghi nhận thay / Đặt nhắc</b> để nhập ngay.
        </p>
      ) : (
        <div className="space-y-2.5" data-testid="maint-active-list">
          {data.active.map((item) => {
            const ui = MAINT_ALERT_UI[item.alertState];
            return (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50/50 p-3.5"
                data-testid="maint-item-row"
              >
                <div className="min-w-[220px] flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-900">{item.itemName}</span>
                    <Badge tone={ui.tone}>{ui.label}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                    <span>
                      Ngày thay: <b>{fmtDate(item.installedAt)}</b>
                    </span>
                    <span>
                      Km lúc thay: <b>{fmtKm(item.installedKm)}</b>
                    </span>
                    {item.kmDriven !== null && (
                      <span className="text-brand-700" data-testid="maint-km-driven">
                        Đã chạy từ lần thay: <b>{item.kmDriven.toLocaleString('vi-VN')} km</b>
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500">{item.reasonText}</div>
                  {item.note && <div className="text-xs italic text-slate-500">Ghi chú: {item.note}</div>}
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => void remove(item)}
                    aria-label={`Xoá ${item.itemName}`}
                    className="grid h-8 w-8 place-items-center rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {data && data.history.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowHistory((s) => !s)}
            className="text-xs font-medium text-brand-600 hover:underline"
          >
            {showHistory ? 'Ẩn lịch sử các lần thay trước' : `Xem lịch sử các lần thay trước (${data.history.length})`}
          </button>
          {showHistory && (
            <ul className="mt-2 space-y-1.5 text-xs text-slate-500">
              {data.history.map((h) => (
                <li key={h.id} className="flex flex-wrap justify-between rounded-xl bg-slate-50 px-3 py-2">
                  <span>
                    <b>{h.itemName}</b> · thay ngày {fmtDate(h.installedAt)} ở mốc {fmtKm(h.installedKm)}
                  </span>
                  <span>Đã thay mới</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Dialog
        open={openAdd}
        onClose={() => setOpenAdd(false)}
        title={`Ghi nhận thay mới & Đặt nhắc bảo dưỡng (${plate})`}
        wide
        footer={
          <>
            <Button variant="outline" onClick={() => setOpenAdd(false)}>
              Huỷ
            </Button>
            <Button type="submit" form="maint-item-form" disabled={busy} data-testid="save-maint-item">
              {busy && <Spinner />}
              Lưu theo dõi
            </Button>
          </>
        }
      >
        <form id="maint-item-form" onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          {error && <Alert className="sm:col-span-2">{error}</Alert>}
          <Field label="Nhóm hạng mục chuẩn">
            {(id) => (
              <Select
                id={id}
                value={categoryCode}
                onChange={(e) => {
                  const code = e.target.value;
                  setCategoryCode(code);
                  applyRule(data?.rules.find((r) => r.code === code));
                }}
                data-testid="maint-category-select"
              >
                {data?.rules.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.name}
                  </option>
                ))}
                <option value="TUY_CHINH">Hạng mục tuỳ chỉnh khác</option>
              </Select>
            )}
          </Field>
          <Field label="Tên hạng mục / Vật tư đã thay">
            {(id) => (
              <Input
                id={id}
                required
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                placeholder="VD: Dầu Castrol Magnatec 5W-30"
                data-testid="maint-name-input"
              />
            )}
          </Field>
          <Field label="Ngày lắp / thay">
            {(id) => <Input id={id} type="date" value={installedAt} onChange={(e) => setInstalledAt(e.target.value)} />}
          </Field>
          <Field label="Số km tại thời điểm thay">
            {(id) => (
              <Input
                id={id}
                inputMode="numeric"
                value={installedKm}
                onChange={(e) => setInstalledKm(e.target.value)}
                placeholder="VD: 20000"
                data-testid="maint-installed-km"
              />
            )}
          </Field>
          <Field label="Chu kỳ nhắc theo số km" hint="Để trống nếu chỉ nhắc theo thời gian">
            {(id) => (
              <Input
                id={id}
                inputMode="numeric"
                value={intervalKm}
                onChange={(e) => setIntervalKm(e.target.value)}
                placeholder="VD: 5000"
                data-testid="maint-interval-km"
              />
            )}
          </Field>
          <Field label="Chu kỳ nhắc theo thời gian (tháng)" hint="Hệ thống nhắc khi chạm 1 trong 2 mốc trước">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={1}
                max={120}
                value={intervalMonths}
                onChange={(e) => setIntervalMonths(e.target.value)}
                placeholder="VD: 6"
              />
            )}
          </Field>
          <Field label="Báo nhắc trước (km)">
            {(id) => <Input id={id} type="number" min={0} value={remindBeforeKm} onChange={(e) => setRemindBeforeKm(e.target.value)} />}
          </Field>
          <Field label="Báo nhắc trước (ngày)">
            {(id) => <Input id={id} type="number" min={1} value={remindBeforeDays} onChange={(e) => setRemindBeforeDays(e.target.value)} />}
          </Field>
          <Field label="Ghi chú" className="sm:col-span-2">
            {(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: Thay kèm lọc nhớt chính hãng" />}
          </Field>
        </form>
      </Dialog>
    </Card>
  );
}

/** Bảng Sê-ri Lốp, Ắc quy & Pin Lithium đang gắn trên xe (/xe/[id]) */
export function VehicleSerialsPanel({
  vehicleId,
  plate,
  make,
  model,
  currentKm,
  reloadToken,
  onChanged,
}: {
  vehicleId: string;
  plate: string;
  make: string | null;
  model: string | null;
  currentKm: number | null;
  reloadToken?: number;
  onChanged?: () => void;
}) {
  const { can } = useAuth();
  const canEdit = can('vehicle.manage') || can('inventory.manage') || can('ro.manage') || can('ro.task.update');
  const [items, setItems] = useState<SerialItemView[] | null>(null);
  const [openCreate, setOpenCreate] = useState(false);
  const [transitionItem, setTransitionItem] = useState<{ item: SerialItemView; action: SerialTransitionAction } | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api<{ items: SerialItemView[] }>(`/serials?vehicleId=${vehicleId}&pageSize=50`);
    setItems(res.items);
  }, [vehicleId]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  const handleChanged = () => {
    void load();
    onChanged?.();
  };

  return (
    <Card className="p-4 lg:p-5" data-testid="vehicle-serials-panel">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-mint-700" />
          <CardTitle>Sê-ri Lốp, Ắc quy & Pin Lithium trên xe</CardTitle>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/seri-bao-hanh?q=${encodeURIComponent(plate)}`} className="text-xs font-medium text-brand-600 hover:underline">
            Tra cứu toàn bộ lịch sử sê-ri xe này
          </Link>
          {canEdit && (
            <Button variant="outline" onClick={() => setOpenCreate(true)} data-testid="vehicle-add-serial">
              <Plus className="h-4 w-4" />
              Lắp / Ghi Sê-ri
            </Button>
          )}
        </div>
      </div>

      {!items ? (
        <Spinner className="text-brand-600" />
      ) : items.length === 0 ? (
        <p className="rounded-2xl bg-slate-50 p-3.5 text-sm text-slate-500">
          Chưa có sản phẩm quản lý sê-ri (lốp, ắc quy, pin lithium) nào đang gắn trên xe.
        </p>
      ) : (
        <div className="space-y-2.5" data-testid="vehicle-serial-list">
          {items.map((s) => (
            <div
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white p-3.5"
              data-testid="vehicle-serial-row"
            >
              <div className="min-w-[220px] flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-bold text-slate-900">{s.serialNo}</span>
                  <Badge tone="sky">{s.kindLabel}</Badge>
                  {s.positionLabel && <Badge tone="lav">{s.positionLabel}</Badge>}
                  <Badge tone={WARRANTY_STATE_UI[s.warrantyState].tone}>{WARRANTY_STATE_UI[s.warrantyState].label}</Badge>
                </div>
                <div className="text-sm font-medium text-slate-700">
                  {s.productName}
                  {s.brand && ` · ${s.brand}`}
                  {s.dotOrMfg && <span className="ml-2 font-mono text-xs text-slate-500">({s.dotOrMfg})</span>}
                </div>
                <div className="text-xs text-slate-500">
                  {s.installedAt && `Lắp ${fmtDate(s.installedAt)}`}
                  {s.installedKm !== null && ` tại ${fmtKm(s.installedKm)}`}
                  {s.kmUsedSinceInstall !== null && ` · Đã chạy ${s.kmUsedSinceInstall.toLocaleString('vi-VN')} km`}
                  {s.warrantySummary && ` · ${s.warrantySummary}`}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {canEdit && (
                  <>
                    <Button
                      variant="outline"
                      className="px-2.5 py-1.5 text-xs"
                      onClick={() => setTransitionItem({ item: s, action: 'DAO_VI_TRI' })}
                      title="Đảo vị trí trên xe"
                    >
                      <RotateCw className="h-3.5 w-3.5" />
                      Đảo vị trí
                    </Button>
                    <Button
                      variant="outline"
                      className="px-2.5 py-1.5 text-xs"
                      onClick={() => setTransitionItem({ item: s, action: 'CHUYEN_XE' })}
                      title="Chuyển sang xe khác"
                    >
                      <ArrowRightLeft className="h-3.5 w-3.5" />
                      Chuyển xe
                    </Button>
                    <Button
                      variant="outline"
                      className="px-2.5 py-1.5 text-xs"
                      onClick={() => setTransitionItem({ item: s, action: 'THAO_RA' })}
                      title="Tháo rời khỏi xe"
                    >
                      <Unplug className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
                <Button variant="outline" className="px-2.5 py-1.5 text-xs" onClick={() => setHistoryId(s.id)} title="Xem lịch sử sê-ri">
                  <History className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <SerialCreateDialog
        open={openCreate}
        onClose={() => setOpenCreate(false)}
        onCreated={handleChanged}
        fixedVehicle={{ id: vehicleId, plate, make, model, odometerKm: currentKm }}
      />
      <SerialTransitionDialog
        serial={transitionItem?.item ?? null}
        initialAction={transitionItem?.action ?? 'DAO_VI_TRI'}
        onClose={() => setTransitionItem(null)}
        onDone={handleChanged}
      />
      <SerialHistoryDialog serialId={historyId} onClose={() => setHistoryId(null)} />
    </Card>
  );
}
