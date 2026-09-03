// Giai đoạn 3 — AI Face Search (Bước 3.1 màn hình đồng ý + Bước 3.3 upload selfie/kết quả).
// 3 trạng thái tuần tự: đang tải -> (nếu album/khách bị đánh dấu vị thành niên) khóa hẳn
// tính năng -> (nếu chưa đồng ý) màn hình xin đồng ý -> (đã đồng ý) upload selfie + kết quả.
import { useEffect, useMemo, useRef, useState } from "react";
import imageCompression from "browser-image-compression";
import { isAxiosError } from "axios";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
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
    return <p className="text-sm text-[#c1c6d4]">Đang tải...</p>;
  }

  if (!status.feature_available) {
    return (
      <div className="rounded-lg border border-[#805d00] bg-[#4a3600] p-6">
        <h1 className="text-lg font-semibold text-[#ffddb8]">
          Tìm ảnh bằng khuôn mặt không khả dụng
        </h1>
        <p className="mt-2 text-sm text-[#ffddb8]">
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
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-[2px]">
        <div className="w-full max-w-[600px] rounded-[8px] border border-[#2a2a2a] bg-[#201f1f] p-8 shadow-[0px_25px_50px_-12px_rgba(0,0,0,0.25)]">
          <div className="flex flex-col items-center text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-[#2a2a2a] text-2xl">
              🤖
            </span>
            <h1 className="mt-4 text-2xl font-semibold text-[#e5e2e1]">
              Yêu cầu xin phép xử lý dữ liệu
            </h1>
          </div>

          <div className="mt-6 border-t border-[#2a2a2a] pt-6">
            <p className="text-sm text-[#c1c6d4]">
              Để giúp bạn nhanh chóng tìm thấy hình ảnh của mình trong bộ sưu tập, LensProof sử
              dụng công nghệ trí tuệ nhân tạo (AI) để phân tích các đặc điểm khuôn mặt từ ảnh
              selfie bạn cung cấp.
            </p>

            <div className="mt-4 flex gap-3 rounded-[4px] border border-[#43474f] bg-[#131313] p-4">
              <span className="shrink-0">🛡️</span>
              <p className="text-sm text-[#c1c6d4]">
                <strong className="text-[#e5e2e1]">Quyền riêng tư được bảo đảm:</strong> Dữ
                liệu sinh trắc học của bạn chỉ được dùng cho phiên làm việc hiện tại, không
                được lưu trữ lại dưới bất kỳ hình thức nào, và được truyền tải qua kết nối mã
                hóa HTTPS.
              </p>
            </div>

            <div className="mt-5">
              <p className="text-base font-semibold text-[#e5e2e1]">Xác nhận độ tuổi</p>
              <div className="mt-2 flex gap-6">
                <label className="flex items-center gap-2 text-sm text-[#e5e2e1]">
                  <input
                    type="radio"
                    name="age-choice"
                    checked={ageChoice === "adult"}
                    onChange={() => setAgeChoice("adult")}
                  />
                  Trên 18 tuổi
                </label>
                <label className="flex items-center gap-2 text-sm text-[#e5e2e1]">
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

            <label className="mt-5 flex items-start gap-2 rounded-[4px] border border-[#43474f] bg-[#131313] p-4 text-sm text-[#e5e2e1]">
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

          <div className="mt-6 flex gap-3 border-t border-[#2a2a2a] pt-6">
            {albumId && (
              <Link
                to={`/a/${albumId}/gallery`}
                className="flex flex-1 items-center justify-center rounded-[4px] border border-[#43474f] px-4 py-2.5 text-sm font-semibold text-[#e5e2e1] hover:bg-[#2a2a2a]"
              >
                Bỏ qua
              </Link>
            )}
            <button
              type="button"
              onClick={handleAgree}
              disabled={!agreeChecked || !ageChoice || submittingConsent}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-[4px] bg-[#a9c7ff] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#93b6f5] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submittingConsent ? "Đang xử lý..." : "Đồng ý & Tiếp tục →"}
            </button>
          </div>

          <button
            type="button"
            onClick={handleRevokeConsent}
            disabled={revoking}
            className="mx-auto mt-4 block text-center text-sm text-[#a9c7ff] hover:underline disabled:opacity-50"
          >
            {revoking ? "Đang xử lý..." : "Rút lại đồng ý và xóa dữ liệu khuôn mặt của tôi"}
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
        <h1 className="text-[32px] font-semibold tracking-[-0.32px] text-[#e5e2e1]">
          Tìm ảnh của bạn
        </h1>
        <p className="mt-2 max-w-2xl text-base text-[#c1c6d4]">
          Tải lên một bức ảnh tự sướng (selfie) rõ mặt để AI của chúng tôi tìm kiếm tất cả các
          khoảnh khắc của bạn trong sự kiện này.
        </p>

        <div className="mt-6 flex items-center gap-4 rounded-[4px] border border-[#43474f] bg-[#1c1b1b] p-4">
          {selfiePreviewUrl && (
            <img
              src={selfiePreviewUrl}
              alt="Selfie"
              className="size-16 shrink-0 rounded-[4px] border border-[#43474f] object-cover"
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-sm font-medium text-[#e5e2e1]">
              <span className="size-2 animate-pulse rounded-full bg-[#a9c7ff]" />
              Đang phân tích khuôn mặt...
            </p>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#2a2a2a]">
              <div className="h-full w-2/3 animate-pulse rounded-full bg-[#a9c7ff]" />
            </div>
            {totalPhotoCount !== null && (
              <p className="mt-1.5 text-xs text-[#8b919e]">Đang quét {totalPhotoCount} ảnh</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (results && sortedResults) {
    return (
      <div>
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-[4px] border border-[#43474f] bg-[#1c1b1b] p-4">
          <div className="flex items-center gap-4">
            {selfiePreviewUrl && (
              <img
                src={selfiePreviewUrl}
                alt="Selfie"
                className="size-14 shrink-0 rounded-[4px] border border-[#43474f] object-cover"
              />
            )}
            <div>
              <p className="text-lg font-semibold text-[#e5e2e1]">
                {results.length === 0
                  ? "Không tìm thấy ảnh nào khớp"
                  : `Tìm thấy ${results.length} ảnh có bạn${
                      totalPhotoCount !== null ? ` trong ${totalPhotoCount} ảnh` : ""
                    }`}
              </p>
              {searchedAt && (
                <p className="text-sm text-[#8b919e]">
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
              className="rounded-[4px] border border-[#43474f] px-4 py-2 text-sm font-medium text-[#e5e2e1] hover:bg-[#2a2a2a]"
            >
              Tìm lại với ảnh khác
            </button>
            {albumId && (
              <Link
                to={`/a/${albumId}/gallery`}
                className="flex items-center gap-1.5 rounded-[4px] bg-[#a9c7ff] px-4 py-2 text-sm font-semibold text-white hover:bg-[#93b6f5]"
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
                className="relative overflow-hidden rounded-[4px] border border-[#43474f] bg-[#1c1b1b]"
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
                <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-[#e5e2e1]">
                  Khớp {Math.round(photo.similarity * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => toggleHeart(photo.id)}
                  aria-label="Thả tim"
                  className={`absolute right-2 top-2 flex size-7 items-center justify-center rounded-full text-base shadow ${
                    selected.has(photo.id)
                      ? "bg-red-500 text-white"
                      : "bg-black/50 text-[#e5e2e1]"
                  }`}
                >
                  {selected.has(photo.id) ? "♥" : "♡"}
                </button>
                <p className="truncate px-2 py-1.5 text-xs text-[#c1c6d4]">
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
      <h1 className="text-[32px] font-semibold tracking-[-0.32px] text-[#e5e2e1]">
        Tìm ảnh của bạn
      </h1>
      <p className="mt-2 max-w-2xl text-base text-[#c1c6d4]">
        Tải lên một bức ảnh tự sướng (selfie) rõ mặt để AI của chúng tôi tìm kiếm tất cả các
        khoảnh khắc của bạn trong sự kiện này.
      </p>

      <label className="mt-6 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-[4px] border-2 border-dashed border-[#43474f] bg-[#1c1b1b] px-6 py-12 text-center hover:border-[#5a5f68]">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg"
          disabled={searching}
          onChange={(e) => handleFileSelected(e.target.files?.[0])}
          className="hidden"
        />
        <span className="flex size-12 items-center justify-center rounded-full bg-[#2a2a2a] text-2xl">
          📷
        </span>
        <span className="text-sm font-medium text-[#e5e2e1]">
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
