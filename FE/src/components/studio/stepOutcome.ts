import type { CulledStats } from "../../lib/studioShows";

/** Kết quả Bước 2 (quét & lọc trên máy) chuyển sang Bước 3 (nộp). */
export interface StepOutcome {
  /** true = đã xử lý sạch, mở khoá bước nộp. */
  ready: boolean;
  totalFiles: number;
  rawCount: number;
  jpgCount: number;
  videoCount: number;
  culledStats: CulledStats;
  hasValidStructure: boolean;
}
