export interface Album {
  id: string;
  photographer_id: string;
  name: string;
  drive_folder_id: string;
  pin_enabled: boolean;
  max_selectable_photos: number | null;
  selection_deadline: string | null;
  is_locked: boolean;
  watermark_enabled: boolean;
  compression_preset_id: number;
  download_zip_unlocked: boolean;
  zip_drive_file_id: string | null;
  is_minor_album: boolean;
  status: "active" | "archived";
  cover_photo_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Photo {
  id: string;
  album_id: string;
  scene_id: string | null;
  burst_cluster_id: string | null;
  drive_file_id: string;
  original_base_filename: string;
  width: number | null;
  height: number | null;
  file_size_bytes: number | null;
  captured_at: string | null;
  sharpness_score: number | null;
  eye_status: "open" | "squint" | "closed" | null;
  culling_flag: "green" | "yellow" | "red" | null;
  is_best_in_cluster: boolean;
  /** Embedding khuôn mặt cho AI Face Search được trích nền sau upload — 'pending' là chưa xong. */
  face_index_status?: "pending" | "done" | "failed" | "skipped";
  created_at: string;
}

// ---- Admin: Bảng điều khiển, Khách hàng, Cài đặt (GET /api/dashboard, /api/clients, /api/settings)

export interface DashboardData {
  albums: { total: number; open: number; locked: number; archived: number };
  totals: {
    photos: number;
    clients: number;
    completed_clients: number;
    selections: number;
    pending_annotations: number;
    unpaid_clients: number;
  };
  upcoming_deadlines: {
    id: string;
    name: string;
    selection_deadline: string;
    max_selectable_photos: number | null;
    client_count: number;
    completed_count: number;
  }[];
  recent_activity: {
    kind: "completed" | "auto_locked" | "annotation" | "joined";
    at: string;
    client_name: string;
    client_id: string;
    album_id: string;
    album_name: string;
    detail: string | null;
  }[];
}

export type PaymentStatus = "unpaid" | "deposit" | "paid";

export interface AdminClient {
  id: string;
  album_id: string;
  album_name: string;
  max_selectable_photos: number | null;
  name: string;
  phone: string;
  payment_status: PaymentStatus;
  payment_note: string | null;
  payment_updated_at: string | null;
  created_at: string;
  completed_at: string | null;
  /** true: khách không tự bấm "Gửi lựa chọn" — hệ thống chốt khi album hết hạn. */
  auto_locked?: boolean;
  selected_count?: number;
  annotation_count?: number;
  pending_annotation_count?: number;
  last_activity_at?: string | null;
  selected_photos?: { id: string; original_base_filename: string }[];
}

export interface AlbumDefaults {
  default_compression_preset_id?: number;
  default_watermark_enabled?: boolean;
  default_max_selectable_photos?: number | null;
  default_deadline_days?: number | null;
}

export interface PhotographerSettings {
  id: string;
  email: string;
  display_name: string | null;
  settings: AlbumDefaults;
  drive_connected: boolean;
  created_at: string;
}
