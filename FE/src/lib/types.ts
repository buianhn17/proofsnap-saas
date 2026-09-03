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
  created_at: string;
}
