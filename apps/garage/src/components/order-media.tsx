/* eslint-disable @next/next/no-img-element */
'use client';

import {
  DASHBOARD_WARNINGS,
  FUEL_LEVEL_LABEL,
  FUEL_LEVELS,
  ORDER_PHOTO_STAGE_LABEL,
  PHOTO_TAGS_BY_STAGE,
  type FuelLevel,
  type OrderIntakeData,
  type OrderPhotoItem,
  type OrderPhotoStage,
} from '@cardiy/shared';
import { Alert, Badge, Button, Card, CardTitle, Dialog, Field, Input, Spinner } from '@cardiy/ui';
import { AlertTriangle, Camera, CheckCircle2, Fuel, ImagePlus, Pencil, ShieldCheck, Trash2, Upload, Wrench, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime } from '@/lib/orders';

export interface IntakeDraft {
  fuelLevel: FuelLevel | null;
  warningLights: string[];
  exteriorNote: string;
  belongings: string;
  hasSpareAndTool: boolean | null;
}

export interface DraftPhoto {
  fileId: string;
  url: string;
  tag: string | null;
  caption: string | null;
}

export interface OrderPhotoWithOwner extends OrderPhotoItem {
  uploaderId?: string | null;
}

export function emptyIntakeDraft(src?: OrderIntakeData | null): IntakeDraft {
  return {
    fuelLevel: src?.fuelLevel ?? null,
    warningLights: src?.warningLights ? [...src.warningLights] : [],
    exteriorNote: src?.exteriorNote ?? '',
    belongings: src?.belongings ?? '',
    hasSpareAndTool: src?.hasSpareAndTool ?? null,
  };
}

export function hasIntakeDraft(d: IntakeDraft): boolean {
  return (
    d.fuelLevel !== null ||
    d.warningLights.length > 0 ||
    d.exteriorNote.trim().length > 0 ||
    d.belongings.trim().length > 0 ||
    d.hasSpareAndTool !== null
  );
}

export function intakeDraftToPayload(d: IntakeDraft) {
  if (!hasIntakeDraft(d)) return null;
  return {
    fuelLevel: d.fuelLevel,
    warningLights: d.warningLights,
    exteriorNote: d.exteriorNote.trim() || null,
    belongings: d.belongings.trim() || null,
    hasSpareAndTool: d.hasSpareAndTool,
  };
}

async function uploadImageFiles(files: FileList | File[]): Promise<{ id: string; url: string }[]> {
  const list = Array.from(files);
  const out: { id: string; url: string }[] = [];
  for (const file of list) {
    const form = new FormData();
    form.append('file', file);
    const uploaded = await api<{ id: string; url: string }>('/files', { form });
    out.push({ id: uploaded.id, url: uploaded.url });
  }
  return out;
}

