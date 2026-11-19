const swaggerJsdoc = require("swagger-jsdoc");

const options = {
	definition: {
		openapi: "3.0.0",
		info: {
			title: "LensProof SaaS API",
			version: "0.2.0",
			description:
				"Tài liệu API cho backend LensProof SaaS - Admin Portal (nhiếp ảnh gia) và Client Portal (khách hàng).",
		},
		components: {
			securitySchemes: {
				cookieAuth: {
					type: "apiKey",
					in: "cookie",
					name: "session_token",
				},
				clientCookieAuth: {
					type: "apiKey",
					in: "cookie",
					name: "client_session_token",
				},
			},
			schemas: {
				CreateAlbumRequest: {
					type: "object",
					required: ["name"],
					properties: {
						name: { type: "string", example: "Kỷ yếu 2026" },
						pin: { type: "string", pattern: "^[0-9]{4,12}$", example: "123456" },
						pin_enabled: { type: "boolean", default: true },
						max_selectable_photos: { type: "integer", nullable: true, example: 30 },
						selection_deadline: { type: "string", format: "date-time", nullable: true },
						watermark_enabled: { type: "boolean", default: true },
						compression_preset_id: { type: "integer", minimum: 1, maximum: 4, default: 2 },
						is_minor_album: { type: "boolean", default: false },
					},
				},
				UpdateAlbumRequest: {
					type: "object",
					properties: {
						name: { type: "string" },
						pin: { type: "string", pattern: "^[0-9]{4,12}$" },
						pin_enabled: { type: "boolean" },
						max_selectable_photos: { type: "integer", nullable: true },
						selection_deadline: { type: "string", format: "date-time", nullable: true },
						watermark_enabled: { type: "boolean" },
						compression_preset_id: { type: "integer", minimum: 1, maximum: 4 },
						is_minor_album: { type: "boolean" },
						is_locked: { type: "boolean" },
						status: { type: "string", enum: ["active", "archived"] },
					},
				},
				UploadPhotoRequest: {
					type: "object",
					required: ["file"],
					properties: {
						file: { type: "string", format: "binary", description: "JPG/JPEG tối đa 25 MB" },
						original_base_filename: { type: "string", example: "IMG_0001" },
						width: { type: "integer", minimum: 1 },
						height: { type: "integer", minimum: 1 },
						captured_at: { type: "string", format: "date-time" },
						sharpness_score: { type: "integer", minimum: 0, maximum: 100 },
						eye_status: { type: "string", enum: ["open", "squint", "closed"] },
						culling_flag: { type: "string", enum: ["green", "yellow", "red"] },
						scene_id: { type: "string", format: "uuid" },
						burst_cluster_id: { type: "string", format: "uuid" },
						is_best_in_cluster: { type: "boolean" },
						client_upload_id: {
							type: "string",
							format: "uuid",
							description: "Mã do client sinh, giữ nguyên khi thử lại — trùng mã thì trả về ảnh đã tạo (200) thay vì upload trùng",
						},
						face_crops_provided: {
							type: "boolean",
							description: "true: client đã dò khuôn mặt trên ảnh gốc và gửi kèm vùng cắt (có thể 0 vùng) — server không dò lại trên ảnh đã nén",
						},
						face_crops: {
							type: "array",
							items: { type: "string", format: "binary" },
							description: "Vùng cắt JPEG quanh từng khuôn mặt, lấy từ ảnh gốc full-res (tối đa 150)",
						},
						face_crop_regions: {
							type: "string",
							description: "JSON [{x,y,w,h}] vị trí từng vùng cắt, chuẩn hoá 0-1 theo kích thước ảnh, cùng thứ tự face_crops",
						},
					},
				},
				CreateShowRequest: {
					type: "object",
					required: ["shoot_date", "shoot_end_time", "class_name", "school_name"],
					properties: {
						shoot_date: { type: "string", format: "date", example: "2026-11-20" },
						shoot_end_time: {
							type: "string",
							format: "date-time",
							example: "2026-11-20T17:30:00+07:00",
							description: "Bắt buộc có múi giờ. Hạn bàn giao = mốc này + 24 giờ",
						},
						class_name: { type: "string", maxLength: 40, example: "12A5" },
						school_name: { type: "string", maxLength: 160, example: "THPT Kim Liên" },
					},
				},
				StudioShow: {
					type: "object",
					properties: {
						id: { type: "string", format: "uuid" },
						invite_code: { type: "string", example: "KL12A5-89" },
						shoot_date: { type: "string", format: "date", example: "2026-11-20" },
						shoot_end_time: { type: "string", format: "date-time" },
						deadline_at: { type: "string", format: "date-time", description: "shoot_end_time + 24 giờ" },
						class_name: { type: "string", example: "12A5" },
						school_name: { type: "string", example: "THPT Kim Liên" },
						status: { type: "string", enum: ["open", "completed", "archived"] },
						studio_name: { type: "string" },
						created_at: { type: "string", format: "date-time" },
						stats: {
							type: "object",
							properties: {
								member_count: { type: "integer", description: "Số thợ đã nhập mã mời" },
								submitted_crew_count: { type: "integer", description: "Số thợ đã nộp ít nhất 1 bài" },
								submission_count: { type: "integer" },
								pending_count: { type: "integer" },
								approved_count: { type: "integer" },
								rejected_count: { type: "integer" },
								late_count: { type: "integer", description: "Số bài nộp quá hạn 24h" },
								total_files: { type: "integer", description: "Tổng file ảnh + clip của cả lớp" },
								total_photo_files: { type: "integer" },
								total_video_clips: { type: "integer" },
								retouch_count: { type: "integer", description: "Số bài ảnh hậu kỳ editor đã nộp" },
								total_retouch_files: { type: "integer" },
								crew_member_count: { type: "integer" },
								editor_count: { type: "integer" },
							},
						},
						submitters: {
							type: "array",
							description: "Chỉ có ở GET /api/studio/shows — ai đã nộp, để hiện avatar (không kèm drive_url)",
							items: {
								type: "object",
								properties: {
									crew_user_id: { type: "string", format: "uuid" },
									crew_name: { type: "string" },
									crew_type: { type: "string", enum: ["photo", "video", "retouch"] },
									role_position: { type: "string" },
									status: { type: "string", enum: ["submitted", "approved", "rejected"] },
									is_on_time_24h: { type: "boolean", nullable: true },
								},
							},
						},
					},
				},
				JoinedShow: {
					allOf: [
						{ $ref: "#/components/schemas/StudioShow" },
						{
							type: "object",
							properties: {
								my_role: { type: "string", enum: ["crew", "editor"] },
								joined_at: { type: "string", format: "date-time" },
								my_submission_count: { type: "integer" },
							},
						},
					],
				},
				JoinShowRequest: {
					type: "object",
					required: ["invite_code"],
					properties: {
						invite_code: { type: "string", example: "KL12A5-89" },
						role_type: {
							type: "string",
							enum: ["crew", "editor"],
							default: "crew",
							description: "crew: Thợ ảnh / Thợ quay nộp file gốc · editor: hậu kỳ nhận file gốc & trả ảnh chỉnh",
						},
					},
				},
				ShowMember: {
					type: "object",
					properties: {
						id: { type: "string", format: "uuid" },
						user_id: { type: "string", format: "uuid" },
						role_type: { type: "string", enum: ["crew", "editor"] },
						display_name: { type: "string", nullable: true },
						email: { type: "string", description: "Chỉ trả cho chủ Studio" },
						joined_at: { type: "string", format: "date-time" },
						submission_count: { type: "integer" },
						crew_types: {
							type: "array",
							items: { type: "string", enum: ["photo", "video", "retouch"] },
							description: "Loại bài người này đã nộp — để gắn badge Thợ ảnh / Thợ quay",
						},
					},
				},
				SubmitShowRequest: {
					type: "object",
					required: ["crew_type", "drive_url", "total_files"],
					description: "photo/video: bắt buộc thêm role_position, has_valid_structure, backup_committed_45d = true. retouch (editor): chỉ cần drive_url + total_files.",
					properties: {
						crew_name: { type: "string", maxLength: 80, example: "Nguyễn Văn A", description: "Mặc định lấy tên hiển thị của tài khoản" },
						crew_type: { type: "string", enum: ["photo", "video", "retouch"] },
						role_position: {
							type: "string",
							maxLength: 40,
							example: "Lead",
							description: "Lead, Phụ 1, Phụ 2, Candid (ảnh) · Quay chính, Quay phụ (quay) · Flycam (cả hai) · hoặc vai trò tự đặt",
						},
						drive_url: { type: "string", example: "https://drive.google.com/drive/folders/1AbC…" },
						total_files: { type: "integer", minimum: 1, description: "Số ảnh (photo) hoặc số clip (video)" },
						raw_count: { type: "integer", minimum: 0, description: "Chỉ dành cho thợ ảnh" },
						jpg_count: { type: "integer", minimum: 0, description: "Chỉ dành cho thợ ảnh" },
						video_count: { type: "integer", minimum: 0, description: "Chỉ dành cho thợ quay" },
						culled_stats: {
							type: "object",
							description: "Số ảnh lỗi đã lọc bỏ",
							properties: {
								closed_eyes: { type: "integer", minimum: 0 },
								blurry: { type: "integer", minimum: 0 },
								overexposed: { type: "integer", minimum: 0 },
								failed_fireworks: { type: "integer", minimum: 0 },
							},
							additionalProperties: false,
						},
						has_valid_structure: {
							type: "boolean",
							description: "Ảnh: đủ 01 folder RAW nén + 01 folder JPG. Quay: có folder footage gốc",
						},
						backup_committed_45d: { type: "boolean", enum: [true], description: "Bắt buộc true" },
					},
				},
				ShowSubmission: {
					type: "object",
					properties: {
						id: { type: "string", format: "uuid" },
						show_id: { type: "string", format: "uuid" },
						crew_user_id: { type: "string", format: "uuid" },
						crew_name: { type: "string" },
						crew_type: { type: "string", enum: ["photo", "video", "retouch"] },
						role_position: { type: "string" },
						formatted_folder_name: { type: "string", example: "20/11/2026 Nguyễn Văn A Lead 850 file 12A5 THPT Kim Liên" },
						drive_url: { type: "string", description: "Chủ Studio, editor và chính người nộp nhận được; thợ khác thì không" },
						total_files: { type: "integer" },
						raw_count: { type: "integer" },
						jpg_count: { type: "integer" },
						video_count: { type: "integer" },
						culled_stats: { type: "object" },
						has_valid_structure: { type: "boolean" },
						backup_committed_45d: { type: "boolean" },
						is_on_time_24h: { type: "boolean", nullable: true, description: "null với bài retouch (không áp dụng hạn 24h)" },
						status: { type: "string", enum: ["submitted", "approved", "rejected"] },
						studio_note: { type: "string", nullable: true, description: "Chỉ chủ Studio và chính người nộp nhận được" },
						submitted_at: { type: "string", format: "date-time" },
						reviewed_at: { type: "string", format: "date-time", nullable: true },
					},
				},
				ReviewSubmissionRequest: {
					type: "object",
					required: ["status"],
					properties: {
						status: { type: "string", enum: ["approved", "rejected"] },
						studio_note: { type: "string", maxLength: 1000, description: "Bắt buộc khi rejected" },
					},
				},
				ClientAccessRequest: {
					type: "object",
					required: ["pin", "name", "phone"],
					properties: {
						pin: { type: "string", pattern: "^[0-9]{4,12}$", example: "123456" },
						name: { type: "string", example: "Nguyen Van A" },
						phone: { type: "string", example: "0901234567" },
					},
				},
			},
			parameters: {
				ShowId: {
					name: "showId",
					in: "path",
					required: true,
					description: "UUID của show",
					schema: { type: "string", format: "uuid" },
				},
				AlbumId: {
					name: "albumId",
					in: "path",
					required: true,
					description: "UUID của album",
					schema: { type: "string", format: "uuid" },
				},
			},
		},
		servers: [
			{
				url: "http://localhost:3000",
				description: "Local development server",
			},
		],
	},
	apis: ["./src/routes/*.js"],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;