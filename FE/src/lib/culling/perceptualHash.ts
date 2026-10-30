// Bước 1.3 — nhận diện trùng lặp/burst bằng difference hash (dHash), 64-bit.
// dHash so sánh độ sáng giữa các pixel liền kề nên tính rất nhanh và chịu được
// thay đổi nhỏ về nén JPEG/độ sáng — phù hợp để gom cụm burst chụp liên tiếp.

const HASH_WIDTH = 9; // 9 cột để lấy 8 cặp so sánh mỗi hàng
const HASH_HEIGHT = 8;

/** Tính dHash từ một nguồn ảnh (đã decode), trả về chuỗi hex 16 ký tự (64 bit). */
export function computeDHash(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number
): string {
  const canvas = new OffscreenCanvas(HASH_WIDTH, HASH_HEIGHT);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Không tạo được canvas context để tính dHash");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    source,
    0,
    0,
    sourceWidth,
    sourceHeight,
    0,
    0,
    HASH_WIDTH,
    HASH_HEIGHT
  );
  const { data } = ctx.getImageData(0, 0, HASH_WIDTH, HASH_HEIGHT);

  const gray = new Float32Array(HASH_WIDTH * HASH_HEIGHT);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }

  let hash = 0n;
  for (let y = 0; y < HASH_HEIGHT; y += 1) {
    for (let x = 0; x < HASH_WIDTH - 1; x += 1) {
      const left = gray[y * HASH_WIDTH + x];
      const right = gray[y * HASH_WIDTH + x + 1];
      hash = (hash << 1n) | (left > right ? 1n : 0n);
    }
  }

  return hash.toString(16).padStart(16, "0");
}

// Chữ ký tương đồng cho gom burst — bổ sung cho dHash. dHash 64 bit chỉ so dấu chênh sáng
// giữa 2 ô liền kề trên lưới 9x8: ảnh tối/tương phản thấp (backstage, hội trường) có nhiều
// cặp ô gần bằng nhau nên bit lật ngẫu nhiên giữa 2 khung gần như giống hệt, còn người mẫu
// đổi tư thế nhẹ/máy lia vài % khung là Hamming đã vượt ngưỡng. Chữ ký này là ảnh xám
// 16x16 chuẩn hoá (trừ trung bình, chia độ lệch chuẩn) — so bằng tương quan Pearson nên
// miễn nhiễm với đổi sáng/độ tương phản giữa 2 khung, và cho phép lệch ±1 ô (~6% khung).
const SIGNATURE_SIZE = 16;
const SIGNATURE_MAX_SHIFT = 1;

/** Ảnh xám 16x16 đã chuẩn hoá (mean 0, std 1), làm tròn 3 chữ số — rỗng nếu ảnh phẳng. */
export function computeSimilaritySignature(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number
): number[] {
  const canvas = new OffscreenCanvas(SIGNATURE_SIZE, SIGNATURE_SIZE);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Không tạo được canvas context để tính chữ ký ảnh");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, SIGNATURE_SIZE, SIGNATURE_SIZE);
  const { data } = ctx.getImageData(0, 0, SIGNATURE_SIZE, SIGNATURE_SIZE);

  const gray: number[] = [];
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const value = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    gray.push(value);
    sum += value;
  }
  const mean = sum / gray.length;
  const variance = gray.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / gray.length;
  // Ảnh gần như 1 màu (khung đen/che ống kính) — không có bố cục để so.
  if (variance < 1) return [];
  const std = Math.sqrt(variance);
  return gray.map((v) => Math.round(((v - mean) / std) * 1000) / 1000);
}

/** Tương quan Pearson -1..1 giữa 2 chữ ký, lấy giá trị lớn nhất khi dịch 1 bên ±1 ô theo
 * mỗi trục (bù máy lia/người dịch nhẹ giữa các khung). null nếu thiếu chữ ký. */
export function signatureSimilarity(a: number[], b: number[]): number | null {
  const cellCount = SIGNATURE_SIZE * SIGNATURE_SIZE;
  if (a.length !== cellCount || b.length !== cellCount) return null;

  let best = -1;
  for (let dy = -SIGNATURE_MAX_SHIFT; dy <= SIGNATURE_MAX_SHIFT; dy += 1) {
    for (let dx = -SIGNATURE_MAX_SHIFT; dx <= SIGNATURE_MAX_SHIFT; dx += 1) {
      // Chỉ tính trên phần chồng lên nhau, chuẩn hoá lại trên chính phần đó.
      let sumA = 0;
      let sumB = 0;
      let sumAA = 0;
      let sumBB = 0;
      let sumAB = 0;
      let n = 0;
      for (let y = Math.max(0, -dy); y < Math.min(SIGNATURE_SIZE, SIGNATURE_SIZE - dy); y += 1) {
        for (let x = Math.max(0, -dx); x < Math.min(SIGNATURE_SIZE, SIGNATURE_SIZE - dx); x += 1) {
          const va = a[y * SIGNATURE_SIZE + x];
          const vb = b[(y + dy) * SIGNATURE_SIZE + x + dx];
          sumA += va;
          sumB += vb;
          sumAA += va * va;
          sumBB += vb * vb;
          sumAB += va * vb;
          n += 1;
        }
      }
      const cov = sumAB / n - (sumA / n) * (sumB / n);
      const varA = sumAA / n - (sumA / n) ** 2;
      const varB = sumBB / n - (sumB / n) ** 2;
      if (varA <= 0 || varB <= 0) continue;
      best = Math.max(best, cov / Math.sqrt(varA * varB));
    }
  }
  return best;
}

export function hammingDistance(hexA: string, hexB: string): number {
  let xor = BigInt(`0x${hexA}`) ^ BigInt(`0x${hexB}`);
  let count = 0;
  while (xor > 0n) {
    count += Number(xor & 1n);
    xor >>= 1n;
  }
  return count;
}

/**
 * Gom nhóm các item có hash cách nhau <= maxDistance thành cùng 1 cụm (burst).
 * Trả về Map từ id -> groupId (groupId bắt đầu từ 1); item không trùng ai giữ groupId riêng của nó
 * (mỗi cụm dù chỉ có 1 ảnh vẫn có id, để UI lọc "cụm có > 1 ảnh" khi cần).
 */
export function groupByHashDistance(
  items: { id: string; hash: string }[],
  maxDistance: number
): Map<string, number> {
  const parent = new Map<string, string>();
  items.forEach((item) => parent.set(item.id, item.id));

  function find(id: string): string {
    let root = id;
    while (parent.get(root) !== root) {
      root = parent.get(root)!;
    }
    let current = id;
    while (parent.get(current) !== root) {
      const next = parent.get(current)!;
      parent.set(current, root);
      current = next;
    }
    return root;
  }

  function union(a: string, b: string) {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  }

  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      if (hammingDistance(items[i].hash, items[j].hash) <= maxDistance) {
        union(items[i].id, items[j].id);
      }
    }
  }

  const groupIds = new Map<string, number>();
  let nextGroupId = 1;
  const result = new Map<string, number>();
  for (const item of items) {
    const root = find(item.id);
    let groupId = groupIds.get(root);
    if (groupId === undefined) {
      groupId = nextGroupId;
      nextGroupId += 1;
      groupIds.set(root, groupId);
    }
    result.set(item.id, groupId);
  }
  return result;
}