export interface Page {
  skip: number;
  take: number;
}

export function toPage(page?: string, size?: string): Page {
  const pageNumber = Math.max(1, Number(page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(size) || 20));
  return { skip: (pageNumber - 1) * pageSize, take: pageSize };
}

export function unusedHelper(value: string): string {
  return value.trim().toLowerCase();
}
