// Bỏ dấu, đ→d, hạ chữ, mọi ký tự ngoài a-z0-9 thành một khoảng trắng.
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
