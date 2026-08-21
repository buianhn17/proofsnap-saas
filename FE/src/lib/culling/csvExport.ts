// Bước 1.3 — xuất CSV kết quả để ghi lại tốc độ xử lý + đối chiếu với đánh giá bằng mắt,
// phục vụ việc chốt ngưỡng điểm xanh/vàng/đỏ ngoài công cụ (Excel/Sheets) nếu cần.

function csvCell(value: string | number): string {
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildCsv(
  headers: string[],
  rows: (string | number)[][]
): string {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(row.map(csvCell).join(","));
  }
  return lines.join("\r\n");
}

export function downloadCsv(fileName: string, csvContent: string) {
  const blob = new Blob(["﻿" + csvContent], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}