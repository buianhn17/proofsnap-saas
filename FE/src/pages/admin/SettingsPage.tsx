// Cài đặt — hồ sơ PTG, trạng thái Google Drive thật (gọi Drive API), mặc định khi tạo album
// (preset nén, watermark, số ảnh tối đa, số ngày hạn chọn), quyền riêng tư và đăng xuất.
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { useAuth } from "../../contexts/auth";
import { COMPRESSION_PRESETS } from "../../lib/compressionPresets";
import type { AlbumDefaults, PhotographerSettings } from "../../lib/types";
import { initials } from "../../lib/formatTime";
import { IconTile, ListRow, ListSection } from "../../components/ios/GroupedList";
import Toggle from "../../components/ios/Toggle";
import ActionSheet from "../../components/ios/ActionSheet";
import UnsavedChangesGuard from "../../components/UnsavedChangesGuard";
import { CloudIcon, ExternalLinkIcon, LogOutIcon, ShieldCheckIcon, SlidersIcon } from "../../components/Icons";

interface DriveStatus {
  connected: boolean;
  rootFolder: { id: string; name: string; webViewLink?: string; trashed?: boolean } | null;
}

type DriveState =
  | { kind: "loading" }
  | { kind: "ok"; status: DriveStatus }
  | { kind: "error"; message: string; detail?: string };

const inputClass =
  "h-9 w-24 rounded-lg bg-white/[0.06] px-2 text-right text-[15px] tabular-nums text-zinc-100 placeholder:text-zinc-600 focus-visible:outline-2 focus-visible:outline-indigo-400";

function FieldRow({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <li className="flex min-h-12 items-center justify-between gap-3 px-4">
      <label htmlFor={htmlFor} className="min-w-0 py-2.5 text-[15px] text-zinc-100">
        {label}
      </label>
      {children}
    </li>
  );
}

