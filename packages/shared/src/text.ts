/** Bỏ dấu tiếng Việt: "Nguyễn Văn Đức" → "Nguyen Van Duc". */
export function removeDiacritics(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

/**
 * Chuỗi dùng để tìm kiếm: chữ thường, không dấu, gộp khoảng trắng.
 * Lưu kèm bản ghi (cột search_text) để tìm "nguyen van an" ra "Nguyễn Văn An".
 */
export function searchKey(...parts: (string | null | undefined)[]): string {
  return removeDiacritics(parts.filter(Boolean).join(' '))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