/** Khung nhập các trường hiện trạng xe ban đầu (dùng chung cho /ban-hang và hộp thoại sửa ở /don-hang/[id]) */
export function IntakeFieldsEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: IntakeDraft;
  onChange: (next: IntakeDraft) => void;
  disabled?: boolean;
}) {
  const toggleWarning = (w: string) => {
    const exists = value.warningLights.includes(w);
    onChange({
      ...value,
      warningLights: exists ? value.warningLights.filter((x) => x !== w) : [...value.warningLights, w],
    });
  };

  return (
    <div className="space-y-3.5">
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <div className="mb-1.5 text-xs font-medium text-slate-600">Mức nhiên liệu / Pin lúc nhận xe</div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Mức nhiên liệu" data-testid="intake-fuel-group">
            {FUEL_LEVELS.map((lvl) => {
              const active = value.fuelLevel === lvl;
              return (
                <button
                  key={lvl}
                  type="button"
                  disabled={disabled}
                  aria-pressed={active}
                  onClick={() => onChange({ ...value, fuelLevel: active ? null : lvl })}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    active
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {FUEL_LEVEL_LABEL[lvl]}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-xs font-medium text-slate-600">Lốp dự phòng &amp; bộ đồ nghề theo xe</div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Lốp dự phòng và đồ nghề">
            {(
              [
                [true, 'Đầy đủ'],
                [false, 'Thiếu / Không có'],
              ] as const
            ).map(([val, label]) => {
              const active = value.hasSpareAndTool === val;
              return (
                <button
                  key={String(val)}
                  type="button"
                  disabled={disabled}
                  aria-pressed={active}
                  onClick={() => onChange({ ...value, hasSpareAndTool: active ? null : val })}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    active
                      ? val
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : 'border-amber-500 bg-amber-500 text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-xs font-medium text-slate-600">Đèn cảnh báo sáng trên táp-lô (nếu có)</div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Đèn cảnh báo táp-lô">
          {DASHBOARD_WARNINGS.map((w) => {
            const active = value.warningLights.includes(w);
            return (
              <button
                key={w}
                type="button"
                disabled={disabled}
                aria-pressed={active}
                onClick={() => toggleWarning(w)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  active
                    ? 'border-rose-600 bg-rose-600 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {w}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Hiện trạng ngoại thất / trầy xước có sẵn">
          {(id) => (
            <textarea
              id={id}
              rows={2}
              disabled={disabled}
              aria-label="Hiện trạng ngoại thất ban đầu"
              value={value.exteriorNote}
              onChange={(e) => onChange({ ...value, exteriorNote: e.target.value })}
              placeholder="VD: Xước cản trước bên phụ, móp nhẹ cửa sau phải, gương kính nguyên vẹn"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            />
          )}
        </Field>
        <Field label="Tư trang / giấy tờ khách để lại trên xe">
          {(id) => (
            <textarea
              id={id}
              rows={2}
              disabled={disabled}
              aria-label="Tư trang để lại trên xe"
              value={value.belongings}
              onChange={(e) => onChange({ ...value, belongings: e.target.value })}
              placeholder="VD: Giấy đăng kiểm, bảo hiểm, camera hành trình, thẻ ETC"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            />
          )}
        </Field>
      </div>
    </div>
  );
}

/** Hiển thị tóm tắt thông tin hiện trạng lúc nhận xe */
export function IntakeSummaryBadges({ intake }: { intake: OrderIntakeData | null | undefined }) {
  if (
    !intake ||
    (!intake.fuelLevel &&
      !intake.warningLights?.length &&
      !intake.exteriorNote &&
      !intake.belongings &&
      intake.hasSpareAndTool === null)
  ) {
    return <p className="text-sm text-slate-500">Chưa ghi nhận chi tiết hiện trạng ban đầu.</p>;
  }

  return (
    <div className="space-y-2.5 text-sm" data-testid="intake-summary">
      <div className="flex flex-wrap items-center gap-2">
        {intake.fuelLevel && (
          <Badge tone="sky">
            <Fuel className="mr-1 inline h-3.5 w-3.5" />
            Nhiên liệu: {FUEL_LEVEL_LABEL[intake.fuelLevel] ?? intake.fuelLevel}
          </Badge>
        )}
        {intake.hasSpareAndTool !== null && (
          <Badge tone={intake.hasSpareAndTool ? 'mint' : 'peach'}>
            Lốp dự phòng &amp; đồ nghề: {intake.hasSpareAndTool ? 'Đầy đủ' : 'Thiếu / Không có'}
          </Badge>
        )}
        {intake.warningLights?.map((w) => (
          <Badge key={w} tone="rose">
            <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
            {w}
          </Badge>
        ))}
      </div>
      {intake.exteriorNote && (
        <div className="rounded-xl bg-slate-50 px-3 py-2">
          <span className="text-xs font-semibold text-slate-500">Ngoại thất ban đầu: </span>
          <span className="whitespace-pre-line text-slate-800">{intake.exteriorNote}</span>
        </div>
      )}
      {intake.belongings && (
        <div className="rounded-xl bg-slate-50 px-3 py-2">
          <span className="text-xs font-semibold text-slate-500">Tư trang / giấy tờ trên xe: </span>
          <span className="whitespace-pre-line text-slate-800">{intake.belongings}</span>
        </div>
      )}
    </div>
  );
}

/** Hộp phóng to ảnh (Lightbox) */
function PhotoLightbox({ photo, onClose }: { photo: { url: string; tag: string | null; caption: string | null } | null; onClose: () => void }) {
  return (
    <Dialog open={!!photo} onClose={onClose} title={photo?.tag || 'Xem hình ảnh'} wide>
      {photo && (
        <div className="space-y-3">
          <div className="overflow-hidden rounded-2xl bg-slate-950">
            <img src={photo.url} alt={photo.tag ?? 'Ảnh xe'} className="mx-auto max-h-[72vh] w-auto object-contain" />
          </div>
          {photo.caption && <p className="text-sm text-slate-700">{photo.caption}</p>}
        </div>
      )}
    </Dialog>
  );
}

/** Thanh chọn nhãn vị trí + nút Chụp camera / Tải ảnh từ thiết bị */
function StageUploadToolbar({
  stage,
  uploading,
  onFiles,
  testIdPrefix,
}: {
  stage: OrderPhotoStage;
  uploading: boolean;
  onFiles: (files: FileList, tag: string | null, caption: string | null) => Promise<void>;
  testIdPrefix: string;
}) {
  const tags = PHOTO_TAGS_BY_STAGE[stage];
  const [tag, setTag] = useState<string>(tags[0] ?? '');
  const [caption, setCaption] = useState('');
  const camRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handlePick = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    const pickedCaption = caption.trim() || null;
    await onFiles(files, tag || null, pickedCaption);
    setCaption('');
    e.target.value = '';
  };

  return (
    <div className="space-y-2.5 rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-medium text-slate-500">Vị trí / hạng mục chụp:</span>
        {tags.map((t) => (
          <button
            key={t}
            type="button"
            disabled={uploading}
            onClick={() => setTag(t)}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
              tag === t ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={caption}
          disabled={uploading}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Ghi chú ngắn cho ảnh (không bắt buộc)…"
          aria-label={`Ghi chú ảnh ${ORDER_PHOTO_STAGE_LABEL[stage]}`}
          className="min-w-[200px] flex-1 bg-white"
        />
        <input
          ref={camRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          hidden
          data-testid={`${testIdPrefix}-camera-input`}
          onChange={(e) => void handlePick(e)}
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          data-testid={`${testIdPrefix}-file-input`}
          onChange={(e) => void handlePick(e)}
        />
        <Button type="button" variant="outline" disabled={uploading} onClick={() => camRef.current?.click()} data-testid={`${testIdPrefix}-camera-btn`}>
          {uploading ? <Spinner className="h-4 w-4" /> : <Camera className="h-4 w-4 text-brand-600" />}
          Chụp ảnh
        </Button>
        <Button type="button" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()} data-testid={`${testIdPrefix}-upload-btn`}>
          {uploading ? <Spinner className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
          Chọn ảnh
        </Button>
      </div>
    </div>
  );
}

/** 1. Thẻ nhập Hiện trạng & Chụp ảnh lúc tạo đơn tiếp nhận (/ban-hang) */
export function IntakeDraftCard({
  intake,
  onIntakeChange,
  photos,
  onPhotosChange,
}: {
  intake: IntakeDraft;
  onIntakeChange: (next: IntakeDraft) => void;
  photos: DraftPhoto[];
  onPhotosChange: (next: DraftPhoto[]) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<DraftPhoto | null>(null);

  const handleFiles = async (files: FileList, tag: string | null, caption: string | null) => {
    setUploading(true);
    setErr(null);
    try {
      const uploaded = await uploadImageFiles(files);
      onPhotosChange([
        ...photos,
        ...uploaded.map((u) => ({ fileId: u.id, url: u.url, tag, caption })),
      ]);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Không tải được hình ảnh');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card className="p-4 lg:p-5" data-testid="intake-draft-card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-brand-600" />
            Hiện trạng xe &amp; Hình ảnh lúc tiếp nhận
          </CardTitle>
          <p className="mt-0.5 text-xs text-slate-500">
            Ghi nhận mức nhiên liệu, đèn cảnh báo, vết xước có sẵn và chụp 4 góc xe / đồng hồ ODO để đối chiếu minh bạch khi bàn giao.
          </p>
        </div>
        {photos.length > 0 && <Badge tone="sky">{photos.length} ảnh tiếp nhận</Badge>}
      </div>

      {err && <Alert className="mb-3">{err}</Alert>}

      <IntakeFieldsEditor value={intake} onChange={onIntakeChange} />

      <div className="mt-4 space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ảnh chụp hiện trạng ban đầu</div>
        <StageUploadToolbar stage="TIEP_NHAN" uploading={uploading} onFiles={handleFiles} testIdPrefix="intake-draft" />

        {photos.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4" data-testid="intake-draft-photo-grid">
            {photos.map((p, idx) => (
              <div key={p.fileId} className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <button type="button" onClick={() => setPreview(p)} className="block aspect-[4/3] w-full overflow-hidden bg-slate-100">
                  <img src={p.url} alt={p.tag ?? `Ảnh tiếp nhận ${idx + 1}`} className="h-full w-full object-cover transition group-hover:scale-105" />
                </button>
                <button
                  type="button"
                  aria-label="Xoá ảnh"
                  onClick={() => onPhotosChange(photos.filter((x) => x.fileId !== p.fileId))}
                  className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-slate-900/70 text-white hover:bg-rose-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <div className="p-2 text-xs">
                  <div className="truncate font-semibold text-slate-800">{p.tag ?? 'Ảnh tiếp nhận'}</div>
                  {p.caption && <div className="truncate text-slate-500">{p.caption}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <PhotoLightbox photo={preview} onClose={() => setPreview(null)} />
    </Card>
  );
}

/** Lưới hiển thị ảnh đã lưu của một giai đoạn */
function PhotoGrid({
  photos,
  canDelete,
  onDelete,
  busyId,
  emptyText,
  testId,
}: {
  photos: OrderPhotoWithOwner[];
  canDelete: (p: OrderPhotoWithOwner) => boolean;
  onDelete?: (photoId: string) => void;
  busyId?: string | null;
  emptyText: string;
  testId: string;
}) {
  const [preview, setPreview] = useState<OrderPhotoWithOwner | null>(null);

  if (!photos.length) {
    return <p className="rounded-xl bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">{emptyText}</p>;
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4" data-testid={testId}>
        {photos.map((p) => (
          <div key={p.id} className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xs" data-testid={`${testId}-item`}>
            <button type="button" onClick={() => setPreview(p)} className="block aspect-[4/3] w-full overflow-hidden bg-slate-100">
              <img src={p.url} alt={p.tag ?? ORDER_PHOTO_STAGE_LABEL[p.stage]} className="h-full w-full object-cover transition group-hover:scale-105" />
            </button>
            {onDelete && canDelete(p) && (
              <button
                type="button"
                aria-label="Xoá hình ảnh"
                disabled={busyId === p.id}
                onClick={() => onDelete(p.id)}
                className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-slate-900/70 text-white hover:bg-rose-600 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
            <div className="space-y-0.5 p-2 text-xs">
              <div className="truncate font-semibold text-slate-800">{p.tag ?? ORDER_PHOTO_STAGE_LABEL[p.stage]}</div>
              {p.caption && <div className="line-clamp-2 text-slate-600">{p.caption}</div>}
              <div className="truncate text-[11px] text-slate-400">
                {fmtDateTime(p.createdAt)}
                {p.uploadedBy ? ` · ${p.uploadedBy}` : ''}
              </div>
            </div>
          </div>
        ))}
      </div>
      <PhotoLightbox photo={preview} onClose={() => setPreview(null)} />
    </>
  );
}

/** 2. Khối Hiện trạng tiếp nhận & Hình ảnh 2 đầu trên chi tiết Lệnh sửa chữa (/don-hang/[id]) */
export function OrderMediaSection({
  orderId,
  intake,
  photos,
  editable,
  canManage,
  canTechUpdate,
  currentUserId,
  onChanged,
}: {
  orderId: string;
  intake: OrderIntakeData | null;
  photos: OrderPhotoWithOwner[];
  editable: boolean;
  canManage: boolean;
  canTechUpdate: boolean;
  currentUserId?: string | null;
  onChanged: () => void;
}) {
  const [editingIntake, setEditingIntake] = useState(false);
  const [draftIntake, setDraftIntake] = useState<IntakeDraft>(() => emptyIntakeDraft(intake));
  const [savingIntake, setSavingIntake] = useState(false);
  const [uploadingStage, setUploadingStage] = useState<OrderPhotoStage | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [techTab, setTechTab] = useState<'HOAN_TAT' | 'KIEM_TRA'>('HOAN_TAT');
  const [err, setErr] = useState<string | null>(null);

  const canEditIntake = editable && canManage;
  const canUploadIntake = editable && canManage;
  const canUploadTech = editable && (canManage || canTechUpdate);

  const intakePhotos = photos.filter((p) => p.stage === 'TIEP_NHAN');
  const checkPhotos = photos.filter((p) => p.stage === 'KIEM_TRA');
  const donePhotos = photos.filter((p) => p.stage === 'HOAN_TAT');

  const saveIntake = async () => {
    setSavingIntake(true);
    setErr(null);
    try {
      await api(`/orders/${orderId}/intake`, {
        method: 'PUT',
        body: {
          fuelLevel: draftIntake.fuelLevel,
          warningLights: draftIntake.warningLights,
          exteriorNote: draftIntake.exteriorNote.trim() || null,
          belongings: draftIntake.belongings.trim() || null,
          hasSpareAndTool: draftIntake.hasSpareAndTool,
        },
      });
      setEditingIntake(false);
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Không lưu được hiện trạng tiếp nhận');
    } finally {
      setSavingIntake(false);
    }
  };

  const uploadStage = async (stage: OrderPhotoStage, files: FileList, tag: string | null, caption: string | null) => {
    setUploadingStage(stage);
    setErr(null);
    try {
      const uploaded = await uploadImageFiles(files);
      await api(`/orders/${orderId}/photos`, {
        body: {
          stage,
          photos: uploaded.map((u) => ({ fileId: u.id, tag, caption })),
        },
      });
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Không tải được hình ảnh lên đơn');
    } finally {
      setUploadingStage(null);
    }
  };

  const deletePhoto = async (photoId: string) => {
    setDeletingId(photoId);
    setErr(null);
    try {
      await api(`/orders/${orderId}/photos/${photoId}`, { method: 'DELETE' });
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Không xoá được hình ảnh');
    } finally {
      setDeletingId(null);
    }
  };

  const canDeletePhoto = (p: OrderPhotoWithOwner) => {
    if (!editable) return false;
    if (canManage) return true;
    if (p.stage === 'TIEP_NHAN') return false;
    return canTechUpdate && !!currentUserId && p.uploaderId === currentUserId;
  };

  return (
    <Card className="space-y-5 p-4 lg:p-5" data-testid="order-media-card">
      {err && <Alert>{err}</Alert>}

      {/* Đầu 1: Hiện trạng & Ảnh lúc tiếp nhận xe */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-brand-600" />
              1. Hiện trạng &amp; Hình ảnh lúc tiếp nhận xe
            </CardTitle>
            <p className="text-xs text-slate-500">Do Cố vấn dịch vụ / Quản lý ghi nhận khi nhận xe từ khách hàng</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="sky">{intakePhotos.length} ảnh</Badge>
            {canEditIntake && (
              <Button
                variant="outline"
                onClick={() => {
                  setDraftIntake(emptyIntakeDraft(intake));
                  setEditingIntake(true);
                }}
                data-testid="edit-intake-btn"
              >
                <Pencil className="h-3.5 w-3.5" />
                Cập nhật hiện trạng
              </Button>
            )}
          </div>
        </div>

        <IntakeSummaryBadges intake={intake} />

        {canUploadIntake && (
          <StageUploadToolbar
            stage="TIEP_NHAN"
            uploading={uploadingStage === 'TIEP_NHAN'}
            onFiles={(files, tag, caption) => uploadStage('TIEP_NHAN', files, tag, caption)}
            testIdPrefix="order-intake"
          />
        )}

        <PhotoGrid
          photos={intakePhotos}
          canDelete={canDeletePhoto}
          onDelete={(id) => void deletePhoto(id)}
          busyId={deletingId}
          emptyText="Chưa có ảnh hiện trạng lúc tiếp nhận xe."
          testId="order-intake-photos"
        />
      </div>

      {/* Đầu 2: Hình ảnh Kỹ thuật viên (Kiểm tra phát sinh & Sau khi hoàn tất dịch vụ) */}
      <div className="space-y-3 border-t border-slate-100 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              2. Hình ảnh Kỹ thuật viên (Kiểm tra &amp; Sau hoàn tất dịch vụ)
            </CardTitle>
            <p className="text-xs text-slate-500">Ảnh hư hỏng phát sinh khi kiểm tra và ảnh nghiệm thu sau khi hoàn tất sửa chữa / bảo dưỡng</p>
          </div>
          <div className="inline-flex rounded-full bg-slate-100 p-1 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setTechTab('HOAN_TAT')}
              data-testid="tab-photos-hoan-tat"
              className={`rounded-full px-3 py-1.5 transition ${
                techTab === 'HOAN_TAT' ? 'bg-white text-emerald-700 shadow-2xs' : 'text-slate-600'
              }`}
            >
              Sau hoàn tất ({donePhotos.length})
            </button>
            <button
              type="button"
              onClick={() => setTechTab('KIEM_TRA')}
              data-testid="tab-photos-kiem-tra"
              className={`rounded-full px-3 py-1.5 transition ${
                techTab === 'KIEM_TRA' ? 'bg-white text-amber-700 shadow-2xs' : 'text-slate-600'
              }`}
            >
              Kiểm tra &amp; phát sinh ({checkPhotos.length})
            </button>
          </div>
        </div>

        {canUploadTech && (
          <StageUploadToolbar
            key={techTab}
            stage={techTab}
            uploading={uploadingStage === techTab}
            onFiles={(files, tag, caption) => uploadStage(techTab, files, tag, caption)}
            testIdPrefix={techTab === 'HOAN_TAT' ? 'order-done' : 'order-check'}
          />
        )}

        {techTab === 'HOAN_TAT' ? (
          <PhotoGrid
            photos={donePhotos}
            canDelete={canDeletePhoto}
            onDelete={(id) => void deletePhoto(id)}
            busyId={deletingId}
            emptyText="Chưa có hình ảnh nghiệm thu sau khi hoàn tất dịch vụ của Kỹ thuật viên."
            testId="order-completion-photos"
          />
        ) : (
          <PhotoGrid
            photos={checkPhotos}
            canDelete={canDeletePhoto}
            onDelete={(id) => void deletePhoto(id)}
            busyId={deletingId}
            emptyText="Chưa có hình ảnh chi tiết hạng mục kiểm tra / hư hỏng phát sinh."
            testId="order-inspection-photos"
          />
        )}
      </div>

      <Dialog open={editingIntake} onClose={() => setEditingIntake(false)} title="Cập nhật hiện trạng xe lúc tiếp nhận" wide>
        <div className="space-y-4">
          <IntakeFieldsEditor value={draftIntake} onChange={setDraftIntake} disabled={savingIntake} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditingIntake(false)}>
              Huỷ
            </Button>
            <Button onClick={() => void saveIntake()} disabled={savingIntake} data-testid="save-intake-btn">
              {savingIntake && <Spinner />}
              Lưu hiện trạng
            </Button>
          </div>
        </div>
      </Dialog>
    </Card>
  );
}

interface MediaResponse {
  intake: OrderIntakeData | null;
  photos: OrderPhotoWithOwner[];
  permissions: {
    canUploadTech: boolean;
    currentUserId: string;
    isManager: boolean;
  };
}

/** 3. Khối chụp & xem ảnh ngay trên màn hình Phiếu kiểm tra điện thoại của Kỹ thuật viên (/viec-cua-toi/[id]) */
export function TechInspectionMedia({ orderId, readOnly }: { orderId: string; readOnly: boolean }) {
  const [media, setMedia] = useState<MediaResponse | null>(null);
  const [uploading, setUploading] = useState<OrderPhotoStage | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api<MediaResponse>(`/orders/${orderId}/media`);
    setMedia(r);
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!media) return null;

  const intakePhotos = media.photos.filter((p) => p.stage === 'TIEP_NHAN');
  const checkPhotos = media.photos.filter((p) => p.stage === 'KIEM_TRA');
  const donePhotos = media.photos.filter((p) => p.stage === 'HOAN_TAT');
  const canUpload = !readOnly && media.permissions.canUploadTech;

  const upload = async (stage: OrderPhotoStage, files: FileList, tag: string | null, caption: string | null) => {
    setUploading(stage);
    setErr(null);
    try {
      const uploaded = await uploadImageFiles(files);
      const next = await api<MediaResponse>(`/orders/${orderId}/photos`, {
        body: { stage, photos: uploaded.map((u) => ({ fileId: u.id, tag, caption })) },
      });
      setMedia(next);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Không tải được hình ảnh');
    } finally {
      setUploading(null);
    }
  };

  const remove = async (photoId: string) => {
    setDeletingId(photoId);
    setErr(null);
    try {
      const next = await api<MediaResponse>(`/orders/${orderId}/photos/${photoId}`, { method: 'DELETE' });
      setMedia(next);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Không xoá được hình ảnh');
    } finally {
      setDeletingId(null);
    }
  };

  const canDelete = (p: OrderPhotoWithOwner) =>
    canUpload && (media.permissions.isManager || p.uploaderId === media.permissions.currentUserId);

  return (
    <div className="space-y-4">
      {err && <Alert>{err}</Alert>}

      {/* Đối chiếu hiện trạng lúc nhận xe (nếu CVDV đã ghi / chụp) */}
      {(media.intake || intakePhotos.length > 0) && (
        <Card className="space-y-3 p-4 sm:p-5" data-testid="tech-intake-reference">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-brand-600" />
              Hiện trạng xe lúc tiếp nhận (đối chiếu)
            </CardTitle>
            <Badge tone="sky">{intakePhotos.length} ảnh</Badge>
          </div>
          <IntakeSummaryBadges intake={media.intake} />
          {intakePhotos.length > 0 && (
            <PhotoGrid
              photos={intakePhotos}
              canDelete={() => false}
              emptyText=""
              testId="tech-intake-photos"
            />
          )}
        </Card>
      )}

      {/* Ảnh phát sinh trong quá trình kiểm tra */}
      <Card className="space-y-3 p-4 sm:p-5" data-testid="tech-check-media">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wrench className="h-4 w-4 text-amber-600" />
              Hình ảnh kiểm tra &amp; hư hỏng phát sinh
            </CardTitle>
            <p className="text-xs text-slate-500">Chụp phụ tùng mòn/hỏng, rò rỉ dầu để Cố vấn dịch vụ báo khách trực quan</p>
          </div>
          <Badge tone="peach">{checkPhotos.length} ảnh</Badge>
        </div>
        {canUpload && (
          <StageUploadToolbar
            stage="KIEM_TRA"
            uploading={uploading === 'KIEM_TRA'}
            onFiles={(files, tag, caption) => upload('KIEM_TRA', files, tag, caption)}
            testIdPrefix="tech-check"
          />
        )}
        <PhotoGrid
          photos={checkPhotos}
          canDelete={canDelete}
          onDelete={(id) => void remove(id)}
          busyId={deletingId}
          emptyText="Chưa có ảnh kiểm tra phát sinh."
          testId="tech-check-photos"
        />
      </Card>

      {/* Ảnh nghiệm thu của KTV sau khi hoàn tất dịch vụ */}
      <Card className="space-y-3 border-emerald-200 p-4 sm:p-5" data-testid="tech-completion-media">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ImagePlus className="h-4 w-4 text-emerald-600" />
              Hình ảnh sau khi hoàn tất dịch vụ
            </CardTitle>
            <p className="text-xs text-slate-500">Chụp phụ tùng mới đã lắp, khoang máy hoàn thiện, đồng hồ sau bảo dưỡng trước khi bàn giao</p>
          </div>
          <Badge tone="mint">{donePhotos.length} ảnh</Badge>
        </div>
        {canUpload && (
          <StageUploadToolbar
            stage="HOAN_TAT"
            uploading={uploading === 'HOAN_TAT'}
            onFiles={(files, tag, caption) => upload('HOAN_TAT', files, tag, caption)}
            testIdPrefix="tech-done"
          />
        )}
        <PhotoGrid
          photos={donePhotos}
          canDelete={canDelete}
          onDelete={(id) => void remove(id)}
          busyId={deletingId}
          emptyText="Chưa chụp hình ảnh sau khi hoàn tất dịch vụ."
          testId="tech-completion-photos"
        />
      </Card>
    </div>
  );
}

/** 4. Khối hiển thị Hiện trạng & Hình ảnh dịch vụ cho Chủ xe trên App (/app/don/[id]) */
export function OwnerOrderMediaCard({
  intake,
  photos,
}: {
  intake: OrderIntakeData | null | undefined;
  photos: OrderPhotoItem[] | undefined;
}) {
  const list = photos ?? [];
  const hasIntake =
    !!intake &&
    (!!intake.fuelLevel ||
      (intake.warningLights?.length ?? 0) > 0 ||
      !!intake.exteriorNote ||
      !!intake.belongings ||
      intake.hasSpareAndTool !== null);

  if (!hasIntake && list.length === 0) return null;

  const groups: { stage: OrderPhotoStage; title: string; items: OrderPhotoItem[] }[] = [
    { stage: 'TIEP_NHAN', title: 'Ảnh hiện trạng lúc nhận xe', items: list.filter((p) => p.stage === 'TIEP_NHAN') },
    { stage: 'KIEM_TRA', title: 'Ảnh kiểm tra thực tế tại xưởng', items: list.filter((p) => p.stage === 'KIEM_TRA') },
    { stage: 'HOAN_TAT', title: 'Ảnh sau khi hoàn tất dịch vụ', items: list.filter((p) => p.stage === 'HOAN_TAT') },
  ];

  return (
    <Card className="space-y-4 p-4" data-testid="owner-order-media">
      <CardTitle className="flex items-center gap-2 text-base">
        <Camera className="h-4 w-4 text-brand-600" />
        Hiện trạng &amp; Hình ảnh xe tại xưởng
      </CardTitle>

      {hasIntake && <IntakeSummaryBadges intake={intake} />}

      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <div key={g.stage} className="space-y-2 border-t border-slate-100 pt-3 first:border-t-0 first:pt-0">
            <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-600">
              <span>{g.title}</span>
              <span>{g.items.length} ảnh</span>
            </div>
            <PhotoGrid
              photos={g.items}
              canDelete={() => false}
              emptyText=""
              testId={`owner-photos-${g.stage.toLowerCase()}`}
            />
          </div>
        ))}
    </Card>
  );
}
