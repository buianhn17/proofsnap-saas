// Giai đoạn 3 — AI Face Search (Bước 3.1 màn hình đồng ý + Bước 3.3 upload selfie/kết quả).
// 3 trạng thái tuần tự: đang tải -> (nếu album/khách bị đánh dấu vị thành niên) khóa hẳn
// tính năng -> (nếu chưa đồng ý) màn hình xin đồng ý -> (đã đồng ý) upload selfie + kết quả.
import { useEffect, useMemo, useRef, useState } from "react";
import imageCompression from "browser-image-compression";
import { isAxiosError } from "axios";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { CameraIcon, ScanFaceIcon, ShieldCheckIcon } from "../../components/Icons";
import { useClientAlbum } from "../../contexts/ClientAlbumContext";
import PhotoAnnotationLightbox from "../../components/PhotoAnnotationLightbox";

interface ConsentStatus {
  feature_available: boolean;
  consented: boolean;
  consented_at: string | null;
}

interface FaceSearchResultPhoto {
  id: string;
  original_base_filename: string;
  width: number | null;
  height: number | null;
  created_at: string;
  burst_cluster_id: string | null;
  is_best_in_cluster: boolean;
  similarity: number;
}

async function compressSelfie(file: File) {
  return imageCompression(file, {
    maxWidthOrHeight: 1600,
    initialQuality: 0.85,
    useWebWorker: true,
    fileType: "image/jpeg",
  });
}

