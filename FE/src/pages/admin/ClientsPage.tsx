// Khách hàng — mọi khách đã tương tác (thả tim/ghi chú) trong các album của PTG: tiến độ chọn
// ảnh, đã gửi lựa chọn chưa (mục 5.2), trạng thái thanh toán PTG tự đánh dấu (mục 3.2 — không
// có cổng thanh toán), chuỗi tên file đã chọn để dán vào Lightroom/Photoshop.
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import type { AdminClient, PaymentStatus } from "../../lib/types";
import { formatRelativeTime, initials } from "../../lib/formatTime";
import { CLIENTS_SEEN_EVENT } from "../../lib/navEvents";
import SegmentedControl from "../../components/ios/SegmentedControl";
import BottomSheet from "../../components/ios/BottomSheet";
import { ListRow, ListSection } from "../../components/ios/GroupedList";
import { CheckIcon, CopyIcon, SearchIcon, UsersIcon, XIcon } from "../../components/Icons";

type Filter = "all" | "in_progress" | "completed" | "unpaid";

const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  unpaid: "Chưa thanh toán",
  deposit: "Đã đặt cọc",
  paid: "Đã thanh toán",
};

const PAYMENT_BADGE: Record<PaymentStatus, string> = {
  unpaid: "bg-rose-500/15 text-rose-300",
  deposit: "bg-amber-500/15 text-amber-300",
  paid: "bg-emerald-500/15 text-emerald-300",
};

function isFilter(value: string | null): value is Filter {
  return value === "all" || value === "in_progress" || value === "completed" || value === "unpaid";
}