export default function SettingsPage() {
  const { photographer, refresh, logout } = useAuth();
  const navigate = useNavigate();
  const [settings, setSettings] = useState<PhotographerSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [defaults, setDefaults] = useState<AlbumDefaults>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [drive, setDrive] = useState<DriveState>({ kind: "loading" });
  const [isSettingUpDrive, setIsSettingUpDrive] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ settings: PhotographerSettings }>("/api/settings")
      .then(({ data }) => {
        if (cancelled) return;
        setSettings(data.settings);
        setDisplayName(data.settings.display_name ?? "");
        setDefaults(data.settings.settings ?? {});
      })
      .catch((err) => !cancelled && setLoadError(getErrorMessage(err, "Không tải được cài đặt")));
    api
      .get<DriveStatus>("/api/drive/status")
      .then(({ data }) => !cancelled && setDrive({ kind: "ok", status: data }))
      .catch((err) => {
        if (cancelled) return;
        // Lỗi kỹ thuật (giải mã token, mạng...) không có ý nghĩa với PTG — chỉ giữ thông báo
        // thân thiện, chi tiết gốc để trong title cho người hỗ trợ kỹ thuật.
        const raw = getErrorMessage(err, "");
        setDrive({ kind: "error", message: "Không truy cập được Drive bằng quyền đã lưu", detail: raw });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function updateDefault<K extends keyof AlbumDefaults>(key: K, value: AlbumDefaults[K]) {
    setDefaults((prev) => ({ ...prev, [key]: value }));
    setSaveMessage(null);
  }

  function parseOptionalInt(value: string): number | null {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  async function save() {
    setIsSaving(true);
    setSaveMessage(null);
    try {
      const { data } = await api.patch<{ settings: PhotographerSettings }>("/api/settings", {
        display_name: displayName.trim() || undefined,
        settings: {
          default_compression_preset_id: defaults.default_compression_preset_id ?? 2,
          default_watermark_enabled: defaults.default_watermark_enabled ?? true,
          default_max_selectable_photos: defaults.default_max_selectable_photos ?? null,
          default_deadline_days: defaults.default_deadline_days ?? null,
        },
      });
      setSettings(data.settings);
      setSaveMessage({ tone: "ok", text: "Đã lưu cài đặt" });
      void refresh();
    } catch (err) {
      setSaveMessage({ tone: "error", text: getErrorMessage(err, "Không lưu được cài đặt") });
    } finally {
      setIsSaving(false);
    }
  }

  async function setupDrive() {
    setIsSettingUpDrive(true);
    try {
      const { data } = await api.post<DriveStatus>("/api/drive/setup");
      setDrive({ kind: "ok", status: { connected: true, rootFolder: data.rootFolder } });
    } catch (err) {
      setDrive({ kind: "error", message: "Không khởi tạo được thư mục trên Drive", detail: getErrorMessage(err, "") });
    } finally {
      setIsSettingUpDrive(false);
    }
  }

  async function handleLogout() {
    await logout();
    navigate("/admin/login", { replace: true });
  }

  const savedDefaults = settings?.settings ?? {};
  const isDirty =
    settings !== null &&
    ((displayName.trim() || null) !== (settings.display_name ?? null) ||
      (defaults.default_compression_preset_id ?? 2) !== (savedDefaults.default_compression_preset_id ?? 2) ||
      (defaults.default_watermark_enabled ?? true) !== (savedDefaults.default_watermark_enabled ?? true) ||
      (defaults.default_max_selectable_photos ?? null) !== (savedDefaults.default_max_selectable_photos ?? null) ||
      (defaults.default_deadline_days ?? null) !== (savedDefaults.default_deadline_days ?? null));
  const name = displayName || photographer?.display_name || photographer?.email || "";
  const presetId = defaults.default_compression_preset_id ?? 2;
  const reconnectUrl = `${import.meta.env.VITE_API_BASE_URL}/api/auth/google`;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-[28px] font-bold leading-tight tracking-tight text-white sm:text-3xl">Cài đặt</h1>

      {loadError && (
        <p role="alert" className="mt-4 rounded-xl border border-rose-500/30 bg-rose-950/50 px-4 py-3 text-sm text-rose-200">
          {loadError}
        </p>
      )}

      {!settings && !loadError && (
        <div aria-busy="true" aria-label="Đang tải cài đặt" className="mt-6 space-y-6">
          <div className="h-20 animate-pulse rounded-xl bg-white/5" />
          <div className="h-36 animate-pulse rounded-xl bg-white/5" />
        </div>
      )}

      {settings && (
        <div className="mt-6 space-y-8">
          {/* Thẻ hồ sơ */}
          <ListSection>
            <li className="flex items-center gap-4 px-4 py-4">
              <span
                className="flex size-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-indigo-500/60 to-cyan-500/40 text-xl font-semibold text-white"
                aria-hidden="true"
              >
                {initials(name)}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-lg font-semibold text-white">{name || "Nhiếp ảnh gia"}</span>
                <span className="block truncate text-[13px] text-zinc-500">{settings.email} · Google</span>
              </span>
            </li>
            <FieldRow label="Tên hiển thị" htmlFor="settings-name">
              <input
                id="settings-name"
                value={displayName}
                maxLength={80}
                autoComplete="name"
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  setSaveMessage(null);
                }}
                className="h-9 min-w-0 flex-1 rounded-lg bg-white/[0.06] px-2 text-right text-[15px] text-zinc-100 focus-visible:outline-2 focus-visible:outline-indigo-400 sm:max-w-64"
              />
            </FieldRow>
          </ListSection>

          <ListSection
            title="Lưu trữ"
            footer="Ảnh JPG đã nén được lưu trên Google Drive của chính bạn. Khách không bao giờ truy cập Drive trực tiếp — mọi ảnh đi qua máy chủ để vẽ watermark."
          >
            {drive.kind === "loading" && (
              <ListRow icon={<IconTile color="bg-sky-500"><CloudIcon size={17} /></IconTile>} title="Google Drive" value="Đang kiểm tra…" />
            )}
            {drive.kind === "ok" && drive.status.rootFolder && !drive.status.rootFolder.trashed && (
              <ListRow
                icon={<IconTile color="bg-sky-500"><CloudIcon size={17} /></IconTile>}
                title="Google Drive"
                subtitle={`Thư mục: ${drive.status.rootFolder.name}`}
                value={<span className="text-emerald-400">Đã kết nối</span>}
              />
            )}
            {drive.kind === "ok" && drive.status.rootFolder?.webViewLink && (
              <li>
                <a
                  href={drive.status.rootFolder.webViewLink}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-h-12 items-center justify-between gap-3 px-4 text-[15px] text-indigo-300 hover:bg-white/[0.03] focus-visible:bg-white/[0.06] focus-visible:outline-none"
                >
                  Mở thư mục trên Google Drive
                  <ExternalLinkIcon size={16} />
                </a>
              </li>
            )}
            {drive.kind === "ok" && (!drive.status.rootFolder || drive.status.rootFolder.trashed) && (
              <ListRow
                icon={<IconTile color="bg-sky-500"><CloudIcon size={17} /></IconTile>}
                title="Google Drive"
                subtitle="Chưa có thư mục LensProof"
                onClick={setupDrive}
                value={<span className="text-indigo-300">{isSettingUpDrive ? "Đang tạo…" : "Khởi tạo"}</span>}
              />
            )}
            {drive.kind === "error" && (
              <>
                <ListRow
                  icon={<IconTile color="bg-sky-500"><CloudIcon size={17} /></IconTile>}
                  title="Google Drive"
                  subtitle={<span title={drive.detail}>{drive.message}</span>}
                  value={<span className="text-amber-300">Cần kết nối lại</span>}
                />
                <li>
                  <a
                    href={reconnectUrl}
                    className="flex min-h-12 items-center px-4 text-[15px] text-indigo-300 hover:bg-white/[0.03] focus-visible:bg-white/[0.06] focus-visible:outline-none"
                  >
                    Đăng nhập lại Google để cấp quyền Drive
                  </a>
                </li>
              </>
            )}
          </ListSection>

          <ListSection
            title="Mặc định khi tạo album"
            footer="Áp dụng sẵn cho form tạo album mới — bạn vẫn đổi được từng album."
          >
            <li className="flex min-h-12 items-center gap-3 px-4">
              <IconTile color="bg-indigo-500"><SlidersIcon size={16} /></IconTile>
              <label htmlFor="settings-preset" className="min-w-0 flex-1 py-2.5 text-[15px] text-zinc-100">
                Chất lượng nén
              </label>
              <select
                id="settings-preset"
                value={presetId}
                onChange={(e) => updateDefault("default_compression_preset_id", Number(e.target.value))}
                className="h-9 max-w-[55%] rounded-lg bg-white/[0.06] px-2 text-[15px] text-zinc-100 focus-visible:outline-2 focus-visible:outline-indigo-400"
              >
                {COMPRESSION_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id} className="bg-zinc-900">
                    {preset.labelVi} ({preset.jpegQuality}%)
                  </option>
                ))}
              </select>
            </li>
            <li className="flex min-h-12 items-center gap-3 px-4">
              <IconTile color="bg-emerald-600"><ShieldCheckIcon size={16} /></IconTile>
              <span className="min-w-0 flex-1 py-2.5 text-[15px] text-zinc-100" id="settings-watermark-label">
                Watermark động
              </span>
              <Toggle
                label="Bật watermark động mặc định"
                checked={defaults.default_watermark_enabled ?? true}
                onChange={(v) => updateDefault("default_watermark_enabled", v)}
              />
            </li>
            <FieldRow label="Số ảnh khách được chọn" htmlFor="settings-max">
              <input
                id="settings-max"
                type="number"
                inputMode="numeric"
                min={1}
                placeholder="Không giới hạn"
                value={defaults.default_max_selectable_photos ?? ""}
                onChange={(e) => updateDefault("default_max_selectable_photos", parseOptionalInt(e.target.value))}
                className={`${inputClass} w-32`}
              />
            </FieldRow>
            <FieldRow label="Hạn chọn ảnh (ngày)" htmlFor="settings-deadline">
              <input
                id="settings-deadline"
                type="number"
                inputMode="numeric"
                min={1}
                max={365}
                placeholder="Không hạn"
                value={defaults.default_deadline_days ?? ""}
                onChange={(e) => updateDefault("default_deadline_days", parseOptionalInt(e.target.value))}
                className={inputClass}
              />
            </FieldRow>
          </ListSection>

          <div className="space-y-2">
            <button
              type="button"
              onClick={save}
              disabled={isSaving || !isDirty}
              className="h-12 w-full rounded-xl bg-indigo-500 text-[17px] font-semibold text-white transition-colors hover:bg-indigo-400 active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 disabled:opacity-60"
            >
              {isSaving ? "Đang lưu…" : isDirty ? "Lưu thay đổi" : "Đã lưu mọi thay đổi"}
            </button>
            {saveMessage && (
              <p role={saveMessage.tone === "error" ? "alert" : "status"} className={`text-center text-sm ${saveMessage.tone === "ok" ? "text-emerald-300" : "text-rose-300"}`}>
                {saveMessage.text}
              </p>
            )}
          </div>

          <ListSection
            title="Quyền riêng tư"
            footer="Khi bạn tải ảnh lên, hệ thống trích đặc trưng khuôn mặt từ ảnh album để phục vụ Tìm ảnh bằng khuôn mặt; khách phải đồng ý trước khi tìm bằng ảnh selfie, và selfie không được lưu lại. Album đánh dấu có người dưới 18 tuổi không bao giờ được trích đặc trưng khuôn mặt."
          >
            <ListRow
              icon={<IconTile color="bg-amber-600"><ShieldCheckIcon size={16} /></IconTile>}
              title="Album có người dưới 18 tuổi"
              subtitle="Bật trong phần Cấu hình của từng album"
              to="/admin/albums"
            />
          </ListSection>

          <ListSection>
            <ListRow
              icon={<IconTile color="bg-rose-600"><LogOutIcon size={16} /></IconTile>}
              title="Đăng xuất"
              destructive
              chevron={false}
              onClick={() => setConfirmLogout(true)}
            />
          </ListSection>

          <p className="pb-4 text-center text-xs text-zinc-600">LensProof Studio · tham gia {new Date(settings.created_at).toLocaleDateString("vi-VN")}</p>
        </div>
      )}

      <UnsavedChangesGuard when={isDirty && !isSaving} />
      <ActionSheet
        open={confirmLogout}
        onClose={() => setConfirmLogout(false)}
        title="Đăng xuất khỏi LensProof?"
        message="Album và ảnh trên Google Drive của bạn không bị ảnh hưởng."
        actions={[{ label: "Đăng xuất", tone: "destructive", onSelect: () => void handleLogout() }]}
      />
    </div>
  );
}