export default function FaceSearchPage() {
  const { album } = useClientAlbum();
  const albumId = album?.id ?? null;

  const [status, setStatus] = useState<ConsentStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [totalPhotoCount, setTotalPhotoCount] = useState<number | null>(null);

  const [agreeChecked, setAgreeChecked] = useState(false);
  const [ageChoice, setAgeChoice] = useState<"adult" | "minor" | null>(null);
  const [submittingConsent, setSubmittingConsent] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);

  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<FaceSearchResultPhoto[] | null>(null);
  const [selfiePreviewUrl, setSelfiePreviewUrl] = useState<string | null>(null);
  const [searchedAt, setSearchedAt] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openPhotoId, setOpenPhotoId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!albumId) return;
    api
      .get<ConsentStatus>(`/api/public/albums/${albumId}/face-search/consent`)
      .then(({ data }) => setStatus(data))
      .catch((err) => {
        if (isAxiosError(err) && (err.response?.status === 401 || err.response?.status === 403)) {
          return; // ClientAlbumContext lo redirect về trang PIN nếu phiên hết hạn.
        }
        setStatusError(getErrorMessage(err, "Không tải được trạng thái đồng ý"));
      });
  }, [albumId]);

  useEffect(() => {
    if (!albumId) return;
    api
      .get<{ photos: unknown[] }>(`/api/public/albums/${albumId}/photos`)
      .then(({ data }) => setTotalPhotoCount(data.photos.length))
      .catch(() => {
        // Không chặn tìm ảnh nếu riêng số đếm tổng ảnh lỗi tải.
      });
  }, [albumId]);

  async function handleAgree() {
    if (!albumId || !agreeChecked || !ageChoice) return;
    setSubmittingConsent(true);
    setConsentError(null);
    try {
      const { data } = await api.post<ConsentStatus>(
        `/api/public/albums/${albumId}/face-search/consent`,
        { agree: true, is_minor: ageChoice === "minor" }
      );
      setStatus(data);
    } catch (err) {
      if (isAxiosError(err) && err.response?.data?.error === "FACE_SEARCH_DISABLED_MINOR") {
        setStatus({ feature_available: false, consented: false, consented_at: null });
        return;
      }
      setConsentError(getErrorMessage(err, "Không thể ghi nhận đồng ý, vui lòng thử lại"));
    } finally {
      setSubmittingConsent(false);
    }
  }

  async function handleRevokeConsent() {
    if (!albumId) return;
    setRevoking(true);
    try {
      const { data } = await api.post<ConsentStatus>(
        `/api/public/albums/${albumId}/face-search/consent/revoke`
      );
      setStatus(data);
      setAgreeChecked(false);
      setAgeChoice(null);
    } catch (err) {
      setConsentError(getErrorMessage(err, "Không thể rút lại đồng ý, vui lòng thử lại"));
    } finally {
      setRevoking(false);
    }
  }

  async function handleFileSelected(file: File | undefined) {
    if (!albumId || !file) return;
    setSearching(true);
    setSearchError(null);
    setResults(null);
    setSelfiePreviewUrl(URL.createObjectURL(file));
    try {
      const compressed = await compressSelfie(file);
      const formData = new FormData();
      formData.append("file", compressed, file.name);
      const { data } = await api.post<{ photos: FaceSearchResultPhoto[] }>(
        `/api/public/albums/${albumId}/face-search`,
        formData
      );
      setResults(data.photos);
      setSearchedAt(new Date().toISOString());
    } catch (err) {
      setSearchError(getErrorMessage(err, "Tìm ảnh thất bại, vui lòng thử lại"));
    } finally {
      setSearching(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function reset() {
    setResults(null);
    setSelfiePreviewUrl(null);
    setSearchError(null);
    setSearchedAt(null);
  }

  async function toggleHeart(photoId: string) {
    if (!albumId) return;
    try {
      const { data } = await api.post<{ selected: boolean }>(
        `/api/public/albums/${albumId}/photos/${photoId}/select`
      );
      setSelected((prev) => {
        const next = new Set(prev);
        if (data.selected) next.add(photoId);
        else next.delete(photoId);
        return next;
      });
    } catch {
      // Bỏ qua lỗi 1 lượt thả tim, không chặn xem kết quả còn lại.
    }
  }

  const sortedResults = useMemo(
    () => (results ? [...results].sort((a, b) => b.similarity - a.similarity) : null),
    [results]
  );

  if (statusError) {
    return (
      <p className="rounded-md bg-red-950/50 px-3 py-2 text-sm text-red-300">{statusError}</p>
    );
  }

  if (!album || !status) {
    return <p className="text-sm text-zinc-400">Đang tải…</p>;
  }

  if (!status.feature_available) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-950/60 p-6">
        <h1 className="text-lg font-semibold text-amber-200">
          Tìm ảnh bằng khuôn mặt không khả dụng
        </h1>
        <p className="mt-2 text-sm text-amber-200">
          Album này được đánh dấu có thể chứa ảnh của người chưa đủ 18 tuổi. Để bảo vệ dữ
          liệu sinh trắc học của trẻ vị thành niên, tính năng nhận diện khuôn mặt tự động bị
          khóa cho album này. Nếu cần tìm ảnh của bạn, vui lòng liên hệ trực tiếp nhiếp ảnh
          gia phụ trách album.
        </p>
      </div>
    );
  }

  if (!status.consented) {
    return (
      <div role="dialog" aria-modal="true" aria-label="Đồng ý tìm ảnh bằng khuôn mặt" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-md">
        <div className="w-full max-w-[600px] animate-scale-in rounded-3xl border border-white/10 bg-zinc-900/95 p-8 shadow-2xl shadow-black/60">
          <div className="flex flex-col items-center text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl border border-white/10 bg-zinc-950 text-indigo-300">
              <ScanFaceIcon size={26} />
            </span>
            <h1 className="mt-4 text-2xl font-semibold text-zinc-100">
              Yêu cầu xin phép xử lý dữ liệu
            </h1>
          </div>

          <div className="mt-6 border-t border-white/5 pt-6">
            <p className="text-sm text-zinc-400">
              Để giúp bạn nhanh chóng tìm thấy hình ảnh của mình trong bộ sưu tập, LensProof sử
              dụng công nghệ trí tuệ nhân tạo (AI) để phân tích các đặc điểm khuôn mặt từ ảnh
              selfie bạn cung cấp.
            </p>

            <div className="mt-4 flex gap-3 rounded-lg border border-white/10 bg-zinc-950 p-4">
              <ShieldCheckIcon size={18} className="mt-0.5 shrink-0 text-emerald-400" />
              <p className="text-sm text-zinc-400">
                <strong className="text-zinc-100">Quyền riêng tư được bảo đảm:</strong> Dữ
                liệu sinh trắc học của bạn chỉ được dùng cho phiên làm việc hiện tại, không
                được lưu trữ lại dưới bất kỳ hình thức nào, và được truyền tải qua kết nối mã
                hóa HTTPS.
              </p>
            </div>

            <div className="mt-5">
              <p className="text-base font-semibold text-zinc-100">Xác nhận độ tuổi</p>
              <div className="mt-2 flex gap-6">
                <label className="flex items-center gap-2 text-sm text-zinc-100">
                  <input
                    type="radio"
                    name="age-choice"
                    checked={ageChoice === "adult"}
                    onChange={() => setAgeChoice("adult")}
                  />
                  Trên 18 tuổi
                </label>
                <label className="flex items-center gap-2 text-sm text-zinc-100">
                  <input
                    type="radio"
                    name="age-choice"
                    checked={ageChoice === "minor"}
                    onChange={() => setAgeChoice("minor")}
                  />
                  Dưới 18 tuổi
                </label>
              </div>
            </div>

            <label className="mt-5 flex items-start gap-2 rounded-lg border border-white/10 bg-zinc-950 p-4 text-sm text-zinc-100">
              <input
                type="checkbox"
                checked={agreeChecked}
                onChange={(e) => setAgreeChecked(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Tôi đồng ý với việc xử lý dữ liệu khuôn mặt để tìm kiếm hình ảnh trong bộ sưu
                tập này theo các điều khoản bảo mật đã nêu.
              </span>
            </label>

            {consentError && (
              <p className="mt-3 text-sm text-red-300">{consentError}</p>
            )}
          </div>

          <div className="mt-6 flex gap-3 border-t border-white/5 pt-6">
            {albumId && (
              <Link
                to={`/a/${albumId}/gallery`}
                className="flex flex-1 items-center justify-center rounded-lg border border-white/10 px-4 py-2.5 text-sm font-semibold text-zinc-100 hover:bg-zinc-800"
              >
                Bỏ qua
              </Link>
            )}
            <button
              type="button"
              onClick={handleAgree}
              disabled={!agreeChecked || !ageChoice || submittingConsent}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submittingConsent ? "Đang xử lý…" : "Đồng ý & Tiếp tục →"}
            </button>
          </div>

          <button
            type="button"
            onClick={handleRevokeConsent}
            disabled={revoking}
            className="mx-auto mt-4 block text-center text-sm text-indigo-300 hover:underline disabled:opacity-50"
          >
            {revoking ? "Đang xử lý…" : "Rút lại đồng ý và xóa dữ liệu khuôn mặt của tôi"}
          </button>
        </div>
      </div>
    );
  }

  // Bước hiển thị "đang phân tích" — backend xử lý đồng bộ trong 1 request (không stream tiến
  // độ theo từng ảnh thật), nên chỉ hiện ảnh selfie + tiến trình dạng chờ chứ không bịa số ảnh
  // đã quét/khớp tăng dần theo thời gian thực như mockup.
  if (searching) {
    return (
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl text-zinc-100">
          Tìm ảnh của bạn
        </h1>
        <p className="mt-2 max-w-2xl text-base text-zinc-400">
          Tải lên một bức ảnh tự sướng (selfie) rõ mặt để AI của chúng tôi tìm kiếm tất cả các
          khoảnh khắc của bạn trong sự kiện này.
        </p>

        <div className="mt-6 flex items-center gap-4 rounded-lg border border-white/10 bg-zinc-900 p-4">
          {selfiePreviewUrl && (
            <img
              src={selfiePreviewUrl}
              alt="Selfie"
              className="size-16 shrink-0 rounded-lg border border-white/10 object-cover"
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-sm font-medium text-zinc-100">
              <span className="size-2 animate-pulse rounded-full bg-indigo-500" />
              Đang phân tích khuôn mặt...
            </p>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
              <div className="h-full w-2/3 animate-pulse rounded-full bg-indigo-500" />
            </div>
            {totalPhotoCount !== null && (
              <p className="mt-1.5 text-xs text-zinc-500">Đang quét {totalPhotoCount} ảnh</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (results && sortedResults) {
    return (
      <div>
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-white/10 bg-zinc-900 p-4">
          <div className="flex items-center gap-4">
            {selfiePreviewUrl && (
              <img
                src={selfiePreviewUrl}
                alt="Selfie"
                className="size-14 shrink-0 rounded-lg border border-white/10 object-cover"
              />
            )}
            <div>
              <p className="text-lg font-semibold text-zinc-100">
                {results.length === 0
                  ? "Không tìm thấy ảnh nào khớp"
                  : `Tìm thấy ${results.length} ảnh có bạn${
                      totalPhotoCount !== null ? ` trong ${totalPhotoCount} ảnh` : ""
                    }`}
              </p>
              {searchedAt && (
                <p className="text-sm text-zinc-500">
                  Dựa trên ảnh tải lên lúc{" "}
                  {new Date(searchedAt).toLocaleString("vi-VN")}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={reset}
              className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-800"
            >
              Tìm lại với ảnh khác
            </button>
            {albumId && (
              <Link
                to={`/a/${albumId}/gallery`}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400"
              >
                Xem toàn bộ album →
              </Link>
            )}
          </div>
        </div>

        {searchError && (
          <p className="mt-4 rounded-md bg-red-950/50 px-3 py-2 text-sm text-red-300">
            {searchError}
          </p>
        )}

        {sortedResults.length > 0 && (
          <div className="mt-6 grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4">
            {sortedResults.map((photo) => (
              <div
                key={photo.id}
                className="relative overflow-hidden rounded-lg border border-white/10 bg-zinc-900"
              >
                <button
                  type="button"
                  onClick={() => setOpenPhotoId(photo.id)}
                  className="block w-full"
                >
                  <img
                    src={`${import.meta.env.VITE_API_BASE_URL}/api/public/albums/${albumId}/photos/${photo.id}/view?size=thumb`}
                    alt={photo.original_base_filename}
                    loading="lazy"
                    decoding="async"
                    className="aspect-square w-full object-cover"
                  />
                </button>
                <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-zinc-100">
                  Khớp {Math.round(photo.similarity * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => toggleHeart(photo.id)}
                  aria-label="Thả tim"
                  className={`absolute right-2 top-2 flex size-7 items-center justify-center rounded-full text-base shadow ${
                    selected.has(photo.id)
                      ? "bg-red-500 text-white"
                      : "bg-black/50 text-zinc-100"
                  }`}
                >
                  {selected.has(photo.id) ? "♥" : "♡"}
                </button>
                <p className="truncate px-2 py-1.5 text-xs text-zinc-400">
                  {photo.original_base_filename}
                </p>
              </div>
            ))}
          </div>
        )}

        {openPhotoId && albumId && (
          <PhotoAnnotationLightbox
            albumId={albumId}
            photoId={openPhotoId}
            photoName={
              results.find((p) => p.id === openPhotoId)?.original_base_filename ?? ""
            }
            albumName={album.name}
            isSelected={selected.has(openPhotoId)}
            onToggleSelect={() => toggleHeart(openPhotoId)}
            onClose={() => setOpenPhotoId(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl text-zinc-100">
        Tìm ảnh của bạn
      </h1>
      <p className="mt-2 max-w-2xl text-base text-zinc-400">
        Tải lên một bức ảnh tự sướng (selfie) rõ mặt để AI của chúng tôi tìm kiếm tất cả các
        khoảnh khắc của bạn trong sự kiện này.
      </p>

      <label className="mt-6 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-white/10 bg-zinc-900 px-6 py-12 text-center hover:border-white/20">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg"
          disabled={searching}
          onChange={(e) => handleFileSelected(e.target.files?.[0])}
          className="hidden"
        />
        <span className="flex size-12 items-center justify-center rounded-2xl border border-white/10 bg-zinc-950 text-indigo-300">
          <CameraIcon size={22} />
        </span>
        <span className="text-sm font-medium text-zinc-100">
          Bấm để chọn ảnh selfie (JPG)
        </span>
      </label>

      {searchError && (
        <p className="mt-4 rounded-md bg-red-950/50 px-3 py-2 text-sm text-red-300">
          {searchError}
        </p>
      )}
    </div>
  );
}