export default function ClientsPage() {
  const [params, setParams] = useSearchParams();
  const filter: Filter = isFilter(params.get("filter")) ? (params.get("filter") as Filter) : "all";
  const albumId = params.get("album_id");
  const openClientId = params.get("client");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [clients, setClients] = useState<AdminClient[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Mở trang Khách hàng = đã xem thông báo khách mới gửi lựa chọn (xoá huy hiệu ở thanh tab).
  useEffect(() => {
    api
      .post("/api/clients/seen")
      .then(() => window.dispatchEvent(new Event(CLIENTS_SEEN_EVENT)))
      .catch(() => {});
  }, []);

  // Gõ tìm kiếm: chờ 250ms rồi mới gọi API.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams({ filter });
    if (query) qs.set("search", query);
    if (albumId) qs.set("album_id", albumId);
    api
      .get<{ clients: AdminClient[] }>(`/api/clients?${qs}`)
      .then(({ data }) => {
        if (cancelled) return;
        setClients(data.clients);
        setError(null);
      })
      .catch((err) => !cancelled && setError(getErrorMessage(err, "Không tải được danh sách khách hàng")));
    return () => {
      cancelled = true;
    };
  }, [filter, query, albumId, reloadKey]);

  function updateParam(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: key !== "client" });
  }

  const albumName = useMemo(
    () => (albumId ? clients?.find((c) => c.album_id === albumId)?.album_name : null),
    [albumId, clients]
  );

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-[28px] font-bold leading-tight tracking-tight text-white sm:text-3xl">Khách hàng</h1>
      <p className="mt-1 text-pretty text-sm text-zinc-400">
        Khách xuất hiện ở đây sau khi thả tim hoặc ghi chú lần đầu trong album.
      </p>

      <div className="sticky top-12 z-20 -mx-4 mt-4 space-y-2.5 bg-[#090a0f]/85 px-4 py-2.5 backdrop-blur-xl lg:top-0">
        <label className="relative block">
          <span className="sr-only">Tìm khách hàng</span>
          <SearchIcon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo tên, số điện thoại, album…"
            enterKeyHint="search"
            className="h-10 w-full rounded-[10px] bg-white/[0.08] pl-9 pr-3 text-base text-white placeholder:text-zinc-500 focus-visible:outline-2 focus-visible:outline-indigo-400 sm:text-sm"
          />
        </label>
        <SegmentedControl<Filter>
          label="Lọc khách hàng"
          size="sm"
          value={filter}
          onChange={(value) => updateParam("filter", value === "all" ? null : value)}
          segments={[
            { value: "all", label: "Tất cả" },
            { value: "in_progress", label: "Đang chọn" },
            { value: "completed", label: "Đã gửi" },
            { value: "unpaid", label: "Chưa TT" },
          ]}
        />
        {albumId && (
          <button
            type="button"
            onClick={() => updateParam("album_id", null)}
            className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full bg-indigo-500/15 pl-3 pr-2 text-[13px] font-medium text-indigo-200 focus-visible:outline-2 focus-visible:outline-indigo-400"
          >
            <span className="truncate">Album: {albumName ?? "đang lọc"}</span>
            <XIcon size={14} aria-hidden="true" />
            <span className="sr-only">Bỏ lọc album</span>
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-rose-500/30 bg-rose-950/50 px-4 py-3 text-sm text-rose-200">
          {error}
        </p>
      )}

      {clients === null && !error && (
        <div aria-busy="true" aria-label="Đang tải khách hàng" className="mt-4 space-y-px overflow-hidden rounded-xl">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-16 animate-pulse bg-white/5" />
          ))}
        </div>
      )}

      {clients && clients.length === 0 && (
        <div className="mt-6 flex flex-col items-center rounded-2xl border border-dashed border-white/10 px-6 py-12 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-white/5 text-zinc-400">
            <UsersIcon size={22} />
          </span>
          <p className="mt-4 font-semibold text-zinc-100">
            {query || filter !== "all" || albumId ? "Không có khách nào khớp" : "Chưa có khách hàng"}
          </p>
          <p className="mt-1 max-w-xs text-pretty text-sm text-zinc-400">
            {query || filter !== "all" || albumId
              ? "Thử bỏ bớt bộ lọc hoặc từ khoá tìm kiếm."
              : "Gửi link album kèm mã PIN cho khách — họ sẽ hiện ở đây khi bắt đầu chọn ảnh."}
          </p>
        </div>
      )}

      {clients && clients.length > 0 && (
        <ListSection className="mt-3" footer={`${clients.length} khách`}>
          {clients.map((client) => {
            const progress = client.max_selectable_photos
              ? `${client.selected_count}/${client.max_selectable_photos} ảnh`
              : `${client.selected_count} ảnh`;
            return (
              <ListRow
                key={client.id}
                onClick={() => updateParam("client", client.id)}
                icon={
                  <span className="relative" aria-hidden="true">
                    <span className="flex size-10 items-center justify-center rounded-full bg-gradient-to-br from-zinc-700 to-zinc-800 text-sm font-semibold text-zinc-100">
                      {initials(client.name)}
                    </span>
                    {client.completed_at && (
                      <span className="absolute -bottom-0.5 -right-0.5 flex size-[18px] items-center justify-center rounded-full bg-emerald-500 text-emerald-950 ring-2 ring-zinc-900">
                        <CheckIcon size={12} />
                      </span>
                    )}
                  </span>
                }
                title={client.name}
                subtitle={
                  <>
                    {client.album_name} · {progress}
                    {client.pending_annotation_count ? ` · ${client.pending_annotation_count} ghi chú chờ` : ""}
                  </>
                }
                trailing={
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${PAYMENT_BADGE[client.payment_status]}`}>
                      {PAYMENT_LABEL[client.payment_status]}
                    </span>
                    {client.last_activity_at && (
                      <span className="text-[11px] text-zinc-500">{formatRelativeTime(client.last_activity_at)}</span>
                    )}
                  </span>
                }
              />
            );
          })}
        </ListSection>
      )}

      <ClientDetailSheet
        clientId={openClientId}
        onClose={() => updateParam("client", null)}
        onSaved={() => setReloadKey((k) => k + 1)}
      />
    </div>
  );
}

function ClientDetailSheet({
  clientId,
  onClose,
  onSaved,
}: {
  clientId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [client, setClient] = useState<AdminClient | null>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payment, setPayment] = useState<PaymentStatus>("unpaid");
  const [note, setNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    api
      .get<{ client: AdminClient }>(`/api/clients/${clientId}`)
      .then(({ data }) => {
        if (cancelled) return;
        setClient(data.client);
        setPayment(data.client.payment_status);
        setNote(data.client.payment_note ?? "");
        setError(null);
        setSaved(false);
        setCopied(false);
        setLoadedId(clientId);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(getErrorMessage(err, "Không tải được thông tin khách"));
        setLoadedId(clientId);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const isLoaded = loadedId === clientId;
  const filenames = client?.selected_photos?.map((p) => p.original_base_filename) ?? [];
  const searchString = filenames.join(" OR ");
  const dirty = client !== null && (payment !== client.payment_status || note.trim() !== (client.payment_note ?? ""));

  async function save() {
    if (!client) return;
    setIsSaving(true);
    setError(null);
    try {
      const { data } = await api.patch<{ client: AdminClient }>(`/api/clients/${client.id}`, {
        payment_status: payment,
        payment_note: note.trim() || null,
      });
      setClient((prev) => (prev ? { ...prev, ...data.client } : data.client));
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(getErrorMessage(err, "Không lưu được trạng thái thanh toán"));
    } finally {
      setIsSaving(false);
    }
  }

  async function copyFilenames() {
    try {
      await navigator.clipboard.writeText(searchString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Trình duyệt không cho phép sao chép — hãy chọn và sao chép thủ công.");
    }
  }

  return (
    <BottomSheet open={clientId !== null} title={isLoaded && client ? client.name : "Khách hàng"} onClose={onClose}>
      {!isLoaded && (
        <div aria-busy="true" className="space-y-3">
          <div className="h-24 animate-pulse rounded-xl bg-white/5" />
          <div className="h-32 animate-pulse rounded-xl bg-white/5" />
        </div>
      )}
      {isLoaded && error && !client && (
        <p role="alert" className="text-sm text-rose-300">
          {error}
        </p>
      )}
      {isLoaded && client && (
        <div className="space-y-6">
          <ListSection>
            <ListRow title="Album" value={client.album_name} to={`/admin/albums/${client.album_id}`} />
            <ListRow
              title="Số điện thoại"
              value={client.phone}
              trailing={
                <a
                  href={`tel:${client.phone}`}
                  className="shrink-0 rounded-full bg-emerald-500/15 px-3 py-1 text-[13px] font-semibold text-emerald-300 focus-visible:outline-2 focus-visible:outline-emerald-400"
                >
                  Gọi
                </a>
              }
            />
            <ListRow
              title="Lựa chọn"
              value={
                client.completed_at ? (
                  <span className="text-emerald-300">
                    {client.auto_locked ? "Tự chốt khi hết hạn" : `Đã gửi ${formatRelativeTime(client.completed_at)}`}
                  </span>
                ) : (
                  "Đang chọn"
                )
              }
            />
            <ListRow
              title="Yêu cầu chỉnh sửa"
              value="Xem ghi chú"
              to={`/admin/albums/${client.album_id}/annotations`}
            />
          </ListSection>

          <ListSection
            title={`Ảnh đã chọn (${filenames.length})`}
            footer="Dán chuỗi này vào ô tìm kiếm Text của Lightroom Classic/Photoshop Bridge để lọc đúng các ảnh khách đã chọn (cả RAW lẫn JPG)."
          >
            {filenames.length === 0 ? (
              <li className="px-4 py-4 text-sm text-zinc-500">Khách chưa chọn ảnh nào.</li>
            ) : (
              <>
                <li className="px-4 py-3">
                  <p className="max-h-28 overflow-y-auto break-words font-mono text-[13px] leading-relaxed text-zinc-300">
                    {searchString}
                  </p>
                </li>
                <ListRow
                  onClick={copyFilenames}
                  chevron={false}
                  icon={copied ? <CheckIcon size={18} className="text-emerald-400" /> : <CopyIcon size={18} className="text-indigo-300" />}
                  title={<span className="text-indigo-300">{copied ? "Đã sao chép" : "Sao chép chuỗi tìm kiếm Lightroom"}</span>}
                />
              </>
            )}
          </ListSection>

          <section>
            <h3 className="mb-1.5 px-4 text-[13px] font-medium uppercase tracking-wide text-zinc-500">Thanh toán</h3>
            <div className="space-y-3 rounded-xl border border-white/[0.06] bg-zinc-900/80 p-3">
              <SegmentedControl<PaymentStatus>
                label="Trạng thái thanh toán"
                value={payment}
                onChange={(v) => {
                  setPayment(v);
                  setSaved(false);
                }}
                segments={[
                  { value: "unpaid", label: "Chưa TT" },
                  { value: "deposit", label: "Đặt cọc" },
                  { value: "paid", label: "Đã TT" },
                ]}
              />
              <label className="block">
                <span className="sr-only">Ghi chú thanh toán</span>
                <textarea
                  value={note}
                  onChange={(e) => {
                    setNote(e.target.value);
                    setSaved(false);
                  }}
                  rows={2}
                  maxLength={500}
                  placeholder="Ghi chú, VD: cọc 2.000.000đ chuyển khoản ngày 20/11…"
                  className="w-full resize-none rounded-[10px] bg-white/[0.06] px-3 py-2 text-base text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-2 focus-visible:outline-indigo-400 sm:text-sm"
                />
              </label>
              {error && (
                <p role="alert" className="text-sm text-rose-300">
                  {error}
                </p>
              )}
              <button
                type="button"
                onClick={save}
                disabled={!dirty || isSaving}
                className="h-11 w-full rounded-[10px] bg-indigo-500 text-[15px] font-semibold text-white transition-colors hover:bg-indigo-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 disabled:bg-zinc-800 disabled:text-zinc-500"
              >
                {isSaving ? "Đang lưu…" : saved && !dirty ? "Đã lưu" : "Lưu trạng thái"}
              </button>
              <p className="px-1 text-pretty text-xs text-zinc-500">
                LensProof không thu tiền hộ — đây là sổ ghi chép riêng của bạn, khách không nhìn thấy.
              </p>
            </div>
          </section>

          <Link
            to={`/admin/clients?album_id=${client.album_id}`}
            className="block text-center text-sm font-medium text-indigo-300 hover:underline"
          >
            Xem mọi khách của album này
          </Link>
        </div>
      )}
    </BottomSheet>
  );
}
