const swaggerJsdoc = require("swagger-jsdoc");

const options = {
	definition: {
		openapi: "3.0.0",
		info: {
			title: "LensProof SaaS API",
			version: "0.1.0",
			description:
				"Tài liệu API cho backend LensProof SaaS - Admin Portal (nhiếp ảnh gia) và Client Portal (khách hàng).",
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