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