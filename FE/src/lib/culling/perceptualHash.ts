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
  const ctx = canvas.getContext("2d");
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