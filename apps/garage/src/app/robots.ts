import type { MetadataRoute } from 'next';

const SITE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

/** Chỉ cho công cụ tìm kiếm vào web sàn (/cho) và trang đăng ký đối tác; trang quản trị, app chủ xe không lập chỉ mục */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: ['/cho', '/dang-ky-doi-tac'], disallow: ['/', '/cho/dat', '/cho/yeu-cau'] }],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
